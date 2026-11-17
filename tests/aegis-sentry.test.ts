// SPDX-License-Identifier: BSD-3-Clause
import {beforeAll,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import initJolt from 'jolt-physics/debug-wasm-compat';
import {createGeometryKernel,exportSTL,checkModelLibrarySTL} from '@brickwright/cad-geometry';
import type {GeometryKernel} from '@brickwright/cad-geometry';
import {createCadSession,parseDocument,serializeDocument,localToWorldPoint,rotatePoint} from '@brickwright/cad-core';
import {createPhysicsWorld,prepareDocumentCollisions} from '../packages/physics/src/index.js';
import {createAegisSentryDocument,createAegisSentryPart,aegisSentryPartPrograms,AEGIS_SENTRY_ID} from '../packages/editor/src/aegis-sentry.js';
import type {AegisSentryPart} from '../packages/editor/src/aegis-sentry.js';
import {createPresetDocument,shapeCatalog} from '../packages/editor/src/shapes.js';

let kernel:GeometryKernel,J:Awaited<ReturnType<typeof initJolt>>;
beforeAll(async()=>{
 kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});
 J=await initJolt();
});

it('ships an editable A/B/C sentry gate with sweep boom, sliding gate, latch arm, and pod',()=>{
 const doc=parseDocument(serializeDocument(createPresetDocument(AEGIS_SENTRY_ID)));
 expect(shapeCatalog.some(p=>p.id===AEGIS_SENTRY_ID&&p.category==='Robots')).toBe(true);
 expect(doc.simulation?.fixBase).toBe(true);
 expect(doc.nodes.outpost.physics?.motion).toBe('static');
 expect(doc.nodes.pod.physics?.motion).toBe('dynamic');
 const hinges=doc.joints!.filter(j=>j.kind==='hinge'&&j.control);
 expect(hinges.map(j=>j.control?.port)).toEqual(['A','C']);
 expect(hinges.map(j=>j.bodyB)).toEqual(['sweep-shaft','latch-shaft']);
 const sliders=doc.joints!.filter(j=>j.kind==='slider'&&j.control);
 expect(sliders.map(j=>j.control?.port)).toEqual(['B']);
 expect(sliders.map(j=>j.bodyB)).toEqual(['gate-bar']);
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
 const printDoc=createPresetDocument('robot-aegis-sentry-print');
 expect(printDoc.provenance).toBeUndefined();
 expect(printDoc.joints).toBeUndefined();
 expect(printDoc.roots).toEqual(['outpost','sweep-boom','gate-bar','latch','pod']);
 const session=createCadSession();
 session.insert(createAegisSentryDocument());
 expect(session.state.document.simulation?.fixBase).toBe(true);
 session.undo();
 expect(session.state.document.roots).toHaveLength(0);
 session.redo();
 expect(session.state.document.roots).toHaveLength(15);
 session.dispose();
});

for(const part of Object.keys(aegisSentryPartPrograms) as AegisSentryPart[]){
 it(`${part}: closed positive STL on the bed, within a 180 mm printer envelope`,async()=>{
  const doc=createAegisSentryPart(part);
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

it('swings sweep A, drives gate B, swings latch C, and sweeps pod in Jolt physics simulation',async()=>{
 const doc=createAegisSentryDocument();
 const geometry=kernel.evaluate(doc);
 const prepared=await prepareDocumentCollisions(doc,geometry,kernel);
 const world=await createPhysicsWorld(doc,geometry,prepared,{J,ground:true,groundFriction:.6,groundRestitution:.05});
 try{
  const p0=world.pose('pod').positionMm;

  world.setHingeMotor('sweep-a',4.5,.25);
  world.setSliderMotor('gate-b',160,25);
  world.setHingeMotor('latch-c',-4.0,.25);
  for(let i=0;i<45;i++)world.step(.005);

  const p1=world.pose('pod').positionMm;
  expect(Math.abs(world.hingeAngle('sweep-a')*180/Math.PI)).toBeGreaterThan(10);
  expect(world.sliderPosition('gate-b')).toBeGreaterThan(10);
  expect(Math.abs(world.hingeAngle('latch-c')*180/Math.PI)).toBeGreaterThan(10);
  expect(Math.hypot(p1[0]-p0[0],p1[1]-p0[1])).toBeGreaterThan(5);
 }finally{
  world.dispose();
 }
},420000);
