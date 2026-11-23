// SPDX-License-Identifier: BSD-3-Clause
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';
import {describe,expect,it} from 'vitest';
import {compileModelSource,createCadSession,designGraph,generateModelSource,outlineBulgesForCurves,outlineBulgesForRadii,parseDocument,rewriteSketchExpressions,sketchBulgeArc,trimSketchProfile,validateDocument} from '@brickwright/cad-core';
import type {SketchOutlineProfile,SketchProfile} from '@brickwright/cad-core';
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

it('retains independent boundary and cutout constraints and solves the entire region atomically',async()=>{
 const session=createCadSession();
 const design=(outer:string,hole:string)=>({version:1 as const,parameters:{
  outer:{unit:'mm' as const,expression:outer},hole:{unit:'mm' as const,expression:hole}
 },bindings:[]});
 const rectangle=(id:string,x:number,y:number,width:number,height:number):SketchOutlineProfile=>({
  kind:'outline',id,points:[[x,y],[x+width,y],[x+width,y+height],[x,y+height]],vertexIds:['a','b','c','d'],
  relations:[
   {kind:'horizontal',edge:['a','b']},{kind:'vertical',edge:['b','c']},
   {kind:'parallel',edge:['a','b'],other:['c','d']},{kind:'perpendicular',edge:['c','d'],other:['d','a']},
   {kind:'length',edge:['a','b'],length:id},{kind:'equal',edge:['a','b'],other:['c','d']},
   {kind:'length',edge:['b','c'],length:height}
  ]
 });
 const profile:Extract<SketchProfile,{kind:'region'}>={kind:'region',id:'plate',loops:[rectangle('outer',0,0,50,40),rectangle('hole',10,10,10,10)]};
 session.setParametric(design('50','10'));
 const body=session.addSketchExtrusion(profile),before=session.state.document,node=before.nodes[body];
 if(node.kind!=='extrusion')throw Error('fixture');
 const id=node.sketchId;
 expect(before.version).toBe(35);
 expect(()=>validateDocument({...before,version:34})).toThrow('version 35');
 expect(parseDocument(session.serialize())).toEqual(before);
 expect(designGraph(before).find(entry=>entry.key===`sketch:${id}`)?.dependencies.sort()).toEqual(['parameter:hole','parameter:outer']);
 const copied=structuredClone(before.sketches![id]);
 rewriteSketchExpressions(copied,expression=>expression==='hole'?'copiedHole':expression);
 expect(copied.profile).toMatchObject({loops:[profile.loops[0],{relations:expect.arrayContaining([{kind:'length',edge:['a','b'],length:'copiedHole'}])}]});
 expect(()=>trimSketchProfile(before.sketches![id],before,[5,0],[5,20],'left')).toThrow('Clear outline constraints');
 await session.setParametricWithOutlineSolve(design('60','15'),solve,signal());
 const after=session.state.document,updated=after.sketches![id].profile as typeof profile;
 expect(updated.loops.map(loop=>loop.kind==='outline'&&loop.points[1][0])).toEqual([60,25]);
 expect(updated.loops.map(loop=>loop.kind==='outline'&&loop.vertexIds)).toEqual([['a','b','c','d'],['a','b','c','d']]);
 await expect(session.setParametricWithOutlineSolve(design('65','90'),solve,signal())).rejects.toThrow('separate holes');
 expect(session.state.document).toBe(after);
 session.undo();
 expect(session.state.document).toBe(before);
 const draft=session.modelSource.replace('expression: "50"','expression: "65"').replace('expression: "10"','expression: "18"');
 const candidate=await session.prepareModelSourceWithOutlineSolve(draft,{},solve,signal());
 const fromSource=candidate.document.sketches![id].profile as typeof profile;
 expect(fromSource.loops.map(loop=>loop.kind==='outline'&&loop.points[1][0])).toEqual([65,28]);
});

it('preflights the solved source region when a growing circular cutout needs a wider boundary',async()=>{
 const session=createCadSession();
 const design=dimensions('50','5');
 session.setParametric(design);
 const body=session.addSketchExtrusion({kind:'region',id:'plate',loops:[
  {...outline,id:'outside',points:[[0,0],[50,0],[50,40],[0,40]]},
  {kind:'circle',id:'hole',center:[42,20],radius:'unrelated',segments:64}
 ]});
 const before=session.state.document,node=before.nodes[body];
 if(node.kind!=='extrusion')throw Error('fixture');
 const source=session.modelSource;
 const wider=source.replace('expression: "50"','expression: "60"').replace('expression: "5"','expression: "9"');
 const solved=await session.prepareModelSourceWithOutlineSolve(wider,{},solve,signal());
 expect(session.state.document).toBe(before);
 const after=solved.document.sketches![node.sketchId].profile;
 expect(after.kind).toBe('region');
 if(after.kind!=='region'||after.loops[0].kind!=='outline')throw Error('fixture');
 expect(after.loops[0].points[1][0]).toBeCloseTo(60);
 expect(solved.document.parametric?.parameters.unrelated.expression).toBe('9');
 const collision=wider.replace('expression: "9"','expression: "30"');
 await expect(session.prepareModelSourceWithOutlineSolve(collision,{},solve,signal())).rejects.toThrow('separate holes');
 expect(session.state.document).toBe(before);
});

