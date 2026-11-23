// SPDX-License-Identifier: BSD-3-Clause
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';
import {describe,expect,it} from 'vitest';
import {compileModelSource,createCadSession,designGraph,generateModelSource,outlineBulgesForCurves,outlineBulgesForRadii,parseDocument,rewriteSketchExpressions,sketchBulgeArc,trimSketchProfile,validateDocument} from '@brickwright/cad-core';
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

it('prepares a source parameter edit without touching history and patches only solved coordinates on apply',async()=>{
 const session=createCadSession();
 session.setParametric(dimensions('40'));
 session.addSketchExtrusion(outline,{name:'Source plate'});
 session.enableModelSource();
 const before=session.state,source=session.modelSource;
 const changed=source.replace('expression: "40"','expression: "65"')+'// keep my plate note\n';
 expect(()=>session.prepareModelSource(changed)).toThrow('requires solving');
 const prepared=await session.prepareModelSourceWithOutlineSolve(changed,{expectedRevision:before.revision},solve,signal());
 expect(session.state).toEqual(before);
 const profile=Object.values(prepared.document.sketches!)[0].profile as SketchOutlineProfile;
 expect(profile.points[1][0]).toBeCloseTo(65);
 expect(profile).toMatchObject({vertexIds:outline.vertexIds,relations:outline.relations});
 expect(prepared.document.modelSource?.source).toContain('// keep my plate note');
 expect(compileModelSource(prepared.document.modelSource!.source,before.document).sketches).toEqual(prepared.document.sketches);
 expect(session.applyPreparedModelSource(prepared)).toBe(true);
 expect(session.state.revision).toBe(before.revision+1);
 session.undo();
 expect(session.state.document).toBe(before.document);
});

it('rejects conflicting or obsolete source candidates and keeps explicitly valid points',async()=>{
 const session=createCadSession();
 session.setParametric(dimensions('40'));
 session.addSketchExtrusion({...outline,relations:[...outline.relations!,{kind:'length',edge:['a','b'],length:40}]});
 session.enableModelSource();
 const before=session.state,source=session.modelSource;
 const changed=source.replace('expression: "40"','expression: "60"');
 await expect(session.prepareModelSourceWithOutlineSolve(changed,{},solve,signal())).rejects.toThrow('Could not solve');
 expect(session.state).toEqual(before);
 const explicit=changed.replace('length: 40','length: 60').replace('[40, 0], [40, 20]','[60, 0], [60, 20]');
 const unexpected=async()=>{throw Error('unexpected solve');};
 const prepared=await session.prepareModelSourceWithOutlineSolve(explicit,{},unexpected,signal());
 expect(Object.values(prepared.document.sketches!)[0].profile).toMatchObject({points:[[0,0],[60,0],[60,20],[0,20]]});
 session.rename('Another edit');
 expect(()=>session.applyPreparedModelSource(prepared)).toThrow('changed while editing');
 expect(session.state.document.sketches).toEqual(before.document.sketches);
});

it('preserves signed minor and major arcs through the semicircle limit',()=>{
 for(const sweep of ['cw-minor','ccw-minor','cw-major','ccw-major'] as const){
  const radius={kind:'radius' as const,edge:0,radius:30,sweep};
  const [bulge]=outlineBulgesForRadii(outline.points,undefined,[radius])!;
  expect(bulge<0).toBe(sweep.startsWith('cw-'));
  expect(Math.abs(bulge)>1).toBe(sweep.endsWith('major'));
  expect(sketchBulgeArc(outline.points[0],outline.points[1],bulge)?.radius).toBeCloseTo(30,10);
  const [halfCircle]=outlineBulgesForRadii(outline.points,[bulge,0,0,0],[{...radius,radius:20}])!;
  expect(Math.abs(halfCircle)).toBe(1);
 }
});

