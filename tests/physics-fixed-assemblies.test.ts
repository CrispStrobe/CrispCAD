// SPDX-License-Identifier: BSD-3-Clause
import {beforeAll,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import initJolt from 'jolt-physics/debug-wasm-compat';
import {createDocument,identityTransform,jointAtWorldFrame,defaultPartPhysics,defaultSimulationSettings} from '@brickwright/cad-core';
import type {CadDocument} from '@brickwright/cad-core';
import {createGeometryKernel} from '@brickwright/cad-geometry';
import type {GeometryKernel} from '@brickwright/cad-geometry';
import {createPhysicsWorld,prepareDocumentCollisions} from '../packages/physics/src/index.js';
let kernel:GeometryKernel,J:Awaited<ReturnType<typeof initJolt>>;
beforeAll(async()=>{kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});J=await initJolt();});
function fixture(){const doc=createDocument();doc.version=8;doc.simulation={...defaultSimulationSettings(),gravity:[0,0,0],ground:false};doc.joints=[];for(const [id,x]of [['left',-20],['right',20]]as const){doc.nodes[id]={id,name:id,kind:'box',size:[10,10,10],transform:{...identityTransform(),position:[x,0,20]},color:'#123456',physics:defaultPartPhysics()};doc.roots.push(id);}doc.joints.push(jointAtWorldFrame(doc,'fixed','left','right',[0,0,20],[0,1,0]));return doc;}
const worldFor=async(doc:CadDocument,engine:any=J)=>{const geometry=kernel.evaluate(doc);return createPhysicsWorld(doc,geometry,await prepareDocumentCollisions(doc,geometry,kernel),{J:engine});};

it('keeps welded poses exact while retaining original part bounds, ray IDs and hinged controls',async()=>{
 const doc=fixture();doc.nodes.motor={...structuredClone(doc.nodes.right),id:'motor',name:'motor',transform:{...identityTransform(),position:[40,0,20]}};doc.nodes.shaft={...structuredClone(doc.nodes.right),id:'shaft',name:'shaft',transform:{...identityTransform(),position:[60,0,20]}};doc.roots.push('motor','shaft');doc.joints!.push(jointAtWorldFrame(doc,'fixed','right','motor',[40,0,20],[0,1,0]),jointAtWorldFrame(doc,'hinge','motor','shaft',[50,0,20],[0,1,0]));
 const before=JSON.stringify(doc),world=await worldFor(doc);
 try{expect(world.rigidBodyCount).toBe(2);expect(world.boundsMm('left').min[0]).toBeCloseTo(-25);expect(world.boundsMm('right').max[0]).toBeCloseTo(25);expect(world.raycast([-20,0,40],[-20,0,0])?.bodyId).toBe('left');expect(world.raycast([40,0,40],[40,0,0])?.bodyId).toBe('motor');world.setHingeMotor(doc.joints![2].id,Math.PI,.02);world.step(.1);expect(world.hingeAngle(doc.joints![2].id)).toBeGreaterThan(.1);expect(world.pose('left')).toEqual(world.pose('right'));expect(world.pose('right')).toEqual(world.pose('motor'));expect(JSON.stringify(doc)).toBe(before);}finally{world.dispose();world.dispose();}expect(()=>world.pose('motor')).toThrow('disposed');
});

it('uses summed mass, parallel-axis inertia and each selected part COM for impulses and velocity setters',async()=>{
 const doc=fixture(),world=await worldFor(doc),mass=.0021,inertiaZ=8.75e-7;
 try{world.applyImpulse('left',[.00021,0,0],[0,0,20]);expect(world.linearVelocityMmS('left')[0]).toBeCloseTo(.00021/mass*1000,3);world.applyImpulse('right',[0,.0001,0]);const angular=.02*.0001/inertiaZ;expect(world.angularVelocity('left')[2]).toBeCloseTo(angular,4);expect(world.linearVelocityMmS('right')[1]-world.linearVelocityMmS('left')[1]).toBeCloseTo(angular*40,3);expect((world.linearVelocityMmS('left')[1]+world.linearVelocityMmS('right')[1])/2).toBeCloseTo(.0001/mass*1000,3);
  world.setLinearVelocity('right',[250,30,0]);expect(world.linearVelocityMmS('right')[0]).toBeCloseTo(250,3);expect(world.linearVelocityMmS('right')[1]).toBeCloseTo(30,3);const prior=world.linearVelocityMmS('right');world.setAngularVelocity('right',[0,0,1]);for(let i=0;i<3;i++)expect(world.linearVelocityMmS('right')[i]).toBeCloseTo(prior[i],3);expect(world.linearVelocityMmS('left')[1]).toBeCloseTo(-10,3);
 }finally{world.dispose();}
});