it('positions chained cutouts atomically, round-trips the dimensions, and preserves vertex identities',async()=>{
 const session=createCadSession();
 const design=(length:string)=>({version:1 as const,parameters:{pitch:{unit:'mm' as const,expression:length}},bindings:[]});
 session.setParametric(design('10'));
 const rectangle=(id:string,x:number,y:number,w:number,h:number):SketchOutlineProfile=>({
  kind:'outline',id,points:[[x,y],[x+w,y],[x+w,y+h],[x,y+h]],vertexIds:['a','b','c','d']
 });
 const profile:Extract<SketchProfile,{kind:'region'}>={kind:'region',id:'plate',
  loops:[rectangle('outer',0,0,70,40),rectangle('first',10,10,8,8),rectangle('second',30,10,8,8)],
  placements:[{target:'second',reference:'first',offset:[20,0]},{target:'first',reference:'outer',offset:['pitch',10]}]
 };
 const body=session.addSketchExtrusion(profile),before=session.state.document,node=before.nodes[body];
 if(node.kind!=='extrusion')throw Error('fixture');
 const id=node.sketchId;
 expect(before.version).toBe(36);
 expect(parseDocument(session.serialize())).toEqual(before);
 expect(()=>validateDocument({...before,version:35})).toThrow('version 36');
 expect(designGraph(before).find(entry=>entry.key===`sketch:${id}`)?.dependencies).toEqual(['parameter:pitch']);
 const copy=structuredClone(before.sketches![id]);
 rewriteSketchExpressions(copy,name=>name==='pitch'?'copiedPitch':name);
 expect(copy.profile).toMatchObject({placements:[profile.placements![0],{...profile.placements![1],offset:['copiedPitch',10]}]});
 expect(()=>trimSketchProfile(before.sketches![id],before,[5,0],[5,20],'left')).toThrow('Clear outline constraints');
 session.setParametric(design('25'));
 const after=session.state.document,moved=after.sketches![id].profile as typeof profile;
 expect(moved.loops).toEqual([profile.loops[0],rectangle('first',25,10,8,8),rectangle('second',45,10,8,8)]);
 expect(()=>session.setParametric(design('55'))).toThrow('separate holes');
 expect(session.state.document).toBe(after);
 session.undo();
 expect(session.state.document).toBe(before);
 const source=session.modelSource.replace('expression: "10"','expression: "35"');
 const prepared=await session.prepareModelSourceWithOutlineSolve(source,{},async()=>{throw Error('position requires no chord worker');},signal());
 expect(prepared.document.sketches![id].profile).toMatchObject({loops:[
  profile.loops[0],rectangle('first',35,10,8,8),rectangle('second',55,10,8,8)
 ]});
 const cycle={...profile,placements:[...profile.placements!,{target:'outer',reference:'second',offset:[0,10] as [number,number]}]};
 expect(()=>session.updateSketch(id,{profile:cycle})).toThrow('cannot contain a cycle');
 const duplicate={...profile,placements:[...profile.placements!,profile.placements![0]]};
 expect(()=>session.updateSketch(id,{profile:duplicate})).toThrow('only one position reference');
});

