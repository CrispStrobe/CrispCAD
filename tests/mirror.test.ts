import {readFileSync} from 'node:fs';
import {beforeAll,expect,it} from 'vitest';
import {compileModelSource,createCadSession,designGraph,generateModelSource,parseDocument,validateDocument} from '@brickwright/cad-core';
import {createGeometryKernel} from '@brickwright/cad-geometry';

let kernel:Awaited<ReturnType<typeof createGeometryKernel>>;
beforeAll(async()=>{kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});});

it('reflects the transformed asymmetric source about each offset plane without changing volume',()=>{
 for(const [axis,plane] of (['YZ','XZ','XY'] as const).entries()){
  const session=createCadSession();
  const source=session.addSketchExtrusion({kind:'outline',id:'bracket',points:[[1,0],[7,0],[7,3],[3,3],[3,5],[1,5]]},{distance:3});
  const transform=structuredClone(session.state.document.nodes[source].transform);
  transform.position=[7,12,3];transform.rotation=[18,24,10];transform.scale=[1,1.5,2];
  session.transform([{id:source,transform}]);
  const original=kernel.evaluate(session.state.document).bodies[0];
  const id=session.mirrorBody(source,{plane,offset:2.5});
  const mirrored=kernel.evaluate(session.state.document).bodies[0];
  expect(mirrored.id).toBe(id);
  expect(mirrored.volume).toBeCloseTo(original.volume);
  for(let i=0;i<3;i++){
   expect(mirrored.bounds.min[i]).toBeCloseTo(i===axis?5-original.bounds.max[i]:original.bounds.min[i]);
   expect(mirrored.bounds.max[i]).toBeCloseTo(i===axis?5-original.bounds.min[i]:original.bounds.max[i]);
  }
 }
});

it('retains a live source, edits nested mirrors, and preserves undo, document versions, and model source',()=>{
 const session=createCadSession();
 const part=session.add({kind:'box',size:[6,8,10]});
 const id=session.mirrorBody(part,{plane:'YZ',offset:0});
 const other=session.add({kind:'box',size:[3,4,5]});
 const combined=session.combine('union',[id,other]);
 const before=session.serialize(),beforeRevision=session.state.revision;
 expect(()=>session.editMirror(id,{plane:'YZ',offset:'10 deg'})).toThrow('mm');
 expect(session.state.revision).toBe(beforeRevision);
 session.editMirror(id,{plane:'XZ',offset:20});
 expect(kernel.evaluate(session.state.document).bodies[0].bounds.max[1]).toBeCloseTo(44);
 session.update(part,{size:[6,12,10]});
 expect(kernel.evaluate(session.state.document).bodies[0].bounds.max[1]).toBeCloseTo(46);
 session.undo();session.undo();expect(session.serialize()).toBe(before);
 const study=session.addSketchRevolution({kind:'rectangle',id:'profile',width:10,depth:4},{name:'shaft',plane:'XZ',angle:360});
 session.addTracer(study,[0,0,1]);
 expect(session.state.document.version).toBe(13);
 const doc=parseDocument(session.serialize());
 expect(doc.nodes[id]).toMatchObject({source:part,plane:'YZ',offset:0});
 expect(compileModelSource(generateModelSource(doc),doc).nodes).toEqual(doc.nodes);
 expect(designGraph(doc).find(item=>item.id===combined)?.dependencies).toEqual(['feature:'+id,'feature:'+other]);
 const cyclic=structuredClone(doc),mirror=cyclic.nodes[id];
 if(mirror.kind!=='mirror')throw Error('fixture');
 mirror.source=combined;
 expect(()=>validateDocument(cyclic)).toThrow('cyclic');
});

it('retains source identities and formulas through fragments, insertion, and independent duplication',()=>{
 const session=createCadSession();
 session.setParametric({version:1,parameters:{center:{expression:'10',unit:'mm'}},bindings:[]});
 const part=session.add({kind:'box',size:[6,8,10]});
 const id=session.mirrorBody(part,{plane:'YZ',offset:'center'});
 const source=session.fragment([id]);
 const host=createCadSession();
 host.setParametric({version:1,parameters:{center:{expression:'30',unit:'mm'}},bindings:[]});
 host.insert(source,[4,0,0],{mergeParameters:true});
 const [pasted]=host.state.selection;
 const copy=host.state.document.nodes[pasted];
 expect(copy).toMatchObject({offset:'center_2'});
 if(copy.kind!=='mirror')throw Error('fixture');
 expect(copy.source).not.toBe(part);
 expect(kernel.evaluate(host.state.document).bodies[0].bounds.min[0]).toBe(21);
 host.duplicate([pasted]);
 expect(host.state.document.nodes[host.state.selection[0]]).not.toMatchObject({source:copy.source});
 host.remove([pasted]);
 expect(host.state.document.nodes[copy.source]).toBeUndefined();
 expect(kernel.evaluate(host.state.document).bodies[0].bounds.min[0]).toBe(31);
});

it('rejects consuming a connected body or tracer, and keeps hole roles',()=>{
 const session=createCadSession();
 const body=session.add({kind:'box',size:[6,8,10]});
 const other=session.add({kind:'box',size:[6,8,10]});
 session.addJoint('fixed',body,other,[0,0,5],[0,0,1]);
 expect(()=>session.mirrorBody(body,{plane:'XY',offset:0})).toThrow('Detach');
 session.detachJoints([body]);
 const tracer=session.addTracer(body,[1,0,0]);
 expect(()=>session.mirrorBody(body,{plane:'XY',offset:0})).toThrow('tracers');
 session.removeTracer(tracer);
 session.setRole('hole',[body]);
 const mirrored=session.mirrorBody(body,{plane:'XY',offset:0});
 expect(session.state.document.nodes[mirrored]).toMatchObject({role:'hole'});
});
