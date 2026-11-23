// SPDX-License-Identifier: BSD-3-Clause
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';
import {describe,expect,it} from 'vitest';
import {compileModelSource,createCadSession,designGraph,generateModelSource,parseDocument,rewriteSketchExpressions,trimSketchProfile,validateDocument} from '@brickwright/cad-core';
import type {SketchOutlineProfile} from '@brickwright/cad-core';
import {verifyOutlineSolve} from '../packages/editor/src/outline-constraint-solve.js';
import type {OutlineSolveRequest} from '../packages/editor/src/outline-constraint-solve.js';

const sandbox=createContext({});
sandbox.self=sandbox;
runInContext(readFileSync('packages/editor/assets/sketch-constraints.dart.js','utf8'),sandbox);
const run=(request:OutlineSolveRequest)=>JSON.parse(sandbox.solveBrickwrightOutline(JSON.stringify(request)));
const solve=async(request:OutlineSolveRequest)=>verifyOutlineSolve(request,run(request)).points;
const dimensions=(width:string,unrelated='2')=>({version:1 as const,parameters:{
 width:{unit:'mm' as const,expression:width},span:{unit:'mm' as const,expression:'width'},unrelated:{unit:'scalar' as const,expression:unrelated}
},bindings:[]});
const outline:SketchOutlineProfile={kind:'outline',id:'outline',points:[[0,0],[40,0],[40,20],[0,20]],
 vertexIds:['a','b','c','d'],relations:[
  {kind:'horizontal',edge:['a','b']},{kind:'length',edge:['a','b'],length:'span'},
  {kind:'parallel',edge:['a','b'],other:['c','d']}
 ]};
const signal=()=>new AbortController().signal;
const draft:OutlineSolveRequest={
 points:[[0,0],[38,3],[35,22],[2,20]],
 constraints:[
  {kind:'horizontal',edge:0},{kind:'vertical',edge:1},{kind:'parallel',edge:0,other:2},
  {kind:'perpendicular',edge:2,other:3},{kind:'length',edge:0,length:40},
  {kind:'equal',edge:0,other:2},{kind:'length',edge:1,length:20}
 ]
};
describe('dart_csp outline worker artifact',()=>{
 it('solves coupled edge relations and returns the correct rank',()=>{
  expect(verifyOutlineSolve(draft,run(draft))).toEqual({
   points:[[0,0],[40,0],[40,20],[0,20]],degrees:0
  });
  const partial={...draft,constraints:draft.constraints.slice(0,1)};
  expect(verifyOutlineSolve(partial,run(partial))).toMatchObject({degrees:5});
 });
 it('rejects incompatible dimensions and false worker success',()=>{
  const impossible:OutlineSolveRequest={...draft,constraints:[...draft.constraints,{kind:'length',edge:0,length:45}]};
  expect(()=>verifyOutlineSolve(impossible,run(impossible))).toThrow('Could not solve');
  expect(()=>verifyOutlineSolve(draft,{status:'solved',degrees:0,points:draft.points})).toThrow('did not meet');
  expect(()=>verifyOutlineSolve(draft,{status:'solved',degrees:0,points:[[1,1],[40,1],[40,21],[1,21]]})).toThrow('invalid outline');
 });
});

it('round-trips retained outline constraints and updates an indirect dimension with one Undo',async()=>{
 const session=createCadSession();
 session.setParametric(dimensions('40'));
 const profile=outline,body=session.addSketchExtrusion(profile);
 const first=session.state.document,node=first.nodes[body];
 if(node.kind!=='extrusion')throw Error('fixture');
 const id=node.sketchId;
 expect(first.version).toBe(31);
 expect(parseDocument(session.serialize())).toEqual(first);
 expect(compileModelSource(generateModelSource(first),first).sketches?.[id].profile).toEqual(profile);
 expect(designGraph(first).find(entry=>entry.key===`sketch:${id}`)?.dependencies).toEqual(['parameter:span']);
 expect(()=>validateDocument({...first,version:30})).toThrow('version 31');
 const transplant=structuredClone(first.sketches![id]);
 rewriteSketchExpressions(transplant,value=>value==='span'?'newWidth':value);
 expect(transplant.profile).toMatchObject({relations:[profile.relations![0],
  {kind:'length',edge:['a','b'],length:'newWidth'},profile.relations![2]]});
 expect(()=>trimSketchProfile(first.sketches![id],first,[5,0],[5,20],'left')).toThrow('Clear outline constraints');

 expect(()=>session.setParametric(dimensions('60'))).toThrow('requires solving');
 const before=session.state.revision;
 await session.setParametricWithOutlineSolve(dimensions('60'),solve,signal());
 const changed=session.state.document;
 const updated=changed.sketches![id].profile as SketchOutlineProfile;
 expect(updated).toMatchObject({vertexIds:profile.vertexIds,relations:profile.relations});
 expect(updated.points[1][0]).toBeCloseTo(60);
 expect(session.state.revision).toBe(before+1);
 expect(changed.parametric?.parameters.width.expression).toBe('60');
 session.undo();
 expect(session.state.document).toBe(first);
 session.redo();
 expect(session.state.document).toBe(changed);

 for(const relation of [
  {kind:'horizontal' as const,edge:['a','c'] as [string,string]},
  {kind:'equal' as const,edge:['a','b'] as [string,string],other:['a','b'] as [string,string]},
  {kind:'length' as const,edge:['a','b'] as [string,string],length:'3 deg'}
 ]){
  expect(()=>session.updateSketch(id,{profile:{...profile,relations:[relation]}})).toThrow();
  expect(session.state.document).toBe(changed);
 }
});

it('rejects the whole parameter edit when a second dependent outline conflicts',async()=>{
 const session=createCadSession();
 session.setParametric(dimensions('40'));
 session.addSketchExtrusion(outline,{name:'First plate'});
 session.addSketchExtrusion({...outline,relations:[...outline.relations!,{kind:'length',edge:['a','b'],length:40}]},{name:'Locked plate'});
 const before=session.state;
 const visited:number[]=[];
 await expect(session.setParametricWithOutlineSolve(dimensions('60'),async request=>{
  visited.push(request.constraints.length);
  return solve(request);
 },signal())).rejects.toThrow(/Locked plate.*Could not solve/);
 expect(visited).toEqual([3,4]);
 expect(session.state).toEqual(before);
});

it('skips the worker when evaluated lengths are unchanged and rejects stale or cancelled solves',async()=>{
 const session=createCadSession();
 session.setParametric(dimensions('40'));
 session.addSketchExtrusion(outline);
 const unexpected=async()=>{throw Error('unexpected solve');};
 await session.setParametricWithOutlineSolve(dimensions('20 * 2','8'),unexpected,signal());
 const before=session.state.document;
 const abort=new AbortController();
 await expect(session.setParametricWithOutlineSolve(dimensions('60'),async request=>{
  abort.abort();
  return solve(request);
 },abort.signal)).rejects.toThrow();
 expect(session.state.document).toBe(before);
 await expect(session.setParametricWithOutlineSolve(dimensions('60'),async request=>{
  session.rename('Renamed while solving');
  return solve(request);
 },signal())).rejects.toThrow('The model changed');
 expect(session.state.document.title).toBe('Renamed while solving');
 expect(session.state.document.sketches).toEqual(before.sketches);
 expect(session.state.document.parametric).toEqual(before.parametric);
});
