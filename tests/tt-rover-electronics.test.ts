// SPDX-License-Identifier: BSD-3-Clause
import {afterAll,beforeAll,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import Module from 'manifold-3d';
import type {Manifold,ManifoldToplevel} from 'manifold-3d';
import {createGeometryKernel} from '@brickwright/cad-geometry';
import type {BodyMesh,GeometryKernel} from '@brickwright/cad-geometry';
import {createTTRoverDocument,createTTRoverPart} from '../packages/editor/src/tt-rover.js';

let manifold:ManifoldToplevel,kernel:GeometryKernel,carrier:Manifold;
const boardHoles:[number,number][]=[[-8.89,-22.86],[8.89,-22.86],[-8.89,22.86],[8.89,22.86],[21.84,6.35],[42.16,6.35]];
const deckHoles:[number,number][]=[[25,-12.5],[25,12.5],[39,-12.5],[39,12.5]];
const asSolid=(body:BodyMesh)=>{
 const mesh=new manifold.Mesh({numProp:3,vertProperties:body.positions,triVerts:body.indices});
 mesh.merge();return new manifold.Manifold(mesh);
};
function overlap(a:Manifold,b:Manifold){const intersection=manifold.Manifold.intersection(a,b);try{return intersection.volume();}finally{intersection.delete();}}
function boreProbe(x:number,y:number,height:number,radius:number){const cylinder=manifold.Manifold.cylinder(height,radius,radius,32);try{return cylinder.translate([x,y,-1]);}finally{cylinder.delete();}}

beforeAll(async()=>{
 const wasmBinary=readFileSync('node_modules/manifold-3d/manifold.wasm');
 const factory=Module as unknown as (options:{wasmBinary:Uint8Array})=>Promise<ManifoldToplevel>;
 manifold=await factory({wasmBinary});manifold.setup();kernel=await createGeometryKernel({wasmBinary});
 carrier=asSolid(kernel.evaluate(createTTRoverPart('carrier')).bodies[0]);
});
afterAll(()=>carrier?.delete());

it('opens all six real PCB through-bolts and keeps a supporting land around each bore',()=>{
 // Independent fabrication coordinates: Feather Rev B, 45.72 x 17.78 pitch;
 // DRV8833, 20.32 pitch at 6.35 from the board centre after the documented rotation.
 for(const [x,y]of boardHoles){
  const screw=boreProbe(x,y,12,1.25);
  const seatBase=manifold.Manifold.cube([.2,.2,.4]),seat=seatBase.translate([x+1.9,y-.1,8.5]);
  try{expect(overlap(carrier,screw)).toBeLessThan(1e-7);expect(overlap(carrier,seat)).toBeCloseTo(.016,5);}
  finally{screw.delete();seat.delete();seatBase.delete();}
 }
 expect(carrier.boundingBox()).toEqual({min:[-14,-28,0],max:[47,28,9]});
});

it('opens opposing screw-seat faces and places the four carrier bolts inside the original deck slots',()=>{
 const deck=asSolid(kernel.evaluate(createTTRoverPart('deck')).bodies[0]);
 try{
  for(const [x,y]of deckHoles){
   const screw=boreProbe(x,y,7,1.5);
   const headBase=manifold.Manifold.cylinder(1.5,1.5,3,32);
   const head=headBase.translate([x,y,1.5]);
   try{expect(overlap(carrier,screw)).toBeLessThan(1e-7);expect(overlap(deck,screw)).toBeLessThan(1e-7);expect(overlap(carrier,head)).toBeLessThan(1e-7);}
   finally{screw.delete();head.delete();headBase.delete();}
  }
  for(const [x,y]of boardHoles){
   const headBase=manifold.Manifold.cylinder(1.2,2.5,1.3,32),head=headBase.translate([x,y,0]);
   try{expect(overlap(carrier,head)).toBeLessThan(1e-7);}finally{head.delete();headBase.delete();}
  }
 }finally{deck.delete();}
});

it('clears the existing deck posts and leaves at least 1.5 mm for the specified M3 washers',()=>{
 const postCentres=[[-20,-22],[-20,22],[40,-22],[40,22]];
 // Hardware is not simulated; independently check the actual nominal washer
 // envelope underneath the deck where it passes alongside a printed post.
 for(const [x,y]of deckHoles)for(const [px,py]of postCentres)
  expect(Math.hypot(x-px,y-py)-4.5-3.5).toBeGreaterThan(1.5);
 for(const [x,y]of deckHoles)for(const [px,py]of boardHoles)
  expect(Math.hypot(x-px,y-py)-3.3-2.5,'M3 countersink must leave a land beside every PCB boss').toBeGreaterThan(1);
 const doc=createTTRoverDocument();
 expect(doc.nodes.carrier.transform.position).toEqual([0,0,49]);
 const installed=carrier.translate([0,0,49]);
 try{
  for(const [x,y]of postCentres){
   const headBase=manifold.Manifold.cylinder(4,3.5,3.5,32),head=headBase.translate([x,y,49]);
   try{expect(overlap(installed,head)).toBeLessThan(1e-7);expect(installed.minGap(head,4)).toBeGreaterThanOrEqual(.5-1e-6);}
   finally{head.delete();headBase.delete();}
  }
 }finally{installed.delete();}
 for(const id of ['feather-envelope','driver-envelope']){
  const node=doc.nodes[id];if(node.kind!=='box')throw Error('Expected component envelope');
  expect(node.transform.position[2]-node.size[2]/2).toBe(58);
  expect(doc.joints!.some(j=>j.kind==='fixed'&&j.bodyA==='carrier'&&j.bodyB===id)).toBe(true);
  const boardBase=manifold.Manifold.cube(node.size),board=boardBase.translate(node.transform.position.map((v,i)=>v-node.size[i]/2) as [number,number,number]);
  try{
   for(const [x,y]of deckHoles){
    const toolBase=manifold.Manifold.cylinder(20,2,2,32),tool=toolBase.translate([x,y,52]);
    try{expect(overlap(board,tool),'4 mm screwdriver shaft must reach every M3 head with boards installed').toBeLessThan(1e-7);}
    finally{tool.delete();toolBase.delete();}
   }
  }finally{board.delete();boardBase.delete();}
 }
 expect(doc.joints!.some(j=>j.kind==='fixed'&&j.bodyA==='deck'&&j.bodyB==='carrier')).toBe(true);
});

it('keeps the PCB bores open through taller retained bosses and preserves the requested clearance',()=>{
 const doc=createTTRoverPart('carrier'),node=doc.nodes.carrier;
 if(node.kind!=='code')throw Error('Expected retained carrier recipe');
 node.program.parameters.boardClearance='15 mm';
 const raised=asSolid(kernel.evaluate(doc).bodies[0]);
 try{
  expect(raised.boundingBox().max[2]).toBeCloseTo(18,6);
  for(const [x,y]of boardHoles){
   const screw=boreProbe(x,y,21,1.25);
   try{expect(overlap(raised,screw)).toBeLessThan(1e-7);}finally{screw.delete();}
  }
  node.program.parameters.boardBore='3 mm';
  expect(kernel.evaluate(doc).volume).toBeLessThan(raised.volume());
 }finally{raised.delete();}
});

it('refuses parameter changes that remove the prescribed solder gap or thin the boss wall excessively',()=>{
 for(const parameters of [{boardClearance:'0 mm'},{boardClearance:'5 mm'},{boardClearance:'21 mm'},{boardBore:'2.5 mm'},{boardBore:'4 mm'}]){
  const doc=createTTRoverPart('carrier'),node=doc.nodes.carrier;
  if(node.kind!=='code')throw Error('Expected retained carrier recipe');
  Object.assign(node.program.parameters,parameters);
  expect(()=>kernel.evaluate(doc)).toThrow(/no printable solid/);
 }
});