it('projects authored velocities onto a fixed assembly by conserving linear and angular momentum',async()=>{
 const doc=fixture();doc.nodes.left.physics!.initialVelocityMmS=[0,-100,0];doc.nodes.right.physics!.initialVelocityMmS=[0,100,0];const world=await worldFor(doc);
 try{expect(world.angularVelocity('left')[2]).toBeCloseTo(4.8,4);expect(world.linearVelocityMmS('left')[1]).toBeCloseTo(-96,3);expect(world.linearVelocityMmS('right')[1]).toBeCloseTo(96,3);expect(world.pose('left')).toEqual(world.pose('right'));}finally{world.dispose();}
 const spinning=fixture();spinning.nodes.left.physics!.initialAngularVelocityDps=[0,0,180];spinning.nodes.right.physics!.initialAngularVelocityDps=[0,0,180];const other=await worldFor(spinning);
 try{expect(other.angularVelocity('left')[2]).toBeCloseTo(Math.PI*.04,5);}finally{other.dispose();}
});

it('freezes a complete component when any member is static and rejects conflicting moving mates',async()=>{
 const doc=fixture();doc.nodes.right.physics!.motion='static';doc.nodes.left.physics!.initialVelocityMmS=[100,0,0];const world=await worldFor(doc);
 try{const before=world.pose('left');world.step(.1);expect(world.pose('left')).toEqual(before);expect(world.pose('right')).toEqual(before);expect(()=>world.setLinearVelocity('left',[1,0,0])).toThrow('fixed');expect(()=>world.setAngularVelocity('left',[0,0,1])).toThrow('fixed');expect(()=>world.applyImpulse('left',[.001,0,0])).toThrow('fixed');}finally{world.dispose();}
 const conflict=fixture();conflict.joints!.push(jointAtWorldFrame(conflict,'hinge','left','right',[0,0,20],[0,1,0]));await expect(worldFor(conflict)).rejects.toThrow('same rigid assembly');
 const invalid=fixture();invalid.joints![0].anchorB[0]+=1;await expect(worldFor(invalid)).rejects.toThrow('misaligned');
});

it('retains each leaf material in added and persisted contacts of a heterogeneous compound',async()=>{
 const doc=fixture();doc.simulation={...defaultSimulationSettings(),groundFriction:.8,groundRestitution:.1};for(const id of doc.roots)doc.nodes[id].transform.position[2]=5;doc.joints=[jointAtWorldFrame(doc,'fixed','left','right',[0,0,5],[0,1,0])];Object.assign(doc.nodes.left.physics!,{friction:.12,restitution:.02});Object.assign(doc.nodes.right.physics!,{friction:.9,restitution:.2});
 const seen:{event:string;token:number;friction:number;restitution:number;reduction:boolean}[]=[];
 const observed={...J,ContactListenerJS:function(){const listener=new J.ContactListenerJS();for(const event of ['OnContactAdded','OnContactPersisted']){let callback:(...args:number[])=>void=()=>{};const wrapped=(...args:number[])=>{callback(...args);const a=J.wrapPointer(args[0],J.Body),b=J.wrapPointer(args[1],J.Body),m=J.wrapPointer(args[2],J.ContactManifold),s=J.wrapPointer(args[3],J.ContactSettings),ta=a.GetShape().GetSubShapeUserData(m.mSubShapeID1),tb=b.GetShape().GetSubShapeUserData(m.mSubShapeID2),body=ta?a:b;seen.push({event,token:ta||tb,friction:s.mCombinedFriction,restitution:s.mCombinedRestitution,reduction:body.GetUseManifoldReduction()});};Object.defineProperty(listener,event,{get:()=>wrapped,set:value=>{callback=value;},configurable:true});}return listener;}};
 const world=await worldFor(doc,observed);try{for(let i=0;i<5;i++)world.step(.1);for(const event of ['OnContactAdded','OnContactPersisted'])for(const token of [1,2]){const contact=seen.find(c=>c.event===event&&c.token===token);expect(contact).toBeDefined();expect(contact!.friction).toBeCloseTo(Math.sqrt(.8*(token===1?.12:.9)),6);expect(contact!.restitution).toBeCloseTo(token===1?.1:.2,6);expect(contact!.reduction).toBe(false);}}finally{world.dispose();}
});
