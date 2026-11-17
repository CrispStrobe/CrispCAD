// SPDX-License-Identifier: BSD-3-Clause
import {beforeAll,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import initJolt from 'jolt-physics/debug-wasm-compat';
import {createGeometryKernel,exportSTL,checkModelLibrarySTL} from '@brickwright/cad-geometry';
import type {GeometryKernel} from '@brickwright/cad-geometry';
import {createCadSession,parseDocument,serializeDocument,localToWorldPoint,rotatePoint} from '@brickwright/cad-core';
import {createPhysicsWorld,prepareDocumentCollisions} from '../packages/physics/src/index.js';
import {createNovaLoaderDocument,createNovaLoaderPart,novaLoaderPartPrograms,NOVA_LOADER_ID} from '../packages/editor/src/nova-loader.js';
import type {NovaLoaderPart} from '../packages/editor/src/nova-loader.js';
import {createPresetDocument,shapeCatalog} from '../packages/editor/src/shapes.js';

let kernel:GeometryKernel,J:Awaited<ReturnType<typeof initJolt>>;
beforeAll(async()=>{
 kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});
 J=await initJolt();
});

it('ships an editable A/B/C differential loader with drive wheels, tilting bucket, and payload',()=>{
 const doc=parseDocument(serializeDocument(createPresetDocument(NOVA_LOADER_ID)));
 expect(shapeCatalog.some(p=>p.id===NOVA_LOADER_ID&&p.category==='Robots')).toBe(true);
 expect(doc.simulation?.fixBase).toBe(false);
 expect(doc.nodes.chassis.physics?.motion).toBe('dynamic');
 expect(doc.nodes.payload.physics?.motion).toBe('dynamic');
 const hinges=doc.joints!.filter(j=>j.kind==='hinge'&&j.control);
 expect(hinges.map(j=>j.control?.port)).toEqual(['A','B','C']);
 expect(hinges.map(j=>j.bodyB)).toEqual(['left-wheel','right-wheel','bucket-shaft']);
 expect(hinges[0].limits).toBeUndefined();
 expect(hinges[1].limits).toBeUndefined();
 expect(hinges[2].limits).toHaveLength(2);
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
 const printDoc=createPresetDocument('robot-nova-loader-print');
 expect(printDoc.provenance).toBeUndefined();
 expect(printDoc.joints).toBeUndefined();
 expect(printDoc.roots).toEqual(['chassis','left-wheel','right-wheel','bucket','payload']);
 const session=createCadSession();
 session.insert(createNovaLoaderDocument());
 expect(session.state.document.simulation?.fixBase).toBe(false);
 session.undo();
 expect(session.state.document.roots).toHaveLength(0);
 session.redo();
 expect(session.state.document.roots).toHaveLength(7);
 session.dispose();
});

for(const part of Object.keys(novaLoaderPartPrograms) as NovaLoaderPart[]){
 it(`${part}: closed positive STL on the bed, within a 180 mm printer envelope`,async()=>{
  const doc=createNovaLoaderPart(part);
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

it('drives wheels A/B, tilts bucket C, and pushes payload in Jolt physics simulation',async()=>{
 const doc=createNovaLoaderDocument();
 const geometry=kernel.evaluate(doc);
 const prepared=await prepareDocumentCollisions(doc,geometry,kernel);
 const world=await createPhysicsWorld(doc,geometry,prepared,{J,ground:true,groundFriction:.8,groundRestitution:.05});
 try{
  const c0=world.pose('chassis').positionMm;
  const p0=world.pose('payload').positionMm;

  world.setHingeMotor('drive-left-a',-8,.35);
  world.setHingeMotor('drive-right-b',-8,.35);
  world.setHingeMotor('bucket-c',3.5,.25);
  for(let i=0;i<150;i++)world.step(.005);

  const c1=world.pose('chassis').positionMm;
  const p1=world.pose('payload').positionMm;
  expect(Math.abs(world.hingeAngle('drive-left-a')*180/Math.PI)).toBeGreaterThan(20);
  expect(Math.abs(world.hingeAngle('drive-right-b')*180/Math.PI)).toBeGreaterThan(20);
  expect(Math.abs(world.hingeAngle('bucket-c')*180/Math.PI)).toBeGreaterThan(8);
  expect(Math.hypot(c1[0]-c0[0],c1[1]-c0[1])).toBeGreaterThan(5);
  expect(Math.hypot(p1[0]-p0[0],p1[1]-p0[1])).toBeGreaterThan(2);
 }finally{
  world.dispose();
 }
},420000);
