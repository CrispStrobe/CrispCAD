// SPDX-License-Identifier: BSD-3-Clause
import {beforeAll,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import initJolt from 'jolt-physics/debug-wasm-compat';
import {createGeometryKernel,exportSTL,checkModelLibrarySTL} from '@brickwright/cad-geometry';
import type {GeometryKernel} from '@brickwright/cad-geometry';
import {createCadSession,parseDocument,serializeDocument,localToWorldPoint,rotatePoint} from '@brickwright/cad-core';
import {createPhysicsWorld,prepareDocumentCollisions} from '../packages/physics/src/index.js';
import {createZephyrConveyorDocument,createZephyrConveyorPart,zephyrConveyorPartPrograms,ZEPHYR_CONVEYOR_ID} from '../packages/editor/src/zephyr-conveyor.js';
import type {ZephyrConveyorPart} from '../packages/editor/src/zephyr-conveyor.js';
import {createPresetDocument,shapeCatalog} from '../packages/editor/src/shapes.js';

let kernel:GeometryKernel,J:Awaited<ReturnType<typeof initJolt>>;
beforeAll(async()=>{
 kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});
 J=await initJolt();
});

it('ships an editable A/B/C sorting conveyor with feed slider, paddle wheel, diverter, and parcel',()=>{
 const doc=parseDocument(serializeDocument(createPresetDocument(ZEPHYR_CONVEYOR_ID)));
 expect(shapeCatalog.some(p=>p.id===ZEPHYR_CONVEYOR_ID&&p.category==='Robots')).toBe(true);
 expect(doc.simulation?.fixBase).toBe(true);
 expect(doc.nodes.frame.physics?.motion).toBe('static');
 expect(doc.nodes.parcel.physics?.motion).toBe('dynamic');
 const sliders=doc.joints!.filter(j=>j.kind==='slider'&&j.control);
 expect(sliders.map(j=>j.control?.port)).toEqual(['A']);
 expect(sliders.map(j=>j.bodyB)).toEqual(['pusher']);
 expect(sliders[0].limits).toHaveLength(2);
 const hinges=doc.joints!.filter(j=>j.kind==='hinge'&&j.control);
 expect(hinges.map(j=>j.control?.port)).toEqual(['B','C']);
 expect(hinges.map(j=>j.bodyB)).toEqual(['paddle-wheel','gate-shaft']);
 expect(hinges[0].limits).toBeUndefined();
 expect(hinges[1].limits).toHaveLength(2);
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
 const printDoc=createPresetDocument('robot-zephyr-conveyor-print');
 expect(printDoc.provenance).toBeUndefined();
 expect(printDoc.joints).toBeUndefined();
 expect(printDoc.roots).toEqual(['frame','pusher','paddle-wheel','diverter','parcel']);
 const session=createCadSession();
 session.insert(createZephyrConveyorDocument());
 expect(session.state.document.simulation?.fixBase).toBe(true);
 session.undo();
 expect(session.state.document.roots).toHaveLength(0);
 session.redo();
 expect(session.state.document.roots).toHaveLength(7);
 session.dispose();
});

for(const part of Object.keys(zephyrConveyorPartPrograms) as ZephyrConveyorPart[]){
 it(`${part}: closed positive STL on the bed, within a 180 mm printer envelope`,async()=>{
  const doc=createZephyrConveyorPart(part);
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

it('drives feed A, spins paddle wheel B, swings gate C, and moves parcel in Jolt physics simulation',async()=>{
 const doc=createZephyrConveyorDocument();
 const geometry=kernel.evaluate(doc);
 const prepared=await prepareDocumentCollisions(doc,geometry,kernel);
 const world=await createPhysicsWorld(doc,geometry,prepared,{J,ground:true,groundFriction:.6,groundRestitution:.05});
 try{
  const p0=world.pose('parcel').positionMm;

  world.setSliderMotor('feed-a',220,30);
  world.setHingeMotor('roller-b',12,.25);
  world.setHingeMotor('gate-c',3.5,.25);
  for(let i=0;i<30;i++)world.step(.005);

  const p1=world.pose('parcel').positionMm;
  expect(world.sliderPosition('feed-a')).toBeGreaterThan(15);
  expect(Math.abs(world.hingeAngle('roller-b')*180/Math.PI)).toBeGreaterThan(25);
  expect(Math.abs(world.hingeAngle('gate-c')*180/Math.PI)).toBeGreaterThan(8);
  expect(p1[0]-p0[0]).toBeGreaterThan(10);
 }finally{
  world.dispose();
 }
},420000);
