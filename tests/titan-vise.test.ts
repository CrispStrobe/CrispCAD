// SPDX-License-Identifier: BSD-3-Clause
import {beforeAll,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import initJolt from 'jolt-physics/debug-wasm-compat';
import {createGeometryKernel,exportSTL,checkModelLibrarySTL} from '@brickwright/cad-geometry';
import type {GeometryKernel} from '@brickwright/cad-geometry';
import {createCadSession,parseDocument,serializeDocument,localToWorldPoint,rotatePoint} from '@brickwright/cad-core';
import {createPhysicsWorld,prepareDocumentCollisions} from '../packages/physics/src/index.js';
import {createTitanViseDocument,createTitanVisePart,titanVisePartPrograms,TITAN_VISE_ID} from '../packages/editor/src/titan-vise.js';
import type {TitanVisePart} from '../packages/editor/src/titan-vise.js';
import {createPresetDocument,shapeCatalog} from '../packages/editor/src/shapes.js';

let kernel:GeometryKernel,J:Awaited<ReturnType<typeof initJolt>>;
beforeAll(async()=>{
 kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});
 J=await initJolt();
});

it('ships an editable A/B/C rotary vise with indexer servo, opposing jaw sliders, and workpiece',()=>{
 const doc=parseDocument(serializeDocument(createPresetDocument(TITAN_VISE_ID)));
 expect(shapeCatalog.some(p=>p.id===TITAN_VISE_ID&&p.category==='Robots')).toBe(true);
 expect(doc.simulation?.fixBase).toBe(true);
 expect(doc.nodes.base.physics?.motion).toBe('static');
 expect(doc.nodes.workpiece.physics?.motion).toBe('dynamic');
 const hinges=doc.joints!.filter(j=>j.kind==='hinge'&&j.control);
 expect(hinges.map(j=>j.control?.port)).toEqual(['A']);
 expect(hinges.map(j=>j.bodyB)).toEqual(['indexer-shaft']);
 const sliders=doc.joints!.filter(j=>j.kind==='slider'&&j.control);
 expect(sliders.map(j=>j.control?.port)).toEqual(['B','C']);
 expect(sliders.map(j=>j.bodyB)).toEqual(['jaw-left','jaw-right']);
 for(const joint of [...hinges,...sliders])expect(joint.limits).toHaveLength(2);
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
 const printDoc=createPresetDocument('robot-titan-vise-print');
 expect(printDoc.provenance).toBeUndefined();
 expect(printDoc.joints).toBeUndefined();
 expect(printDoc.roots).toEqual(['base','rotary-bed','jaw-left','jaw-right','workpiece']);
 const session=createCadSession();
 session.insert(createTitanViseDocument());
 expect(session.state.document.simulation?.fixBase).toBe(true);
 session.undo();
 expect(session.state.document.roots).toHaveLength(0);
 session.redo();
 expect(session.state.document.roots).toHaveLength(13);
 session.dispose();
});

for(const part of Object.keys(titanVisePartPrograms) as TitanVisePart[]){
 it(`${part}: closed positive STL on the bed, within a 180 mm printer envelope`,async()=>{
  const doc=createTitanVisePart(part);
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

it('rotates indexer A and clamps opposing jaws B/C onto workpiece in Jolt physics simulation',async()=>{
 const doc=createTitanViseDocument();
 const geometry=kernel.evaluate(doc);
 const prepared=await prepareDocumentCollisions(doc,geometry,kernel);
 const world=await createPhysicsWorld(doc,geometry,prepared,{J,ground:true,groundFriction:.6,groundRestitution:.05});
 try{
  world.setHingeMotor('indexer-a',4.5,.25);
  for(let i=0;i<20;i++)world.step(.005);

  world.setSliderMotor('jaw-left-b',120,25);
  world.setSliderMotor('jaw-right-c',120,25);
  for(let i=0;i<25;i++)world.step(.005);

  expect(Math.abs(world.hingeAngle('indexer-a')*180/Math.PI)).toBeGreaterThan(10);
  expect(world.sliderPosition('jaw-left-b')).toBeGreaterThan(8);
  expect(world.sliderPosition('jaw-right-c')).toBeGreaterThan(8);
  expect(world.pose('workpiece').positionMm[2]).toBeGreaterThan(-2);
 }finally{
  world.dispose();
 }
},420000);
