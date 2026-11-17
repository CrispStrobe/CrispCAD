// SPDX-License-Identifier: BSD-3-Clause
import {beforeAll,expect,it} from 'vitest';
import {Vector3,Quaternion} from 'three';
import {readFileSync} from 'node:fs';
import initJolt from 'jolt-physics/debug-wasm-compat';
import {createGeometryKernel,exportSTL,checkModelLibrarySTL} from '@brickwright/cad-geometry';
import type {GeometryKernel} from '@brickwright/cad-geometry';
import {createCadSession,parseDocument,serializeDocument,localToWorldPoint,rotatePoint} from '@brickwright/cad-core';
import {createPhysicsWorld,prepareDocumentCollisions} from '../packages/physics/src/index.js';
import {createQuasarPressDocument,createQuasarPressPart,quasarPressPartPrograms,QUASAR_PRESS_ID} from '../packages/editor/src/quasar-press.js';
import type {QuasarPressPart} from '../packages/editor/src/quasar-press.js';
import {createPresetDocument,shapeCatalog} from '../packages/editor/src/shapes.js';

let kernel:GeometryKernel,J:Awaited<ReturnType<typeof initJolt>>;
beforeAll(async()=>{
 kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});
 J=await initJolt();
});

it('ships an editable A/B/C rotary press with dial servo, ram slider, ejector wiper, and blank',()=>{
 const doc=parseDocument(serializeDocument(createPresetDocument(QUASAR_PRESS_ID)));
 expect(shapeCatalog.some(p=>p.id===QUASAR_PRESS_ID&&p.category==='Robots')).toBe(true);
 expect(doc.simulation?.fixBase).toBe(true);
 expect(doc.nodes.stand.physics?.motion).toBe('static');
 expect(doc.nodes.blank.physics?.motion).toBe('dynamic');
 const hinges=doc.joints!.filter(j=>j.kind==='hinge'&&j.control);
 expect(hinges.map(j=>j.control?.port)).toEqual(['A']);
 expect(hinges.map(j=>j.bodyB)).toEqual(['dial-shaft']);
 const sliders=doc.joints!.filter(j=>j.kind==='slider'&&j.control);
 expect(sliders.map(j=>j.control?.port)).toEqual(['B','C']);
 expect(sliders.map(j=>j.bodyB)).toEqual(['ram','wiper']);
 for(const joint of [...hinges,...sliders])expect(joint.limits).toHaveLength(2);
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
 const printDoc=createPresetDocument('robot-quasar-press-print');
 expect(printDoc.provenance).toBeUndefined();
 expect(printDoc.joints).toBeUndefined();
 expect(printDoc.roots).toEqual(['stand','dial-plate','ram','wiper','blank']);
 const session=createCadSession();
 session.insert(createQuasarPressDocument());
 expect(session.state.document.simulation?.fixBase).toBe(true);
 session.undo();
 expect(session.state.document.roots).toHaveLength(0);
 session.redo();
 expect(session.state.document.roots).toHaveLength(7);
 session.dispose();
});

for(const part of Object.keys(quasarPressPartPrograms) as QuasarPressPart[]){
 it(`${part}: closed positive STL on the bed, within a 180 mm printer envelope`,async()=>{
  const doc=createQuasarPressPart(part);
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

it('indexes a real blank under the raised ram and ejects it clear of the dial',async()=>{
 const doc=createQuasarPressDocument(),geometry=kernel.evaluate(doc);
 const prepared=await prepareDocumentCollisions(doc,geometry,kernel);
 const world=await createPhysicsWorld(doc,geometry,prepared,{J,ground:true});
 const advance=(seconds:number)=>{for(let i=0;i<seconds/.005;i++){world.setHingeServo('dial-a',Math.min(Math.PI/2,world.time*Math.PI/3),.35);world.step(.005);}};
 const blankCenter=()=>{const pose=world.pose('blank');return new Vector3(0,-20,46.2).applyQuaternion(new Quaternion(...pose.quaternion)).add(new Vector3(...pose.positionMm)).toArray();};
 try{
  world.setSliderMotor('ram-b',20,.2);advance(3);
  expect(world.hingeAngle('dial-a')*180/Math.PI).toBeCloseTo(90,0);
  const indexed=blankCenter();
  expect(indexed[0]).toBeGreaterThan(12);expect(Math.abs(indexed[1])).toBeLessThan(10);
  world.setSliderMotor('ram-b',-20,.1);advance(1);
  expect(world.sliderPosition('ram-b')).toBeLessThan(-3);
  expect(world.sliderPosition('ram-b')).toBeGreaterThan(-6); // contact stops the rigid ram before it intersects the blank
  world.setSliderMotor('ram-b',20,.2);advance(1);
  expect(world.sliderPosition('ram-b')).toBeGreaterThan(0);
  world.setSliderMotor('ram-b',0,.2);
  world.setSliderMotor('eject-c',60,.05);advance(2);
  expect(world.sliderPosition('eject-c')).toBeGreaterThan(60);
  world.setSliderMotor('eject-c',-60,.05);advance(2);
  world.setSliderMotor('eject-c',0,.05);advance(.5);
  expect(Math.abs(world.sliderPosition('eject-c'))).toBeLessThan(1);
  expect(blankCenter()[0]).toBeGreaterThan(25);
  expect(blankCenter()[2]).toBeLessThan(20); // off the dial and down on the work surface
  expect(blankCenter()[2]).toBeGreaterThan(5);
 }finally{world.dispose();}
},420000);
