// SPDX-License-Identifier: BSD-3-Clause
import {beforeAll,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import initJolt from 'jolt-physics/debug-wasm-compat';
import {createGeometryKernel,exportSTL,checkModelLibrarySTL} from '@brickwright/cad-geometry';
import type {GeometryKernel} from '@brickwright/cad-geometry';
import {createCadSession,parseDocument,serializeDocument,localToWorldPoint,rotatePoint} from '@brickwright/cad-core';
import {createPhysicsWorld,prepareDocumentCollisions} from '../packages/physics/src/index.js';
import {createCycloneSorterDocument,createCycloneSorterPart,cycloneSorterPartPrograms,CYCLONE_SORTER_ID} from '../packages/editor/src/cyclone-sorter.js';
import type {CycloneSorterPart} from '../packages/editor/src/cyclone-sorter.js';
import {createPresetDocument,shapeCatalog} from '../packages/editor/src/shapes.js';

let kernel:GeometryKernel,J:Awaited<ReturnType<typeof initJolt>>;
beforeAll(async()=>{
 kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});
 J=await initJolt();
});

it('ships an editable 2-axis XY gantry sorter with sliders A/B, servo C and dynamic pucks',()=>{
 const doc=parseDocument(serializeDocument(createPresetDocument(CYCLONE_SORTER_ID)));
 expect(shapeCatalog.some(p=>p.id===CYCLONE_SORTER_ID&&p.category==='Robots')).toBe(true);
 expect(doc.simulation?.fixBase).toBe(true);
 expect(doc.nodes.frame.physics?.motion).toBe('static');
 expect(doc.nodes['puck-1'].physics?.motion).toBe('dynamic');
 const sliders=doc.joints!.filter(j=>j.kind==='slider'&&j.control);
 const hinges=doc.joints!.filter(j=>j.kind==='hinge'&&j.control);
 expect(sliders.map(j=>j.control?.port)).toEqual(['A','B']);
 expect(hinges.map(j=>j.control?.port)).toEqual(['C']);
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
 const printDoc=createPresetDocument('robot-cyclone-sorter-print');
 expect(printDoc.provenance).toBeUndefined();
 expect(printDoc.joints).toBeUndefined();
 expect(printDoc.roots).toEqual(['frame','bridge','shuttle','paddle','puck-1','puck-2']);
 const session=createCadSession();
 session.insert(createCycloneSorterDocument());
 expect(session.state.document.simulation?.fixBase).toBe(true);
 session.undo();
 expect(session.state.document.roots).toHaveLength(0);
 session.redo();
 expect(session.state.document.roots).toHaveLength(8);
 session.dispose();
});

for(const part of Object.keys(cycloneSorterPartPrograms) as CycloneSorterPart[]){
 it(`${part}: closed positive STL on the bed, within a 180 mm printer envelope`,async()=>{
  const doc=createCycloneSorterPart(part);
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

it('positions gantry A/B and sweeps puck-1 with servo C in Jolt physics simulation',async()=>{
 const doc=createCycloneSorterDocument();
 const geometry=kernel.evaluate(doc);
 const prepared=await prepareDocumentCollisions(doc,geometry,kernel);
 const world=await createPhysicsWorld(doc,geometry,prepared,{J,ground:true,groundFriction:.25,groundRestitution:.05});
 try{
  const puck0=world.pose('puck-1').positionMm;

  world.setSliderMotor('gantry-a',80,15);
  world.setSliderMotor('gantry-b',120,15);
  world.setHingeMotor('sweeper-c',3.5,.2);
  for(let i=0;i<50;i++)world.step(.005);

  const puck1=world.pose('puck-1').positionMm;
  expect(world.sliderPosition('gantry-a')).toBeGreaterThan(5);
  expect(world.sliderPosition('gantry-b')).toBeGreaterThan(5);
  expect(Math.abs(world.hingeAngle('sweeper-c')*180/Math.PI)).toBeGreaterThan(10);
  expect(Math.hypot(puck1[0]-puck0[0],puck1[1]-puck0[1])).toBeGreaterThan(5);
 }finally{
  world.dispose();
 }
},30000);