it('drives a retained arc radius from parameters and model source with fixed endpoints and atomic rejection',async()=>{
 const session=createCadSession();
 session.setParametric(dimensions('60'));
 const radius={kind:'radius' as const,edge:['a','b'] as [string,string],radius:'span',sweep:'ccw-major' as const};
 const seeded=outlineBulgesForRadii(outline.points,undefined,[{kind:'radius',edge:0,radius:60,sweep:radius.sweep}]);
 const body=session.addSketchExtrusion({...outline,bulges:seeded,relations:[radius]});
 session.enableModelSource();
 const original=session.state.document,node=original.nodes[body];
 if(node.kind!=='extrusion')throw Error('fixture');
 const id=node.sketchId;
 const current=()=>session.state.document.sketches![id].profile as SketchOutlineProfile;
 const curve=(profile=current())=>sketchBulgeArc(profile.points[0],profile.points[1],profile.bulges![0])!;
 expect(original.version).toBe(32);
 expect(parseDocument(session.serialize())).toEqual(original);
 expect(()=>validateDocument({...original,version:31})).toThrow('version 32');
 expect(designGraph(original).find(entry=>entry.key===`sketch:${id}`)?.dependencies).toEqual(['parameter:span']);
 const copy=structuredClone(original.sketches![id]);
 rewriteSketchExpressions(copy,expression=>expression==='span'?'newSpan':expression);
 expect(copy.profile).toMatchObject({relations:[{...radius,radius:'newSpan'}]});
 expect(()=>session.updateSketch(id,{profile:{...current(),relations:[radius,radius]}})).toThrow('only one driving radius');
 const unexpected=async()=>{throw Error('radius-only solve should not start the chord worker');};
 await session.setParametricWithOutlineSolve(dimensions('20'),unexpected,signal());
 expect(current().points).toEqual(outline.points);
 expect(current().bulges?.[0]).toBe(1);
 const half=session.state.document;
 await expect(session.setParametricWithOutlineSolve(dimensions('19'),unexpected,signal())).rejects.toThrow('half its chord length');
 expect(session.state.document).toBe(half);
 const prepared=await session.prepareModelSourceWithOutlineSolve(session.modelSource.replace('expression: "20"','expression: "35"'),{},unexpected,signal());
 expect(compileModelSource(prepared.document.modelSource!.source,half).sketches).toEqual(prepared.document.sketches);
 expect(session.applyPreparedModelSource(prepared)).toBe(true);
 expect(curve().radius).toBeCloseTo(35,10);
 expect(curve().sweep).toBeGreaterThan(Math.PI);
 expect(current().points).toEqual(outline.points);
 session.undo();
 expect(session.state.document).toBe(half);
});

it('solves directed arc tangency at either endpoint including a join across the closing vertex',()=>{
 const points:OutlineSolveRequest['points']=[[10,0],[20,10],[20,20],[0,20],[0,0]];
 const a={kind:'tangent' as const,edge:0,other:4},b={...a,other:1};
 const left=outlineBulgesForCurves(points,[.2,0,0,0,0],[a,b])!;
 expect(left[0]).toBeCloseTo(Math.tan(Math.PI/8),12);
 const arc=sketchBulgeArc(points[0],points[1],left[0])!;
 expect(arc.center[0]).toBeCloseTo(10);
 expect(arc.center[1]).toBeCloseTo(10);
 expect(arc.radius).toBeCloseTo(10);
 expect(()=>outlineBulgesForCurves(points,left,[a,{...b,other:2}])).toThrow('adjoining straight');
 expect(()=>outlineBulgesForCurves(points,[.2,.1,0,0,0],[b])).toThrow('adjoining straight');
 expect(()=>outlineBulgesForCurves(points,left,[b,{kind:'radius',edge:0,radius:20,sweep:'ccw-minor'}])).toThrow('conflicts');
 const reversed=points.slice().reverse();
 const right=outlineBulgesForCurves(reversed,undefined,[{kind:'tangent',edge:3,other:4}])!;
 expect(right[3]).toBeCloseTo(-left[0],12);
});

