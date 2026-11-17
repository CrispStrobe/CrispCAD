// SPDX-License-Identifier: BSD-3-Clause
import {beforeAll,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import initJolt from 'jolt-physics/debug-wasm-compat';
import {createGeometryKernel} from '@brickwright/cad-geometry';
import type {GeometryKernel} from '@brickwright/cad-geometry';
import {parseDocument,serializeDocument,validateModelLibraryCatalogue} from '@brickwright/cad-core';
import {createMotorDocument,motorCatalog} from '../packages/editor/src/motor-models.js';
import {createPhysicsWorld,prepareDocumentCollisions} from '../packages/physics/src/index.js';
let kernel:GeometryKernel,J:Awaited<ReturnType<typeof initJolt>>;
beforeAll(async()=>{kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});J=await initJolt();});
for(const preset of motorCatalog)it(`${preset.name}: closed source-derived solids, retained MIT provenance and independently moving shaft`,async()=>{
 const doc=parseDocument(serializeDocument(createMotorDocument(preset.id)));
 expect(validateModelLibraryCatalogue({format:'brickwright-model-library',version:1,assets:[doc.provenance!.records[0].asset]}).valid).toBe(true);
 expect(doc.provenance!.records[0].asset.licence.spdx).toBe('MIT');
 doc.nodes.casing.physics!.motion='static';
 const geometry=kernel.evaluate(doc);expect(geometry.bodies).toHaveLength(2);expect(geometry.bodies.every(b=>b.volume>0)).toBe(true);
 const prepared=await prepareDocumentCollisions(doc,geometry,kernel);
 // Fail if a bad candidate silently falls back to the expensive generic BSP.
 const limits:Record<string,number>={'tt-gearmotor':650,'micro-servo-1143':400,'dc-toy-motor':700};
 expect([...prepared.values()].reduce((n,p)=>n+p.hulls.length,0)).toBeLessThan(limits[preset.id]);
 for(const collision of prepared.values()){
  expect(collision.certificate.strategy).toBe('supplied');
  expect(collision.certificate.tolerance).toEqual({volumeFraction:.02,boundsMm:.2});
  expect(collision.certificate.relativeError).toBeLessThanOrEqual(.02);
  expect(collision.certificate.boundsErrorMm).toBeLessThanOrEqual(.2);
 }
 const world=await createPhysicsWorld(doc,geometry,prepared,{J,ground:false});
 try {
  const before=world.pose('casing');world.setHingeMotor('motor-output',Math.PI,.02);
  for(let i=0;i<100;i++)world.step(.005);
  expect(Math.abs(world.hingeAngle('motor-output'))).toBeGreaterThan(.5);
  expect(world.pose('casing')).toEqual(before);
  world.coastHingeMotor('motor-output');world.step(.005);world.stopHingeMotor('motor-output');world.step(.005);
 }finally{world.dispose();}
},60000);
