// SPDX-License-Identifier: BSD-3-Clause
import {beforeAll,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import initJolt from 'jolt-physics/debug-wasm-compat';
import {createGeometryKernel,exportSTL,checkModelLibrarySTL} from '@brickwright/cad-geometry';
import type {GeometryKernel} from '@brickwright/cad-geometry';
import {createCadSession,parseDocument,serializeDocument,localToWorldPoint,rotatePoint} from '@brickwright/cad-core';
import {createPhysicsWorld,prepareDocumentCollisions} from '../packages/physics/src/index.js';
import {createHermesCraneDocument,createHermesCranePart,hermesCranePartPrograms,HERMES_CRANE_ID} from '../packages/editor/src/hermes-crane.js';
import type {HermesCranePart} from '../packages/editor/src/hermes-crane.js';
import {createPresetDocument,shapeCatalog} from '../packages/editor/src/shapes.js';

let kernel:GeometryKernel,J:Awaited<ReturnType<typeof initJolt>>;
beforeAll(async()=>{
 kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});
 J=await initJolt();
});

it('ships an editable A/B/C bridge crane with trolley, hoist, swivel spreader, and cargo crate',()=>{
 const doc=parseDocument(serializeDocument(createPresetDocument(HERMES_CRANE_ID)));
 expect(shapeCatalog.some(p=>p.id===HERMES_CRANE_ID&&p.category==='Robots')).toBe(true);
 expect(doc.simulation?.fixBase).toBe(true);
 expect(doc.nodes.gantry.physics?.motion).toBe('static');
 expect(doc.nodes.crate.physics?.motion).toBe('dynamic');
 const sliders=doc.joints!.filter(j=>j.kind==='slider'&&j.control);
 expect(sliders.map(j=>j.control?.port)).toEqual(['A','B']);
 expect(sliders.map(j=>j.bodyB)).toEqual(['trolley','hook-bar']);
 const hinges=doc.joints!.filter(j=>j.kind==='hinge'&&j.control);
 expect(hinges.map(j=>j.control?.port)).toEqual(['C']);
 expect(hinges.map(j=>j.bodyB)).toEqual(['swivel-shaft']);
 for(const joint of [...sliders,...hinges])expect(joint.limits).toHaveLength(2);
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
 const printDoc=createPresetDocument('robot-hermes-crane-print');
 expect(printDoc.provenance).toBeUndefined();
 expect(printDoc.joints).toBeUndefined();
 expect(printDoc.roots).toEqual(['gantry','trolley','hook-bar','spreader','crate']);
 const session=createCadSession();
 session.insert(createHermesCraneDocument());
 expect(session.state.document.simulation?.fixBase).toBe(true);
 session.undo();
 expect(session.state.document.roots).toHaveLength(0);
 session.redo();
 expect(session.state.document.roots).toHaveLength(13);
 session.dispose();
});

for(const part of Object.keys(hermesCranePartPrograms) as HermesCranePart[]){
 it(`${part}: closed positive STL on the bed, within a 180 mm printer envelope`,async()=>{
  const doc=createHermesCranePart(part);
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

it('drives trolley A, lowers hoist B, swivels spreader C, and moves crate in Jolt physics simulation',async()=>{
 const doc=createHermesCraneDocument();
 const geometry=kernel.evaluate(doc);
 const prepared=await prepareDocumentCollisions(doc,geometry,kernel);
 const world=await createPhysicsWorld(doc,geometry,prepared,{J,ground:true,groundFriction:.6,groundRestitution:.05});
 try{
  const c0=world.pose('crate').positionMm;

  world.setSliderMotor('hoist-b',-120,25);
  for(let i=0;i<20;i++)world.step(.005);

  world.setSliderMotor('bridge-a',150,25);
  world.setHingeMotor('swivel-c',4.5,.25);
  for(let i=0;i<30;i++)world.step(.005);

  const c1=world.pose('crate').positionMm;
  expect(world.sliderPosition('bridge-a')).toBeGreaterThan(10);
  expect(world.sliderPosition('hoist-b')).toBeLessThan(-6);
  expect(Math.abs(world.hingeAngle('swivel-c')*180/Math.PI)).toBeGreaterThan(10);
  expect(Math.hypot(c1[0]-c0[0],c1[1]-c0[1])).toBeGreaterThan(5);
 }finally{
  world.dispose();
 }
},420000);
