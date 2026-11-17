// SPDX-License-Identifier: BSD-3-Clause
import {beforeAll,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import initJolt from 'jolt-physics/debug-wasm-compat';
import {createGeometryKernel,exportSTL,checkModelLibrarySTL} from '@brickwright/cad-geometry';
import type {GeometryKernel} from '@brickwright/cad-geometry';
import {createCadSession,parseDocument,serializeDocument,localToWorldPoint,rotatePoint} from '@brickwright/cad-core';
import {createPhysicsWorld,prepareDocumentCollisions} from '../packages/physics/src/index.js';
import {createMantisWalkerDocument,createMantisWalkerPart,mantisWalkerPartPrograms,MANTIS_WALKER_ID} from '../packages/editor/src/mantis-walker.js';
import type {MantisWalkerPart} from '../packages/editor/src/mantis-walker.js';
import {createPresetDocument,shapeCatalog} from '../packages/editor/src/shapes.js';

let kernel:GeometryKernel,J:Awaited<ReturnType<typeof initJolt>>;
beforeAll(async()=>{
 kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});
 J=await initJolt();
});

it('ships an editable A/B/C 3-servo wheelless walker with Adafruit 1143 servos and electronics carrier',()=>{
 const doc=parseDocument(serializeDocument(createPresetDocument(MANTIS_WALKER_ID)));
 expect(shapeCatalog.some(p=>p.id===MANTIS_WALKER_ID&&p.category==='Robots')).toBe(true);
 expect(doc.simulation?.fixBase).toBe(false);
 expect(doc.simulation?.selfCollisions).toBe(false);
 const drives=doc.joints!.filter(j=>j.kind==='hinge'&&j.control);
 expect(drives.map(j=>j.control?.port)).toEqual(['A','B','C']);
 expect(drives.map(j=>j.bodyB)).toEqual(['left-hip-shaft','right-hip-shaft','roll-shaft']);
 for(const joint of drives)expect(joint.limits).toHaveLength(2);
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
 const printDoc=createPresetDocument('robot-mantis-walker-print');
 expect(printDoc.provenance).toBeUndefined();
 expect(printDoc.joints).toBeUndefined();
 expect(printDoc.roots).toEqual(['torso','left-leg','right-leg','pendulum','carrier']);
 const carrierDoc=createPresetDocument('robot-mantis-walker-carrier');
 expect(carrierDoc.provenance).toBeUndefined();
 expect(carrierDoc.roots).toEqual(['carrier']);
 const session=createCadSession();
 session.insert(createMantisWalkerDocument());
 expect(session.state.document.simulation?.fixBase).toBe(false);
 session.undo();
 expect(session.state.document.roots).toHaveLength(0);
 session.redo();
 expect(session.state.document.roots).toHaveLength(13);
 session.dispose();
});

for(const part of Object.keys(mantisWalkerPartPrograms) as MantisWalkerPart[]){
 it(`${part}: closed positive STL on the bed, within a 180 mm printer envelope`,async()=>{
  const doc=createMantisWalkerPart(part);
  const result=kernel.evaluate(doc);
  expect(result.bodies).toHaveLength(1);
  const body=result.bodies[0];
  expect(body.volume).toBeGreaterThan(0);
  expect(Math.abs(body.bounds.min[2])).toBeLessThan(1e-5);
  expect(body.bounds.max[0]-body.bounds.min[0]).toBeLessThanOrEqual(180);
  expect(body.bounds.max[1]-body.bounds.min[1]).toBeLessThanOrEqual(180);
  expect(body.bounds.max[2]-body.bounds.min[2]).toBeLessThanOrEqual(180);
  const stl=exportSTL(result.bodies);
  const screen=await checkModelLibrarySTL(stl,{checkedOn:'2026-11-17',toMillimetresZUp:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],maxExtentMm:180});
  expect(Object.values(screen.checks)).toEqual(['pass','pass','pass','pass']);
 });
}

it('walks using alternating hip servos A/B and roll pendulum C in Jolt physics',async()=>{
 const doc=createMantisWalkerDocument();
 const geometry=kernel.evaluate(doc);
 const prepared=await prepareDocumentCollisions(doc,geometry,kernel);
 const world=await createPhysicsWorld(doc,geometry,prepared,{J,ground:true,groundFriction:.9,groundRestitution:.02});
 try{
  const start=world.pose('torso').positionMm;

  // Phase 1: shift weight left (C+) and swing right legs forward (B+), push left legs back (A-).
  world.setHingeMotor('roll-c',4.5,.35);
  world.setHingeMotor('left-hip-a',-4.0,.35);
  world.setHingeMotor('right-hip-b',4.0,.35);
  for(let i=0;i<45;i++)world.step(.005);
  const rollAngle1=Math.abs(world.hingeAngle('roll-c')*180/Math.PI);
  const leftHip1=Math.abs(world.hingeAngle('left-hip-a')*180/Math.PI);
  const rightHip1=Math.abs(world.hingeAngle('right-hip-b')*180/Math.PI);

  // Phase 2: shift weight right (C-) and reverse leg rockers.
  world.setHingeMotor('roll-c',-4.5,.35);
  world.setHingeMotor('left-hip-a',4.0,.35);
  world.setHingeMotor('right-hip-b',-4.0,.35);
  for(let i=0;i<45;i++)world.step(.005);

  const end=world.pose('torso').positionMm;
  expect(rollAngle1).toBeGreaterThan(3);
  expect(leftHip1).toBeGreaterThan(5);
  expect(rightHip1).toBeGreaterThan(5);
  expect(Math.hypot(end[0]-start[0],end[1]-start[1])).toBeGreaterThan(3);
 }finally{
  world.dispose();
 }
},360000);
