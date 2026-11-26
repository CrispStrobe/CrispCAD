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

it('places the drive A encoder pickup on the chassis, facing the wheel rim at a 2.5 mm sensing gap',()=>{
 const doc=createTTRoverDocument(),node=doc.nodes['electronics-encoder'];
 if(node.kind!=='box')throw Error('Expected encoder pickup envelope');
 expect(doc.joints!.some(j=>j.kind==='fixed'&&j.bodyA==='chassis'&&j.bodyB==='electronics-encoder')).toBe(true);
 const geometry=kernel.evaluate(doc),bounds=(id:string)=>geometry.bodies.find(b=>b.id===id)!.bounds;
 const pickup=bounds('electronics-encoder'),chassis=bounds('chassis');
 // Rests on the chassis top and reaches outboard toward the left wheel.
 expect(pickup.min[2]).toBeCloseTo(chassis.max[2],4);expect(pickup.min[1]).toBeLessThan(chassis.max[1]-5);
 const encoder=asSolid(geometry.bodies.find(b=>b.id==='electronics-encoder')!),wheel=asSolid(geometry.bodies.find(b=>b.id==='left-wheel')!);
 try{
  expect(overlap(encoder,wheel)).toBeLessThan(1e-7);
  expect(encoder.minGap(wheel,5)).toBeCloseTo(2.5,3);
  // Both emitter/detector pairs (±2.5 mm in X) look at the rim face, radius 25–30 about the axle.
  const face=[(pickup.min[0]+pickup.max[0])/2,(pickup.min[2]+pickup.max[2])/2];
  for(const dx of [-2.5,2.5]){const r=Math.hypot(face[0]+dx-25,face[1]-32);expect(r).toBeGreaterThan(25);expect(r).toBeLessThan(30);}
 }finally{encoder.delete();wheel.delete();}
});

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
 // The METRO Mini, 5 V regulator and H-bridge stand on a printed tray over the
 // carrier (they replaced the Feather and driver envelopes). Hold the tray and
 // the boards to the same fastener rules, using their evaluated solids.
 expect(doc.nodes['feather-envelope']).toBeUndefined();expect(doc.nodes['driver-envelope']).toBeUndefined();
 const boards=['electronics-controller','electronics-regulator','electronics-driver-0'];
 expect(doc.roots.filter(id=>/^electronics-(controller|regulator|driver-)/.test(id)).sort()).toEqual([...boards].sort());
 for(const id of ['electronics-mount',...boards])expect(doc.joints!.some(j=>j.kind==='fixed'&&j.bodyA==='carrier'&&j.bodyB===id),id).toBe(true);
 const geometry=kernel.evaluate(doc),solid=(id:string)=>asSolid(geometry.bodies.find(b=>b.id===id)!);
 let posts:Manifold|undefined;const tray=solid('electronics-mount'),parts=boards.map(id=>[id,solid(id)] as const),installedCarrier=carrier.translate([0,0,49]);
 // ISO 10642 M3 countersunk head: 6.72 mm maximum diameter.
 const cylinder=(x:number,y:number,z:number,height:number,radius:number)=>{const base=manifold.Manifold.cylinder(height,radius,radius,48);try{return base.translate([x,y,z]);}finally{base.delete();}};
 try{
  const trayBox=tray.boundingBox();
  expect(trayBox.min[2],'tray posts stand on the carrier top').toBeCloseTo(52,5);
  expect(overlap(installedCarrier,tray),'tray must clear the carrier and its board bosses').toBeLessThan(1e-7);
  for(const [id,board]of parts){
   expect(overlap(tray,board),id).toBeLessThan(1e-7);
   expect(board.boundingBox().min[2],id+' sits above the tray').toBeGreaterThanOrEqual(trayBox.max[2]-1e-6);
  }
  // Posts alone: the tray below its 2.4 mm plate.
  const postTop=trayBox.max[2]-2.4-.01;posts=tray.trimByPlane([0,0,-1],-postTop);
  expect(posts!.volume(),"four full-height posts (12-sided, bored)").toBeGreaterThan(4*3*(2.6**2-1.3**2)*7);
  for(const [x,y]of deckHoles){
   const tool=cylinder(x,y,52,20,2),head=cylinder(x,y,52,trayBox.max[2]-52+1,3.36),seat=cylinder(x,y,52,postTop-52,3.3);
   try{
    expect(overlap(tray,tool),'4 mm screwdriver shaft must reach every M3 head through the tray').toBeLessThan(1e-7);
    expect(tray.minGap(tool,4),'tray access hole must leave 1.5 mm around the driver shaft').toBeGreaterThanOrEqual(1.5-1e-6);
    expect(overlap(tray,head),'an M3 countersunk head must pass through the tray').toBeLessThan(1e-7);
    expect(posts!.minGap(seat,4),'tray posts must keep 1.5 mm from every M3 head recess').toBeGreaterThanOrEqual(1.5-1e-6);
    for(const [id,board]of parts)expect(overlap(board,tool),'4 mm screwdriver shaft must reach every M3 head with '+id+' installed').toBeLessThan(1e-7);
   }finally{tool.delete();head.delete();seat.delete();}
  }
 }finally{tray.delete();installedCarrier.delete();posts?.delete();for(const [,board]of parts)board.delete();}
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
