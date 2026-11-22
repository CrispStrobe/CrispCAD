import {readFileSync} from 'node:fs';
import {beforeAll,expect,it} from 'vitest';
import {compileModelSource,createCadSession,designGraph,generateModelSource,parseDocument,validateDocument} from '@brickwright/cad-core';
import {createGeometryKernel} from '@brickwright/cad-geometry';

let kernel:Awaited<ReturnType<typeof createGeometryKernel>>;
beforeAll(async()=>{kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});});
const rectangle={kind:'rectangle',id:'shaft-profile',width:10,depth:30} as const;

it('revolves a rectangular section into a shaft on all three sketch planes',()=>{
 for(const plane of ['XY','XZ','YZ'] as const){
  const session=createCadSession();
  session.addSketchRevolution(rectangle,{name:'Shaft',plane,angle:360});
  const body=kernel.evaluate(session.state.document).bodies[0];
  expect(body.volume/(Math.PI*100*30)).toBeCloseTo(1,3);
  expect(body.bounds.max.map((value,index)=>value-body.bounds.min[index])).toEqual(plane==='XY'?[20,30,20]:[20,20,30]);
  expect(body.bounds.min[plane==='YZ'?1:0]).toBeCloseTo(-15);
  expect(parseDocument(session.serialize())).toEqual(session.state.document);
 }
});

it('keeps sweep direction and the side of the original section for partial turns',()=>{
 for(const axisOffset of [-5,5])for(const angle of [-90,90]){
  const session=createCadSession();
  session.addSketchRevolution(rectangle,{name:'Sector',plane:'XZ',axisOffset,angle});
  const body=kernel.evaluate(session.state.document).bodies[0];
  expect(body.volume/(Math.PI*100*30/4)).toBeCloseTo(1,3);
  const positiveY=(axisOffset<0)===(angle>0);
  expect(body.bounds[positiveY?'min':'max'][1]).toBeCloseTo(0);
  expect(body.bounds[positiveY?'max':'min'][1]).toBeCloseTo(positiveY?10:-10);
 }
});

it('passes holes through the sketch kernel and creates a hollow detail when the axis is offset',()=>{
 const session=createCadSession();
 session.addSketchRevolution({kind:'region',id:'region-profile',loops:[
  {kind:'outline',id:'rim',points:[[5,0],[15,0],[15,10],[5,10]]},
  {kind:'circle',id:'void',center:[10,5],radius:2,segments:96}
 ]},{name:'Ring',plane:'XZ',angle:360,axisOffset:0});
 const body=kernel.evaluate(session.state.document).bodies[0];
 const expected=Math.PI*(15**2-5**2)*10-2*Math.PI*10*(Math.PI*2**2);
 expect(body.volume/expected).toBeCloseTo(1,3);
});

it('retains a shared sketch, and rejects an invalid crossing while preserving Undo and IDs',()=>{
 const session=createCadSession(),sketch=session.addSketch(rectangle,{plane:'XZ'});
 const extrusion=session.extrudeSketch(sketch,{distance:2});
 const id=session.revolveSketch(sketch,{angle:180}),saved=session.serialize(),revision=session.state.revision;
 expect(()=>session.editRevolution(id,{axisOffset:0,angle:90})).toThrow('one side');
 expect(()=>session.editRevolution(id,{angle:'10 mm'})).toThrow('deg');
 expect(session.state.revision).toBe(revision);
 const before=kernel.evaluate(session.state.document).bodies.find(body=>body.id===id)!.volume;
 session.editRevolution(id,{angle:90,sketch:{profile:{...rectangle,width:20}}});
 const bodies=kernel.evaluate(session.state.document).bodies;
 expect(bodies.find(body=>body.id===id)!.volume/before).toBeCloseTo(2);
 expect(bodies.find(body=>body.id===extrusion)!.volume).toBeCloseTo(1200);
 expect(session.state.document.nodes[id]).toMatchObject({sketchId:sketch,angle:90});
 session.undo();expect(session.serialize()).toBe(saved);
 const obsolete={...session.state.document,version:11};
 expect(()=>validateDocument(obsolete)).toThrow('version 12');
});

it('retains named dimensions through source, dependency ordering, duplicate and namespaced paste',()=>{
 const session=createCadSession();
 session.setParametric({version:1,parameters:{
  turn:{unit:'deg',expression:'180'},offset:{unit:'mm',expression:'-6'}
 },bindings:[]});
 const id=session.addSketchRevolution(rectangle,{name:'Linked shaft',plane:'XZ',angle:'turn',axisOffset:'offset'});
 const doc=session.state.document,node=doc.nodes[id];
 if(node.kind!=='revolution')throw Error('fixture');
 expect(designGraph(doc).find(entry=>entry.id===id)?.dependencies).toEqual(['sketch:'+node.sketchId,'parameter:turn','parameter:offset']);
 const source=generateModelSource(doc);
 expect(compileModelSource(source,doc).nodes[id]).toEqual(node);
 session.duplicate([id]);
 expect(session.state.document.nodes[session.state.selection[0]]).not.toMatchObject({sketchId:node.sketchId});
 const fragment=session.fragment([id]),host=createCadSession();
 host.setParametric({version:1,parameters:{turn:{unit:'deg',expression:'90'},offset:{unit:'mm',expression:'-20'}},bindings:[]});
 host.insert(fragment,[0,0,0],{mergeParameters:true});
 expect(host.state.document.nodes[host.state.selection[0]]).toMatchObject({kind:'revolution',angle:'turn_2',axisOffset:'offset_2'});
 expect(kernel.evaluate(host.state.document).volume).toBeCloseTo(kernel.evaluate(doc).volume);
});
