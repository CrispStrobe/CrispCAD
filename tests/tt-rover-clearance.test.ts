// SPDX-License-Identifier: BSD-3-Clause
import {afterAll,beforeAll,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import Module from 'manifold-3d';
import type {Manifold,ManifoldToplevel} from 'manifold-3d';
import {createGeometryKernel} from '@brickwright/cad-geometry';
import {createTTRoverDocument} from '../packages/editor/src/tt-rover.js';

let manifold:ManifoldToplevel;
const solids=new Map<string,Manifold>();
const origins=new Map<string,[number,number,number]>();

beforeAll(async()=>{
 const wasmBinary=readFileSync('node_modules/manifold-3d/manifold.wasm');
 const factory=Module as unknown as (options:{wasmBinary:Uint8Array})=>Promise<ManifoldToplevel>;
 manifold=await factory({wasmBinary});manifold.setup();
 const kernel=await createGeometryKernel({wasmBinary});
 const doc=createTTRoverDocument();
 const needed=new Set(['chassis',...['left','right'].flatMap(side=>[`${side}-wheel`,`${side}-cradle`,`${side}-casing`])]);
 for(const body of kernel.evaluate(doc).bodies){
  if(!needed.has(body.id))continue;
  const mesh=new manifold.Mesh({numProp:3,vertProperties:body.positions,triVerts:body.indices});
  mesh.merge();solids.set(body.id,new manifold.Manifold(mesh));
  origins.set(body.id,[...doc.nodes[body.id].transform.position]);
 }
});

afterAll(()=>{for(const solid of solids.values())solid.delete();});

// A quarter turn puts the clamp ears below the axle. The original full-width
// cradle floor/rail ends intersected them; checking only the initial pose missed it.
// These are evaluated manufacturing/vendor meshes, never physics collision proxies.
for(const side of ['left','right'])for(const angle of [90,270])it(`${side} wheel clears actual fixed parts at ${angle} degrees`,()=>{
 const id=`${side}-wheel`,origin=origins.get(id)!;
 const centered=solids.get(id)!.translate(origin.map(v=>-v) as [number,number,number]);
 const rotated=centered.rotate([0,angle,0]);
 const placed=rotated.translate(origin);
 try{
  const neighbors:[string,number][]=[[`${side}-cradle`,0.5],[`${side}-casing`,side==='left'?3.2:1.2],['chassis',1.5]];
  for(const [neighbor,minimumGap] of neighbors){
   const fixed=solids.get(neighbor)!;
   const overlap=manifold.Manifold.intersection(placed,fixed);
   try{
    expect(overlap.volume(),`${id} intersects ${neighbor}`).toBeLessThan(1e-6);
    expect(placed.minGap(fixed,5),`${id} clearance to ${neighbor}`).toBeGreaterThanOrEqual(minimumGap-1e-4);
   }finally{overlap.delete();}
  }
 }finally{placed.delete();rotated.delete();centered.delete();}
});
