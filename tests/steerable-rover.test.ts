// SPDX-License-Identifier: BSD-3-Clause
import {beforeAll,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import initJolt from 'jolt-physics/debug-wasm-compat';
import {createGeometryKernel,exportSTL,checkModelLibrarySTL} from '@brickwright/cad-geometry';
import type {GeometryKernel} from '@brickwright/cad-geometry';
import {createCadSession,parseDocument,serializeDocument,localToWorldPoint,rotatePoint,validateModelLibraryCatalogue} from '@brickwright/cad-core';
import {createPhysicsWorld,prepareDocumentCollisions} from '../packages/physics/src/index.js';
import {createSteerableRoverDocument,createSteerableRoverPart,steerableRoverPartPrograms,steerableRoverPrintQuantities,STEERABLE_ROVER_ID} from '../packages/editor/src/steerable-rover.js';
import {createPresetDocument,shapeCatalog} from '../packages/editor/src/shapes.js';

let kernel:GeometryKernel,J:Awaited<ReturnType<typeof initJolt>>;
beforeAll(async()=>{
 kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});
 J=await initJolt();
});

it('ships an editable A/B/C steerable rover with TT drive motors, 1143 micro-servo and a free moving base',()=>{
 const doc=parseDocument(serializeDocument(createPresetDocument(STEERABLE_ROVER_ID)));
 expect(shapeCatalog.some(p=>p.id===STEERABLE_ROVER_ID&&p.category==='Robots')).toBe(true);
 expect(doc.simulation?.fixBase).toBe(false);
 const drives=doc.joints!.filter(j=>j.kind==='hinge'&&j.control);
 expect(drives.map(j=>j.control?.port)).toEqual(['A','B','C']);
 expect(drives.map(j=>j.bodyB)).toEqual(['left-shaft','right-shaft','steer-shaft']);
 const passive=doc.joints!.filter(j=>j.kind==='hinge'&&!j.control);
 expect(passive.map(j=>j.id)).toEqual(['front-wheel-axle']);
 for(const joint of doc.joints!){
  const a=doc.nodes[joint.bodyA].transform,b=doc.nodes[joint.bodyB].transform;
  const pa=localToWorldPoint(joint.anchorA,a),pb=localToWorldPoint(joint.anchorB,b);
  expect(Math.hypot(...pa.map((v,i)=>v-pb[i]))).toBeLessThan(1e-6);
  expect(rotatePoint(joint.axisA,a.rotation)).toEqual(rotatePoint(joint.axisB,b.rotation));
 }
 const provenance=doc.provenance!.records;
 expect(provenance).toHaveLength(3);
 expect(provenance.every(r=>r.asset.licence.spdx==='MIT')).toBe(true);
 expect(validateModelLibraryCatalogue({format:'brickwright-model-library',version:1,assets:provenance.map(p=>p.asset)}).valid).toBe(true);
 expect(doc.roots.filter(id=>doc.nodes[id].kind==='code'&&doc.nodes[id].physics?.sourcePreset===STEERABLE_ROVER_ID)).toHaveLength(12);
 expect(doc.roots.every(id=>doc.nodes[id].physics?.motion==='dynamic')).toBe(true);
 expect(Buffer.byteLength(serializeDocument(doc))).toBeLessThan(16*1024*1024);
});

it('separates manufacturing geometry from purchased hardware and imports in one history step',()=>{
 const print=createSteerableRoverDocument('robot-steerable-rover-print');
 expect(print.roots).toHaveLength(12);expect(print.joints).toBeUndefined();expect(print.provenance).toBeUndefined();
 expect(print.roots.every(id=>print.nodes[id].kind==='code'&&print.nodes[id].physics?.sourcePreset===STEERABLE_ROVER_ID)).toBe(true);
 expect(Object.values(steerableRoverPrintQuantities).reduce((a,b)=>a+b,0)).toBe(12);
 const session=createCadSession();session.insert(createSteerableRoverDocument());
 expect(session.state.document.simulation?.fixBase).toBe(false);
 expect(session.state.document.joints!.filter(j=>j.control).map(j=>j.control?.port)).toEqual(['A','B','C']);
 session.undo();expect(session.state.document.roots).toHaveLength(0);
 session.redo();expect(session.state.document.simulation?.fixBase).toBe(false);session.dispose();
});

for(const part of Object.keys(steerableRoverPartPrograms) as (keyof typeof steerableRoverPartPrograms)[])it(`${part}: closed positive STL on the bed, within a 180 mm printer envelope`,async()=>{
 const geometry=kernel.evaluate(createSteerableRoverPart(part));expect(geometry.bodies).toHaveLength(1);
 const b=geometry.bodies[0];expect(b.bounds.min[2]).toBeCloseTo(0,5);expect(b.volume).toBeGreaterThan(0);
 for(let i=0;i<3;i++)expect(b.bounds.max[i]-b.bounds.min[i]).toBeLessThanOrEqual(180);
 const screened=await checkModelLibrarySTL(exportSTL(geometry.bodies),{checkedOn:'2026-11-15',toMillimetresZUp:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],maxExtentMm:180});
 expect(Object.values(screened.checks)).toEqual(['pass','pass','pass','pass']);
});

it('steers the front fork via servo C and turns the rover in Jolt physics simulation',async()=>{
 const doc=createSteerableRoverDocument();
 const geometry=kernel.evaluate(doc);
 const prepared=await prepareDocumentCollisions(doc,geometry,kernel);
 const world=await createPhysicsWorld(doc,geometry,prepared,{J,ground:true,groundFriction:.8,groundRestitution:.02});
 try{
  const startPose=world.pose('chassis');
  // Steer front servo C while driving rear TT motors A & B forward
  world.setHingeMotor('steer-c',Math.PI,.05);
  for(let i=0;i<35;i++)world.step(.005);
  world.stopHingeMotor('steer-c');
  const steerDeg=world.hingeAngle('steer-c')*180/Math.PI;
  expect(Math.abs(steerDeg)).toBeGreaterThan(10);

  world.setHingeMotor('drive-a',Math.PI*2,.15);
  world.setHingeMotor('drive-b',Math.PI*2,.15);
  for(let i=0;i<60;i++)world.step(.005);
  const endPose=world.pose('chassis');
  // Rover should advance in +X and drift/turn in Y because the front fork is steered
  const dx=endPose.positionMm[0]-startPose.positionMm[0];
  const dy=endPose.positionMm[1]-startPose.positionMm[1];
  expect(Math.hypot(dx,dy)).toBeGreaterThan(5);
  expect(Math.abs(dy)).toBeGreaterThan(0.5);
 }finally{world.dispose();}
},600000);