it('keeps compatible arc tangency through source edits, reload and Undo',async()=>{
 const session=createCadSession();
 const points:OutlineSolveRequest['points']=[[0,0],[10,0],[20,10],[20,20],[0,20]];
 const profile:SketchOutlineProfile={kind:'outline',id:'fillet',points,vertexIds:['a','b','c','d','e'],
  bulges:outlineBulgesForCurves(points,undefined,[{kind:'tangent',edge:1,other:0}]),
  relations:[{kind:'tangent',edge:['b','c'],other:['a','b']}]};
 const body=session.addSketchExtrusion(profile);
 session.enableModelSource();
 const before=session.state.document,node=before.nodes[body];
 if(node.kind!=='extrusion')throw Error('fixture');
 expect(before.version).toBe(33);
 expect(parseDocument(session.serialize())).toEqual(before);
 expect(()=>validateDocument({...before,version:32})).toThrow('version 33');
 const source=session.modelSource.replace('points: [[0, 0]','points: [[0, 2]');
 const unexpected=async()=>{throw Error('tangency alone does not require a chord worker');};
 const candidate=await session.prepareModelSourceWithOutlineSolve(source,{},unexpected,signal());
 const solved=candidate.document.sketches![node.sketchId].profile as SketchOutlineProfile;
 expect(solved.points[0]).toEqual([0,2]);
 expect(solved.bulges![1]).toBeCloseTo(Math.tan((Math.PI/4+Math.atan(.2))/2),12);
 expect(solved.relations).toEqual(profile.relations);
 session.applyPreparedModelSource(candidate);
 session.undo();
 expect(session.state.document).toBe(before);
});

it('solves arc tangency from either side and resolves reference chains independently of order',()=>{
 const points:OutlineSolveRequest['points']=[[0,0],[10,0],[16,2],[20,10],[20,20],[0,20]];
 const seed=[0,.1,.1,0,0,0];
 const first={kind:'tangent' as const,edge:1,other:0},second={kind:'arc-tangent' as const,edge:2,other:1};
 const solved=outlineBulgesForCurves(points,seed,[second,first])!;
 expect(solved).toEqual(outlineBulgesForCurves(points,seed,[first,second]));
 const a=sketchBulgeArc(points[1],points[2],solved[1])!,b=sketchBulgeArc(points[2],points[3],solved[2])!;
 expect(a.radius).toBeCloseTo(10,10);
 expect(b.radius).toBeCloseTo(10,10);
 expect(a.start+a.sweep).toBeCloseTo(b.start,10);
 const reverse=outlineBulgesForCurves(points,solved,[{...second,edge:1,other:2}])!;
 expect(reverse[1]).toBeCloseTo(solved[1],12);
 expect(()=>outlineBulgesForCurves(points,seed,[second,{...second,edge:1,other:2}])).toThrow('cannot contain a cycle');
 expect(()=>outlineBulgesForCurves(points,[0,0,.1,0,0,0],[second])).toThrow('adjoining arc');
});

it('updates a dependent arc when its reference radius changes and preserves the relation through serialization and Undo',async()=>{
 const session=createCadSession();
 session.setParametric(dimensions('10'));
 const points:OutlineSolveRequest['points']=[[0,0],[10,0],[16,2],[20,10],[20,20],[0,20]];
 const rules=[{kind:'radius' as const,edge:1,radius:10,sweep:'ccw-minor' as const},{kind:'arc-tangent' as const,edge:2,other:1}];
 session.addSketchExtrusion({kind:'outline',id:'compound',points,vertexIds:['a','b','c','d','e','f'],
  bulges:outlineBulgesForCurves(points,undefined,rules),relations:[
   {kind:'radius',edge:['b','c'],radius:'span',sweep:'ccw-minor'},
   {kind:'arc-tangent',edge:['c','d'],other:['b','c']}
  ]});
 const before=session.state.document;
 expect(before.version).toBe(34);
 expect(parseDocument(session.serialize())).toEqual(before);
 expect(()=>validateDocument({...before,version:33})).toThrow('version 34');
 const unexpected=async()=>{throw Error('curve constraints do not require a chord worker');};
 await session.setParametricWithOutlineSolve(dimensions('12'),unexpected,signal());
 const saved=Object.values(session.state.document.sketches!)[0].profile as SketchOutlineProfile;
 const a=sketchBulgeArc(points[1],points[2],saved.bulges![1])!,b=sketchBulgeArc(points[2],points[3],saved.bulges![2])!;
 expect(a.radius).toBeCloseTo(12,10);
 expect(b.radius).not.toBeCloseTo(10);
 expect(a.start+a.sweep).toBeCloseTo(b.start,10);
 expect(saved.points).toEqual(points);
 session.undo();
 expect(session.state.document).toBe(before);
});
