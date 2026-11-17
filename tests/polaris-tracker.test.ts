// SPDX-License-Identifier: BSD-3-Clause
import {beforeAll,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import initJolt from 'jolt-physics/debug-wasm-compat';
import {createGeometryKernel,exportSTL,checkModelLibrarySTL} from '@brickwright/cad-geometry';
import type {GeometryKernel} from '@brickwright/cad-geometry';
import {createCadSession,parseDocument,serializeDocument,localToWorldPoint,rotatePoint} from '@brickwright/cad-core';
import {createPhysicsWorld,prepareDocumentCollisions} from '../packages/physics/src/index.js';
import {createPolarisTrackerDocument,createPolarisTrackerPart,polarisTrackerPartPrograms,POLARIS_TRACKER_ID} from '../packages/editor/src/polaris-tracker.js';
import type {PolarisTrackerPart} from '../packages/editor/src/polaris-tracker.js';
import {createPresetDocument,shapeCatalog} from '../packages/editor/src/shapes.js';

let kernel:GeometryKernel,J:Awaited<ReturnType<typeof initJolt>>;
beforeAll(async()=>{
 kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});
 J=await initJolt();
});

it('ships an editable A/B/C pan-tilt-slide tracker with rail carriage, yoke, sensor pod, and beacon',()=>{
 const doc=parseDocument(serializeDocument(createPresetDocument(POLARIS_TRACKER_ID)));
 expect(shapeCatalog.some(p=>p.id===POLARIS_TRACKER_ID&&p.category==='Robots')).toBe(true);
 expect(doc.simulation?.fixBase).toBe(true);
 expect(doc.nodes['rail-base'].physics?.motion).toBe('static');
 expect(doc.nodes['beacon-target'].physics?.motion).toBe('dynamic');
 const sliders=doc.joints!.filter(j=>j.kind==='slider'&&j.control);
 expect(sliders.map(j=>j.control?.port)).toEqual(['A']);
 expect(sliders.map(j=>j.bodyB)).toEqual(['carriage']);
 const hinges=doc.joints!.filter(j=>j.kind==='hinge'&&j.control);
 expect(hinges.map(j=>j.control?.port)).toEqual(['B','C']);
 expect(hinges.map(j=>j.bodyB)).toEqual(['pan-shaft','tilt-shaft']);
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
 const printDoc=createPresetDocument('robot-polaris-tracker-print');
 expect(printDoc.provenance).toBeUndefined();
 expect(printDoc.joints).toBeUndefined();
 expect(printDoc.roots).toEqual(['rail-base','carriage','yoke','sensor-head','beacon-target']);
 const session=createCadSession();
 session.insert(createPolarisTrackerDocument());
 expect(session.state.document.simulation?.fixBase).toBe(true);
 session.undo();
 expect(session.state.document.roots).toHaveLength(0);
 session.redo();
 expect(session.state.document.roots).toHaveLength(9);
 session.dispose();
});

for(const part of Object.keys(polarisTrackerPartPrograms) as PolarisTrackerPart[]){
 it(`${part}: closed positive STL on the bed, within a 180 mm printer envelope`,async()=>{
  const doc=createPolarisTrackerPart(part);
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

it('slides rail A, pans B, tilts C, and knocks beacon target in Jolt physics simulation',async()=>{
 const doc=createPolarisTrackerDocument();
 const geometry=kernel.evaluate(doc);
 const prepared=await prepareDocumentCollisions(doc,geometry,kernel);
 const world=await createPhysicsWorld(doc,geometry,prepared,{J,ground:true,groundFriction:.6,groundRestitution:.05});
 try{
  const b0=world.pose('beacon-target').positionMm;

  world.setSliderMotor('rail-a',150,25);
  world.setHingeMotor('pan-b',4.0,.25);
  world.setHingeMotor('tilt-c',-4.0,.25);
  for(let i=0;i<30;i++)world.step(.005);

  const b1=world.pose('beacon-target').positionMm;
  expect(world.sliderPosition('rail-a')).toBeGreaterThan(10);
  expect(Math.abs(world.hingeAngle('pan-b')*180/Math.PI)).toBeGreaterThan(10);
  expect(Math.abs(world.hingeAngle('tilt-c')*180/Math.PI)).toBeGreaterThan(10);
  expect(Math.hypot(b1[0]-b0[0],b1[1]-b0[1],b1[2]-b0[2])).toBeGreaterThan(5);
 }finally{
  world.dispose();
 }
},420000);

// The short velocity-motor demonstration above does not exercise the coupled
// position loop. Keep both commanded axes settled through sustained rail drive.
it('settles coupled pan and tilt position servos during sustained rail actuation',async()=>{
 const doc=createPolarisTrackerDocument(),source=JSON.stringify(doc),geometry=kernel.evaluate(doc);
 const prepared=await prepareDocumentCollisions(doc,geometry,kernel);
 const world=await createPhysicsWorld(doc,geometry,prepared);let lateError=0;
 try{
  for(let i=0;i<1200;i++){
   world.applyJointImpulse('rail-a',.001);
   for(const id of ['pan-b','tilt-c'])world.setHingeServo(id,Math.PI/12,.35);
   world.step(.005);
   if(i>=1000)for(const id of ['pan-b','tilt-c'])lateError=Math.max(lateError,Math.abs(world.hingeAngle(id)*180/Math.PI-15));
  }
  expect(lateError).toBeLessThan(.5);
  expect(JSON.stringify(doc)).toBe(source);
 }finally{world.dispose();}
},60000);
