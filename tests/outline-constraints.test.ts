// SPDX-License-Identifier: BSD-3-Clause
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';
import {describe,expect,it} from 'vitest';
import {compileModelSource,createCadSession,designGraph,featureValue,generateModelSource,outlineRelationsForSolve,parseDocument,rewriteSketchExpressions,trimSketchProfile,validateDocument} from '@brickwright/cad-core';
import type {SketchOutlineProfile} from '@brickwright/cad-core';
import {verifyOutlineSolve} from '../packages/editor/src/outline-constraint-solve.js';
import type {OutlineSolveRequest} from '../packages/editor/src/outline-constraint-solve.js';

const sandbox=createContext({});
sandbox.self=sandbox;
runInContext(readFileSync('packages/editor/assets/sketch-constraints.dart.js','utf8'),sandbox);
const run=(request:OutlineSolveRequest)=>JSON.parse(sandbox.solveBrickwrightOutline(JSON.stringify(request)));
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

it('round-trips retained outline constraints and stable vertex IDs through project and model source',()=>{
 const session=createCadSession();
 session.setParametric({version:1,parameters:{width:{unit:'mm',expression:'40'}},bindings:[]});
 const profile:SketchOutlineProfile={kind:'outline',id:'outline',points:[[0,0],[40,0],[40,20],[0,20]],
  vertexIds:['a','b','c','d'],relations:[
   {kind:'horizontal',edge:['a','b']},{kind:'length',edge:['a','b'],length:'width'},
   {kind:'parallel',edge:['a','b'],other:['c','d']}
  ]};
 const body=session.addSketchExtrusion(profile);
 const first=session.state.document,node=first.nodes[body];
 if(node.kind!=='extrusion')throw Error('fixture');
 const id=node.sketchId;
 expect(first.version).toBe(31);
 expect(parseDocument(session.serialize())).toEqual(first);
 expect(compileModelSource(generateModelSource(first),first).sketches?.[id].profile).toEqual(profile);
 expect(designGraph(first).find(entry=>entry.key===`sketch:${id}`)?.dependencies).toEqual(['parameter:width']);
 expect(()=>validateDocument({...first,version:30})).toThrow('version 31');
 const transplant=structuredClone(first.sketches![id]);
 rewriteSketchExpressions(transplant,value=>value==='width'?'newWidth':value);
 expect(transplant.profile).toMatchObject({relations:[profile.relations![0],
  {kind:'length',edge:['a','b'],length:'newWidth'},profile.relations![2]]});
 expect(()=>trimSketchProfile(first.sketches![id],first,[5,0],[5,20],'left')).toThrow('Clear outline constraints');

 session.setParametric({version:1,parameters:{width:{unit:'mm',expression:'60'}},bindings:[]});
 const changed=session.state.document;
 expect(changed.sketches![id].profile).toEqual(profile);
 const request={points:profile.points,constraints:outlineRelationsForSolve(profile,value=>featureValue(value,changed))};
 const {points}=verifyOutlineSolve(request,run(request));
 session.editExtrusion(body,{distance:10,symmetric:false,sketch:{profile:{...profile,points}}});
 expect(session.state.document.sketches![id].profile).toMatchObject({vertexIds:profile.vertexIds,relations:profile.relations});
 expect(points[1][0]).toBeCloseTo(60);
 session.undo();
 expect(session.state.document).toEqual(changed);

 for(const relation of [
  {kind:'horizontal' as const,edge:['a','c'] as [string,string]},
  {kind:'equal' as const,edge:['a','b'] as [string,string],other:['a','b'] as [string,string]},
  {kind:'length' as const,edge:['a','b'] as [string,string],length:'3 deg'}
 ]){
  expect(()=>session.updateSketch(id,{profile:{...profile,relations:[relation]}})).toThrow();
  expect(session.state.document).toBe(changed);
 }
});