it('drives a cutout from an analytic arc midpoint to a closing-edge midpoint',async()=>{
 const session=createCadSession();
 session.setParametric({version:1,parameters:{pitch:{unit:'mm',expression:'5'}},bindings:[]});
 const profile:Extract<SketchProfile,{kind:'region'}>={kind:'region',id:'plate',loops:[
  {kind:'outline',id:'outer',points:[[0,0],[60,0],[60,40],[0,40]],bulges:[.2,0,0,0],vertexIds:['a','b','c','d']},
  {kind:'outline',id:'hole',points:[[10,10],[18,10],[18,18],[10,18]],vertexIds:['e','f','g','h']}
 ],placements:[{reference:'outer',referenceEdge:['a','b'],target:'hole',targetEdge:['h','e'],offset:['pitch',22]}]};
 const body=session.addSketchExtrusion(profile),before=session.state.document,node=before.nodes[body];
 if(node.kind!=='extrusion')throw Error('fixture');
 const id=node.sketchId;
 expect(before.version).toBe(37);
 const saved=before.sketches![id].profile as typeof profile;
 expect(saved.loops[1]).toMatchObject({points:[[35,12],[43,12],[43,20],[35,20]],vertexIds:['e','f','g','h']});
 expect(parseDocument(session.serialize())).toEqual(before);
 expect(()=>validateDocument({...before,version:36})).toThrow('version 37');
 const draft=session.modelSource.replace('bulges: [0.2,','bulges: [0.4,');
 const solved=await session.prepareModelSourceWithOutlineSolve(draft,{},async()=>{throw Error('placement is analytic');},signal());
 const moved=solved.document.sketches![id].profile as typeof profile;
 expect(moved.loops[1]).toMatchObject({points:[[35,6],[43,6],[43,14],[35,14]],vertexIds:['e','f','g','h']});
 expect(moved.placements).toEqual(saved.placements);
 const missing=structuredClone(saved);
 missing.placements![0].targetEdge=['h','f'];
 expect(()=>session.updateSketch(id,{profile:missing})).toThrow('missing edge');
 expect(session.state.document).toBe(before);
});

it('solves chained region edge matches from a parameter and rolls back an invalid result',async()=>{
 const session=createCadSession();
 const design=(width:string)=>({version:1 as const,parameters:{width:{unit:'mm' as const,expression:width}},bindings:[]});
 session.setParametric(design('10'));
 const rect=(id:string,x:number,y:number,w:number,h:number):SketchOutlineProfile=>({
  kind:'outline',id,points:[[x,y],[x+w,y],[x+w,y+h],[x,y+h]],vertexIds:['a','b','c','d']
 });
 const edge:['a','b']=['a','b'];
 const profile:Extract<SketchProfile,{kind:'region'}>={kind:'region',id:'plate',loops:[
  rect('boundary',0,0,100,60),
  {...rect('guide',10,10,10,10),relations:[{kind:'horizontal',edge},{kind:'length',edge,length:'width'}]},
  rect('middle',40,10,10,10),rect('last',70,10,10,10)
 ],edgeMatches:[
  {reference:'middle',referenceEdge:edge,target:'last',targetEdge:edge},
  {reference:'guide',referenceEdge:edge,target:'middle',targetEdge:edge}
 ]};
 const body=session.addSketchExtrusion(profile),before=session.state.document,node=before.nodes[body];
 if(node.kind!=='extrusion')throw Error('fixture');
 const id=node.sketchId;
 expect(before.version).toBe(38);
 expect(parseDocument(session.serialize())).toEqual(before);
 expect(()=>validateDocument({...before,version:37})).toThrow('version 38');
 expect(()=>trimSketchProfile(before.sketches![id],before,[5,0],[5,20],'left')).toThrow('Clear outline constraints');
 const lengths=(doc:typeof before)=>(doc.sketches![id].profile as typeof profile).loops.slice(1).map(loop=>{
  if(loop.kind!=='outline')throw Error('fixture');
  const [a,b]=loop.points;
  return Math.hypot(b[0]-a[0],b[1]-a[1]);
 });
 await session.setParametricWithOutlineSolve(design('15'),solve,signal());
 const after=session.state.document;
 lengths(after).forEach(length=>expect(length).toBeCloseTo(15,5));
 expect((after.sketches![id].profile as typeof profile).loops.slice(1).map(loop=>loop.kind==='outline'&&loop.vertexIds))
  .toEqual([['a','b','c','d'],['a','b','c','d'],['a','b','c','d']]);
 await expect(session.setParametricWithOutlineSolve(design('45'),solve,signal())).rejects.toThrow('separate holes');
 expect(session.state.document).toBe(after);
 session.undo();
 expect(session.state.document).toBe(before);
 const prepared=await session.prepareModelSourceWithOutlineSolve(session.modelSource.replace('expression: "10"','expression: "18"'),{},solve,signal());
 lengths(prepared.document).forEach(length=>expect(length).toBeCloseTo(18,5));
 const cyclic={...profile,edgeMatches:[...profile.edgeMatches!,{reference:'last',referenceEdge:edge,target:'guide',targetEdge:edge}]};
 expect(()=>session.updateSketch(id,{profile:cyclic})).toThrow('cannot contain a cycle');
 const curved=structuredClone(profile);
 const target=curved.loops[2] as SketchOutlineProfile;
 target.bulges=[.1,0,0,0];
 expect(()=>session.updateSketch(id,{profile:curved})).toThrow('straight edges');
});
