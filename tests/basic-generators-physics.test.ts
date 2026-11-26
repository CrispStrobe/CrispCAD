// SPDX-License-Identifier: BSD-3-Clause
import {beforeAll,expect,it,vi} from 'vitest';import {readFileSync} from 'node:fs';
import {defaultGenerator} from '@brickwright/cad-core';import {createGeometryKernel} from '@brickwright/cad-geometry';import type {GeometryKernel} from '@brickwright/cad-geometry';
import {prepareDocumentCollisions,createPhysicsWorld} from '../packages/physics/src/index.js';import {createPresetDocument} from '../packages/editor/src/shapes.js';
// Manifold/Jolt suite: under a loaded machine (load ~150) its tests and hooks ran up to ~10x
// their idle time, past vitest's 5 s / 10 s defaults. Explicit per-test timeouts below still win.
vi.setConfig({testTimeout:60_000,hookTimeout:120_000});
let kernel:GeometryKernel;beforeAll(async()=>{kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});});
const variants={
 'rounded-box':{width:50,depth:20,height:16,radius:6,detail:6},capsule:{length:60,width:18,height:12,segments:32},
 tube:{outerDiameter:80,wallThickness:.5,height:40,segments:96},washer:{outerDiameter:60,wallThickness:15,height:2,segments:96},
 cone:{diameter:40,height:45,segments:96},frustum:{bottomDiameter:20,topDiameter:42,height:30,segments:96},polygon:{diameter:36,height:24,sides:9},
 ellipse:{width:60,depth:16,height:25,segments:96},wedge:{width:20,depth:40,height:12},pyramid:{width:40,depth:25,height:18},
 'round-roof':{width:50,height:18,length:35,segments:40},torus:{majorRadius:20,tubeRadius:4,segments:96,tubeSegments:24},
};
for(const [preset,values]of Object.entries(variants))it(`edited ${preset} qualifies its actual surface and preserves cavities in Jolt`,async()=>{
 const recipe=defaultGenerator(preset)!;Object.assign(recipe.values,values);const doc=createPresetDocument(preset,'BW',{recipe}),id=doc.roots[0],g=kernel.evaluate(doc),prepared=await prepareDocumentCollisions(doc,g,kernel),world=await createPhysicsWorld(doc,g,prepared,{ground:false,mode:'rigid-preview'});
 try{expect(prepared.get(id)!.certificate.relativeError).toBeLessThan(.02);
 if('wallThickness'in values){const h=values.height,r=values.outerDiameter/2-values.wallThickness/2;expect(world.raycast([0,0,-h],[0,0,h])).toBeNull();expect(world.raycast([r,0,-h],[r,0,h])?.bodyId).toBe(id);}
 if(preset==='torus'){expect(world.raycast([0,0,-10],[0,0,10])).toBeNull();expect(world.raycast([20,0,-10],[20,0,10])?.bodyId).toBe(id);}
 world.step(.02);expect(world.pose(id).positionMm.every(Number.isFinite)).toBe(true);
 }finally{world.dispose();}
},180_000);
