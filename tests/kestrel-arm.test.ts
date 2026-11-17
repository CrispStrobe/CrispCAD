// SPDX-License-Identifier: BSD-3-Clause
import {beforeAll,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import initJolt from 'jolt-physics/debug-wasm-compat';
import {createGeometryKernel,exportSTL,checkModelLibrarySTL} from '@brickwright/cad-geometry';
import type {GeometryKernel} from '@brickwright/cad-geometry';
import {createCadSession,parseDocument,serializeDocument,localToWorldPoint,rotatePoint} from '@brickwright/cad-core';
import {createPhysicsWorld,prepareDocumentCollisions} from '../packages/physics/src/index.js';
import {createKestrelArmDocument,createKestrelArmPart,kestrelArmPartPrograms,KESTREL_ARM_ID} from '../packages/editor/src/kestrel-arm.js';
import type {KestrelArmPart} from '../packages/editor/src/kestrel-arm.js';
import {createPresetDocument,shapeCatalog} from '../packages/editor/src/shapes.js';

let kernel:GeometryKernel,J:Awaited<ReturnType<typeof initJolt>>;
beforeAll(async()=>{
 kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});
 J=await initJolt();
});

it('ships an editable A/B/C 3-servo arm with Adafruit 1143 servos and grounded pedestal',()=>{
 const doc=parseDocument(serializeDocument(createPresetDocument(KESTREL_ARM_ID)));
 expect(shapeCatalog.some(p=>p.id===KESTREL_ARM_ID&&p.category==='Robots')).toBe(true);
 expect(doc.simulation?.fixBase).toBe(true);
 expect(doc.nodes.pedestal.physics?.motion).toBe('static');
 expect(doc.nodes['cargo-cube'].physics?.motion).toBe('dynamic');
 const drives=doc.joints!.filter(j=>j.kind==='hinge'&&j.control);
 expect(drives.map(j=>j.control?.port)).toEqual(['A','B','C']);
 expect(drives.map(j=>j.bodyB)).toEqual(['yaw-shaft','lift-shaft','grip-shaft']);
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
 expect(provenance[0].asset.id).toBe('adafruit-micro-servo-1143');
 expect(provenance[0].asset.author).toBe('Adafruit Industries');
});

it('separates manufacturing geometry from purchased hardware and imports in one history step',()=>{
 const printDoc=createPresetDocument('robot-kestrel-arm-print');
 expect(printDoc.provenance).toBeUndefined();
 expect(printDoc.joints).toBeUndefined();
 expect(printDoc.roots).toEqual(['pedestal','turret','boom','jaw','cargo-cube']);
 const session=createCadSession();
 session.insert(createKestrelArmDocument());
 expect(session.state.document.joints!.length).toBeGreaterThanOrEqual(9);
 session.undo();
 expect(session.state.document.roots).toHaveLength(0);
 session.redo();
 expect(session.state.document.roots).toHaveLength(16);
 session.dispose();
});

for(const part of Object.keys(kestrelArmPartPrograms) as KestrelArmPart[]){
 it(`${part}: closed positive STL on the bed, within a 180 mm printer envelope`,async()=>{
  const doc=createKestrelArmPart(part);
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

it('actuates yaw A, lift B and gripper C independently in Jolt physics simulation',async()=>{
 const doc=createKestrelArmDocument();
 const geometry=kernel.evaluate(doc);
 const prepared=await prepareDocumentCollisions(doc,geometry,kernel);
 const world=await createPhysicsWorld(doc,geometry,prepared,{J,ground:true,groundFriction:.8,groundRestitution:.02});
 try{
  const base0=world.pose('pedestal').positionMm;

  world.setHingeMotor('yaw-a',1.5,.15);
  world.setHingeMotor('lift-b',-1.2,.15);
  world.setHingeMotor('grip-c',1.4,.15);
  for(let i=0;i<35;i++)world.step(.005);

  const base1=world.pose('pedestal').positionMm;
  expect(Math.hypot(base1[0]-base0[0],base1[1]-base0[1],base1[2]-base0[2])).toBeLessThan(1e-3);
  expect(Math.abs(world.hingeAngle('yaw-a')*180/Math.PI)).toBeGreaterThan(10);
  expect(Math.abs(world.hingeAngle('lift-b')*180/Math.PI)).toBeGreaterThan(8);
  expect(Math.abs(world.hingeAngle('grip-c')*180/Math.PI)).toBeGreaterThan(8);
 }finally{
  world.dispose();
 }
},360000);
