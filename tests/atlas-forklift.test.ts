// SPDX-License-Identifier: BSD-3-Clause
import {beforeAll,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import initJolt from 'jolt-physics/debug-wasm-compat';
import {createGeometryKernel,exportSTL,checkModelLibrarySTL} from '@brickwright/cad-geometry';
import type {GeometryKernel} from '@brickwright/cad-geometry';
import {createCadSession,parseDocument,serializeDocument,localToWorldPoint,rotatePoint} from '@brickwright/cad-core';
import {createPhysicsWorld,prepareDocumentCollisions} from '../packages/physics/src/index.js';
import {createAtlasForkliftDocument,createAtlasForkliftPart,atlasForkliftPartPrograms,ATLAS_FORKLIFT_ID} from '../packages/editor/src/atlas-forklift.js';
import type {AtlasForkliftPart} from '../packages/editor/src/atlas-forklift.js';
import {createPresetDocument,shapeCatalog} from '../packages/editor/src/shapes.js';

let kernel:GeometryKernel,J:Awaited<ReturnType<typeof initJolt>>;
beforeAll(async()=>{
 kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});
 J=await initJolt();
});

it('ships an editable mobile forklift with TT drives (A/B), linear mast slider (A), and servo tilt (C)',()=>{
 const doc=parseDocument(serializeDocument(createPresetDocument(ATLAS_FORKLIFT_ID)));
 expect(shapeCatalog.some(p=>p.id===ATLAS_FORKLIFT_ID&&p.category==='Robots')).toBe(true);
 expect(doc.simulation?.fixBase).toBe(false);
 const hinges=doc.joints!.filter(j=>j.kind==='hinge'&&j.control);
 const sliders=doc.joints!.filter(j=>j.kind==='slider'&&j.control);
 expect(hinges.map(j=>j.control?.port)).toEqual(['A','B','C']);
 expect(hinges.map(j=>j.bodyB)).toEqual(['left-shaft','right-shaft','tilt-shaft']);
 expect(sliders.map(j=>j.control?.port)).toEqual(['D']);
 expect(sliders[0].limits).toEqual([0,48]);
 for(const joint of doc.joints!){
  const a=doc.nodes[joint.bodyA].transform,b=doc.nodes[joint.bodyB].transform;
  const pa=localToWorldPoint(joint.anchorA,a),pb=localToWorldPoint(joint.anchorB,b);
  expect(Math.hypot(...pa.map((v,i)=>v-pb[i]))).toBeLessThan(1e-6);
  const aa=rotatePoint(joint.axisA,a.rotation),ab=rotatePoint(joint.axisB,b.rotation);
  expect(Math.hypot(...aa.map((v,i)=>v-ab[i]))).toBeLessThan(1e-6);
 }
 const provenance=doc.provenance!.records;
 expect(provenance).toHaveLength(2);
 expect(provenance.every(r=>r.asset.licence.spdx==='MIT')).toBe(true);
});

it('separates manufacturing geometry from purchased hardware and imports in one history step',()=>{
 const printDoc=createPresetDocument('robot-atlas-forklift-print');
 expect(printDoc.provenance).toBeUndefined();
 expect(printDoc.joints).toBeUndefined();
 expect(printDoc.roots).toHaveLength(9);
 const session=createCadSession();
 session.insert(createAtlasForkliftDocument());
 expect(session.state.document.simulation?.fixBase).toBe(false);
 session.undo();
 expect(session.state.document.roots).toHaveLength(0);
 session.redo();
 expect(session.state.document.roots).toHaveLength(19);
 session.dispose();
});

for(const part of Object.keys(atlasForkliftPartPrograms) as AtlasForkliftPart[]){
 it(`${part}: closed positive STL on the bed, within a 180 mm printer envelope`,async()=>{
  const doc=createAtlasForkliftPart(part);
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

it('raises the pallet crate with slider A, tilts forks via servo C, and drives in Jolt physics',async()=>{
 const doc=createAtlasForkliftDocument();
 const geometry=kernel.evaluate(doc);
 const prepared=await prepareDocumentCollisions(doc,geometry,kernel);
 // Bound the contact work at the fork/crate interface. A BSP fallback here
 // previously passed geometry checks but made the live example stall.
 expect(prepared.get('forks')!.hulls.length*prepared.get('pallet-crate')!.hulls.length).toBeLessThanOrEqual(1000);
 for(const id of ['forks','pallet-crate'])expect(prepared.get(id)!.certificate.strategy).toBe('supplied');
 const world=await createPhysicsWorld(doc,geometry,prepared,{J,ground:true,groundFriction:.8,groundRestitution:.02});
 try{
  const crateZ0=world.pose('pallet-crate').positionMm[2];
  const chassisX0=world.pose('chassis').positionMm[0];

  world.setSliderMotor('lift-d',80,15);
  for(let i=0;i<80;i++)world.step(.005);

  const crateZ1=world.pose('pallet-crate').positionMm[2];
  expect(world.sliderPosition('lift-d')).toBeGreaterThan(8);
  expect(crateZ1-crateZ0).toBeGreaterThan(5);

  world.setHingeMotor('tilt-c',-1.2,.25);
  world.setHingeMotor('drive-a',5,.25);
  world.setHingeMotor('drive-b',5,.25);
  for(let i=0;i<40;i++)world.step(.005);

  const chassisX1=world.pose('chassis').positionMm[0];
  expect(Math.abs(world.hingeAngle('tilt-c')*180/Math.PI)).toBeGreaterThan(2);
  expect(chassisX1-chassisX0).toBeGreaterThan(5);
 }finally{
  world.dispose();
 }
},120000);
