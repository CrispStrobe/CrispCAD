// SPDX-License-Identifier: BSD-3-Clause
import {beforeAll,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import initJolt from 'jolt-physics/debug-wasm-compat';
import {createGeometryKernel,exportSTL,checkModelLibrarySTL} from '@brickwright/cad-geometry';
import type {GeometryKernel} from '@brickwright/cad-geometry';
import {createCadSession,parseDocument,serializeDocument,localToWorldPoint,rotatePoint} from '@brickwright/cad-core';
import {createPhysicsWorld,prepareDocumentCollisions} from '../packages/physics/src/index.js';
import {createHeliosCatapultDocument,createHeliosCatapultPart,heliosCatapultPartPrograms,HELIOS_CATAPULT_ID} from '../packages/editor/src/helios-catapult.js';
import type {HeliosCatapultPart} from '../packages/editor/src/helios-catapult.js';
import {createPresetDocument,shapeCatalog} from '../packages/editor/src/shapes.js';

let kernel:GeometryKernel,J:Awaited<ReturnType<typeof initJolt>>;
beforeAll(async()=>{
 kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});
 J=await initJolt();
});

it('ships an editable A/B/C 3-servo turret catapult and swinging target gate with payload',()=>{
 const doc=parseDocument(serializeDocument(createPresetDocument(HELIOS_CATAPULT_ID)));
 expect(shapeCatalog.some(p=>p.id===HELIOS_CATAPULT_ID&&p.category==='Robots')).toBe(true);
 expect(doc.simulation?.fixBase).toBe(true);
 expect(doc.nodes.pedestal.physics?.motion).toBe('static');
 expect(doc.nodes['gate-base'].physics?.motion).toBe('static');
 expect(doc.nodes.payload.physics?.motion).toBe('dynamic');
 const drives=doc.joints!.filter(j=>j.kind==='hinge'&&j.control);
 expect(drives.map(j=>j.control?.port)).toEqual(['A','B','C']);
 expect(drives.map(j=>j.bodyB)).toEqual(['pan-shaft','throw-shaft','gate-shaft']);
 for(const joint of drives)expect(joint.limits).toHaveLength(2);
 for(const joint of doc.joints!){
  const a=doc.nodes[joint.bodyA].transform,b=doc.nodes[joint.bodyB].transform;
  const pa=localToWorldPoint(joint.anchorA,a),pb=localToWorldPoint(joint.anchorB,b);
  expect(Math.hypot(...pa.map((v,i)=>v-pb[i]))).toBeLessThan(1e-6);
  const aa=rotatePoint(joint.axisA,a.rotation),ab=rotatePoint(joint.axisB,b.rotation);
  expect(Math.hypot(...aa.map((v,i)=>v-ab[i]))).toBeLessThan(1e-6);
 }
 const provenance=doc.provenance!.records;
 expect(provenance).toHaveLength(3);
 expect(provenance[0].asset.licence.spdx).toBe('MIT');
});

it('separates manufacturing geometry from purchased hardware and imports in one history step',()=>{
 const printDoc=createPresetDocument('robot-helios-catapult-print');
 expect(printDoc.provenance).toBeUndefined();
 expect(printDoc.joints).toBeUndefined();
 expect(printDoc.roots).toEqual(['pedestal','turret','arm','gate-base','goalie','payload']);
 const session=createCadSession();
 session.insert(createHeliosCatapultDocument());
 expect(session.state.document.simulation?.fixBase).toBe(true);
 session.undo();
 expect(session.state.document.roots).toHaveLength(0);
 session.redo();
 expect(session.state.document.roots).toHaveLength(17);
 session.dispose();
});

for(const part of Object.keys(heliosCatapultPartPrograms) as HeliosCatapultPart[]){
 it(`${part}: closed positive STL on the bed, within a 180 mm printer envelope`,async()=>{
  const doc=createHeliosCatapultPart(part);
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

it('aims turret A, swings target gate C, and launches payload via throw servo B in Jolt physics',async()=>{
 const doc=createHeliosCatapultDocument();
 const geometry=kernel.evaluate(doc);
 const prepared=await prepareDocumentCollisions(doc,geometry,kernel);
 const world=await createPhysicsWorld(doc,geometry,prepared,{J,ground:true,groundFriction:.6,groundRestitution:.1});
 try{
  const payload0=world.pose('payload').positionMm;

  world.setHingeMotor('pan-a',1.5,.2);
  world.setHingeMotor('gate-c',-2.5,.2);
  world.setHingeMotor('throw-b',10.0,.4);
  for(let i=0;i<45;i++)world.step(.005);

  const payload1=world.pose('payload').positionMm;
  expect(Math.abs(world.hingeAngle('pan-a')*180/Math.PI)).toBeGreaterThan(5);
  expect(Math.abs(world.hingeAngle('gate-c')*180/Math.PI)).toBeGreaterThan(10);
  expect(world.hingeAngle('throw-b')*180/Math.PI).toBeGreaterThan(15);
  expect(Math.hypot(payload1[0]-payload0[0],payload1[1]-payload0[1])).toBeGreaterThan(15);
 }finally{
  world.dispose();
 }
},180000);
