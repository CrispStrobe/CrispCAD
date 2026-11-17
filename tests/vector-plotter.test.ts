// SPDX-License-Identifier: BSD-3-Clause
import {beforeAll,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import initJolt from 'jolt-physics/debug-wasm-compat';
import {createGeometryKernel,exportSTL,checkModelLibrarySTL} from '@brickwright/cad-geometry';
import type {GeometryKernel} from '@brickwright/cad-geometry';
import {createCadSession,parseDocument,serializeDocument,localToWorldPoint,rotatePoint} from '@brickwright/cad-core';
import {createPhysicsWorld,prepareDocumentCollisions} from '../packages/physics/src/index.js';
import {createVectorPlotterDocument,createVectorPlotterPart,vectorPlotterPartPrograms,VECTOR_PLOTTER_ID} from '../packages/editor/src/vector-plotter.js';
import type {VectorPlotterPart} from '../packages/editor/src/vector-plotter.js';
import {createPresetDocument,shapeCatalog} from '../packages/editor/src/shapes.js';

let kernel:GeometryKernel,J:Awaited<ReturnType<typeof initJolt>>;
beforeAll(async()=>{
 kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});
 J=await initJolt();
});

it('ships an editable A/B/C XY plotter with gantry sliders, stylus arm servo, and token',()=>{
 const doc=parseDocument(serializeDocument(createPresetDocument(VECTOR_PLOTTER_ID)));
 expect(shapeCatalog.some(p=>p.id===VECTOR_PLOTTER_ID&&p.category==='Robots')).toBe(true);
 expect(doc.simulation?.fixBase).toBe(true);
 expect(doc.nodes.frame.physics?.motion).toBe('static');
 expect(doc.nodes.token.physics?.motion).toBe('dynamic');
 const sliders=doc.joints!.filter(j=>j.kind==='slider'&&j.control);
 expect(sliders.map(j=>j.control?.port)).toEqual(['A','B']);
 expect(sliders.map(j=>j.bodyB)).toEqual(['bridge','carriage']);
 const hinges=doc.joints!.filter(j=>j.kind==='hinge'&&j.control);
 expect(hinges.map(j=>j.control?.port)).toEqual(['C']);
 expect(hinges.map(j=>j.bodyB)).toEqual(['pen-shaft']);
 for(const joint of [...sliders,...hinges])expect(joint.limits).toHaveLength(2);
 for(const joint of doc.joints!){
  const a=doc.nodes[joint.bodyA].transform,b=doc.nodes[joint.bodyB].transform;
  const pa=localToWorldPoint(joint.anchorA,a),pb=localToWorldPoint(joint.anchorB,b);
  expect(Math.hypot(...pa.map((v,i)=>v-pb[i]))).toBeLessThan(1e-6);
  const aa=rotatePoint(joint.axisA,a.rotation),ab=rotatePoint(joint.axisB,b.rotation);
  expect(Math.hypot(...aa.map((v,i)=>v-ab[i]))).toBeLessThan(1e-6);
 }
 const provenance=doc.provenance!.records;
 expect(provenance).toHaveLength(1);
 expect(provenance[0].asset.licence.spdx).toBe('MIT');
});

it('separates manufacturing geometry from purchased hardware and imports in one history step',()=>{
 const printDoc=createPresetDocument('robot-vector-plotter-print');
 expect(printDoc.provenance).toBeUndefined();
 expect(printDoc.joints).toBeUndefined();
 expect(printDoc.roots).toEqual(['frame','bridge','carriage','pen-arm','token']);
 const session=createCadSession();
 session.insert(createVectorPlotterDocument());
 expect(session.state.document.simulation?.fixBase).toBe(true);
 session.undo();
 expect(session.state.document.roots).toHaveLength(0);
 session.redo();
 expect(session.state.document.roots).toHaveLength(7);
 session.dispose();
});

for(const part of Object.keys(vectorPlotterPartPrograms) as VectorPlotterPart[]){
 it(`${part}: closed positive STL on the bed, within a 180 mm printer envelope`,async()=>{
  const doc=createVectorPlotterPart(part);
  const result=kernel.evaluate(doc);
  expect(result.bodies).toHaveLength(1);
  const body=result.bodies[0];
  expect(body.volume).toBeGreaterThan(0);
  expect(Math.abs(body.bounds.min[2])).toBeLessThan(1e-5);
  expect(body.bounds.max[0]-body.bounds.min[0]).toBeLessThanOrEqual(180);
  expect(body.bounds.max[1]-body.bounds.min[1]).toBeLessThanOrEqual(180);
  expect(body.bounds.max[2]-body.bounds.min[2]).toBeLessThanOrEqual(180);
  const stl=exportSTL(result.bodies);
  const screen=await checkModelLibrarySTL(stl,{checkedOn:'2026-11-16',toMillimetresZUp:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],maxExtentMm:180});
  expect(Object.values(screen.checks)).toEqual(['pass','pass','pass','pass']);
 });
}

it('drives Y gantry A, X carriage B, stylus servo C, and sweeps token in Jolt physics simulation',async()=>{
 const doc=createVectorPlotterDocument();
 const geometry=kernel.evaluate(doc);
 const prepared=await prepareDocumentCollisions(doc,geometry,kernel);
 const world=await createPhysicsWorld(doc,geometry,prepared,{J,ground:true,groundFriction:.6,groundRestitution:.05});
 try{
  const t0=world.pose('token').positionMm;

  world.setSliderMotor('y-axis-a',180,25);
  world.setSliderMotor('x-axis-b',120,25);
  world.setHingeMotor('pen-c',4.0,.25);
  for(let i=0;i<30;i++)world.step(.005);

  const t1=world.pose('token').positionMm;
  expect(world.sliderPosition('y-axis-a')).toBeGreaterThan(10);
  expect(world.sliderPosition('x-axis-b')).toBeGreaterThan(8);
  expect(Math.abs(world.hingeAngle('pen-c')*180/Math.PI)).toBeGreaterThan(8);
  expect(Math.hypot(t1[0]-t0[0],t1[1]-t0[1])).toBeGreaterThan(4);
 }finally{
  world.dispose();
 }
},420000);
