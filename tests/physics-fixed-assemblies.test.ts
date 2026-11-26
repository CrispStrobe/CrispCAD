// SPDX-License-Identifier: BSD-3-Clause
import {beforeAll,it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import initJolt from 'jolt-physics/debug-wasm-compat';
import {createDocument,identityTransform,jointAtWorldFrame,defaultPartPhysics,defaultSimulationSettings} from '@brickwright/cad-core';
import type {CadDocument} from '@brickwright/cad-core';
import {createGeometryKernel} from '@brickwright/cad-geometry';
import type {GeometryKernel} from '@brickwright/cad-geometry';
import {createPhysicsWorld,prepareDocumentCollisions,preparePhysicsDocument} from '../packages/physics/src/index.js';
import * as hingeClearance from '../packages/physics/src/hinge-clearance.js';
import * as mass from '../packages/physics/src/mass.js';
let kernel:GeometryKernel,J:Awaited<ReturnType<typeof initJolt>>;
beforeAll(async()=>{kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});J=await initJolt();});
function fixture(){const doc=createDocument();doc.version=8;doc.simulation={...defaultSimulationSettings(),gravity:[0,0,0],ground:false};doc.joints=[];for(const [id,x]of [['left',-20],['right',20]]as const){doc.nodes[id]={id,name:id,kind:'box',size:[10,10,10],transform:{...identityTransform(),position:[x,0,20]},color:'#123456',physics:defaultPartPhysics()};doc.roots.push(id);}doc.joints.push(jointAtWorldFrame(doc,'fixed','left','right',[0,0,20],[0,1,0]));return doc;}
const worldFor=async(doc:CadDocument,engine:any=J)=>{const geometry=kernel.evaluate(doc);return createPhysicsWorld(doc,geometry,await prepareDocumentCollisions(doc,geometry,kernel),{J:engine});};

it('keeps welded poses exact while retaining original part bounds, ray IDs and hinged controls',async()=>{
 const doc=fixture();doc.nodes.motor={...structuredClone(doc.nodes.right),id:'motor',name:'motor',transform:{...identityTransform(),position:[40,0,20]}};doc.nodes.shaft={...structuredClone(doc.nodes.right),id:'shaft',name:'shaft',transform:{...identityTransform(),position:[60,0,20]}};doc.roots.push('motor','shaft');doc.joints!.push(jointAtWorldFrame(doc,'fixed','right','motor',[40,0,20],[0,1,0]),jointAtWorldFrame(doc,'hinge','motor','shaft',[50,0,20],[0,1,0]));
 const before=JSON.stringify(doc),world=await worldFor(doc);
 try{expect(world.rigidBodyCount).toBe(2);expect(world.boundsMm('left').min[0]).toBeCloseTo(-25);expect(world.boundsMm('right').max[0]).toBeCloseTo(25);expect(world.raycast([-20,0,40],[-20,0,0])?.bodyId).toBe('left');expect(world.raycast([40,0,40],[40,0,0])?.bodyId).toBe('motor');world.setHingeMotor(doc.joints![2].id,Math.PI,.02);world.step(.1);expect(world.hingeAngle(doc.joints![2].id)).toBeGreaterThan(.1);expect(world.pose('left')).toEqual(world.pose('right'));expect(world.pose('right')).toEqual(world.pose('motor'));expect(JSON.stringify(doc)).toBe(before);}finally{world.dispose();world.dispose();}expect(()=>world.pose('motor')).toThrow('disposed');
});

it('samples a welded body once in an ordered batch with independent pose arrays',async()=>{
 const world=await worldFor(fixture());
 const ids=['right','left','right'];
 try{
  const initial=ids.map(id=>({id,...world.pose(id)}));
  const position=vi.spyOn(J.Body.prototype,'GetPosition');
  const rotation=vi.spyOn(J.Body.prototype,'GetRotation');
  try{
   const batch=world.poses(ids);
   expect(batch).toEqual(initial);
   expect(position).toHaveBeenCalledTimes(1);
   expect(rotation).toHaveBeenCalledTimes(1);
   batch[0].positionMm[0]=123;
   batch[0].quaternion[0]=1;
   expect(batch.slice(1)).toEqual(initial.slice(1));
  }finally{position.mockRestore();rotation.mockRestore();}
  world.setLinearVelocity('left',[100,0,0]);world.step();
  const moved=world.poses(ids);
  expect(moved).toEqual(ids.map(id=>({id,...world.pose(id)})));
  expect(moved[0].positionMm[0]).toBeGreaterThan(initial[0].positionMm[0]);
  expect(()=>world.poses(['missing'])).toThrow('Unknown physics body');
 }finally{world.dispose();}
 expect(()=>world.poses([])).toThrow('disposed');
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

it('retains unequal densities and off-diagonal aggregate inertia',async()=>{
 const doc=fixture();doc.nodes.left.transform.position=[-20,-20,20];doc.nodes.right.transform.position=[20,20,20];doc.nodes.right.physics!.densityKgM3=3150;doc.joints=[jointAtWorldFrame(doc,'fixed','left','right',[0,0,20],[0,1,0])];const world=await worldFor(doc);
 try{world.applyImpulse('right',[0,0,.0001]);const angular=world.angularVelocity('left');expect(angular[0]).toBeCloseTo(.386100386,5);expect(angular[1]).toBeCloseTo(-.386100386,5);expect(angular[2]).toBeCloseTo(0,5);expect((world.linearVelocityMmS('left')[2]+3*world.linearVelocityMmS('right')[2])/4).toBeCloseTo(.0001/.0042*1000,3);}finally{world.dispose();}
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
 const world=await worldFor(doc,observed);
 try{
  world.spawnSphere('preview-material',[100,0,6],[0,0,-50],6);
  for(let i=0;i<5;i++)world.step(.1);
  for(const event of ['OnContactAdded','OnContactPersisted'])for(const token of [1,2]){
   const contact=seen.find(c=>c.event===event&&c.token===token);
   expect(contact).toBeDefined();
   expect(contact!.friction).toBeCloseTo(Math.sqrt(.8*(token===1?.12:.9)),6);
   expect(contact!.restitution).toBeCloseTo(token===1?.1:.2,6);
   expect(contact!.reduction).toBe(false);
  }
  const preview=seen.find(c=>c.event==='OnContactAdded'&&c.token===0);
  expect(preview).toBeDefined();
  expect(preview!.friction).toBeCloseTo(Math.sqrt(Math.fround(.8)*Math.fround(.4)),6);
  expect(preview!.restitution).toBeCloseTo(.45,6);
 }finally{world.dispose();}
});

it('falls back from the full-turn proof when accepted hinge frames are offset or skewed',async()=>{
 const doc=fixture();doc.nodes.rotor={...structuredClone(doc.nodes.right),id:'rotor',name:'rotor',transform:{...identityTransform(),position:[60,0,20]}};doc.roots.push('rotor');doc.joints!.push(jointAtWorldFrame(doc,'hinge','right','rotor',[40,0,20],[0,1,0]));const aligned=await worldFor(doc);try{expect(aligned.separatedHingePairCount).toBe(1);}finally{aligned.dispose();}
 for(const kind of ['offset','skew']){const changed=structuredClone(doc);if(kind==='offset')changed.joints![1].anchorB[0]+=.0001;else changed.joints![1].axisB=[0,Math.cos(.001),Math.sin(.001)];const world=await worldFor(changed);try{expect(world.separatedHingePairCount).toBe(0);}finally{world.dispose();}}
});

it('permanently restores native part filtering before external mutations of a separated hinge assembly',async()=>{
 const doc=fixture();doc.nodes.rotor={...structuredClone(doc.nodes.right),id:'rotor',name:'rotor',transform:{...identityTransform(),position:[60,0,20]}};doc.roots.push('rotor');doc.joints!.push(jointAtWorldFrame(doc,'hinge','right','rotor',[40,0,20],[0,1,0]));
 const mutations=[(w:Awaited<ReturnType<typeof worldFor>>)=>w.applyImpulse('left',[.001,0,0]),(w:Awaited<ReturnType<typeof worldFor>>)=>w.setLinearVelocity('left',[100,0,0]),(w:Awaited<ReturnType<typeof worldFor>>)=>w.setAngularVelocity('left',[0,0,1]),(w:Awaited<ReturnType<typeof worldFor>>)=>w.grabBody('left',[-20,0,20],[-19,0,20])];
 for(const mutate of mutations){const world=await worldFor(doc);try{expect(world.separatedHingePairCount).toBe(1);mutate(world);expect(world.separatedHingePairCount).toBe(0);world.releaseGrab();world.step(.005);expect(world.separatedHingePairCount).toBe(0);}finally{world.dispose();}}
 const moving=structuredClone(doc);moving.nodes.left.physics!.initialVelocityMmS=[100,0,0];const world=await worldFor(moving);try{expect(world.separatedHingePairCount).toBe(0);}finally{world.dispose();}
});

it('samples shared hinge assembly poses once at each step boundary',async()=>{
 const doc=fixture();
 const rotors=[
  {id:'first',base:'right',x:60,anchor:40,axis:[0,1,0] as const},
  {id:'second',base:'left',x:-60,anchor:-40,axis:[0,0,1] as const},
 ];
 for(const {id,base,x,anchor,axis} of rotors){
  doc.nodes[id]={...structuredClone(doc.nodes[base]),id,name:id,transform:{...identityTransform(),position:[x,0,20]}};
  doc.roots.push(id);
  doc.joints!.push(jointAtWorldFrame(doc,'hinge',base,id,[anchor,0,20],[...axis]));
 }
 const world=await worldFor(doc);
 const positions=vi.spyOn(J.Body.prototype,'GetPosition');
 const rotations=vi.spyOn(J.Body.prototype,'GetRotation');
 try{
  expect(world.separatedHingePairCount).toBe(2);
  world.step(.01);
  // Three bodies, two boundaries per substep, two substeps.
  expect(positions).toHaveBeenCalledTimes(12);
  expect(rotations).toHaveBeenCalledTimes(12);
  expect(world.separatedHingePairCount).toBe(2);
 }finally{positions.mockRestore();rotations.mockRestore();world.dispose();}
});

it('reuses warm mass properties while checking source meshes and integration bounds',async()=>{
 const doc=fixture(),document=preparePhysicsDocument(doc),geometry=kernel.evaluate(doc);
 const prepared=await prepareDocumentCollisions(doc,geometry,kernel);
 const integrate=vi.spyOn(mass,'solidMassProperties');
 const combine=vi.spyOn(mass,'combineMassProperties');
 const measure=async(result:typeof geometry,fixBase=false)=>{
  const world=await createPhysicsWorld(document,result,prepared,{J,fixBase});
  try{return world.pose('left');}
  finally{world.dispose();}
 };
 try{
  const first=await measure(geometry);
  expect(await measure(geometry,true)).toEqual(first);
  expect(integrate).toHaveBeenCalledTimes(2);
  expect(combine).toHaveBeenCalledTimes(1);
  const shifted=structuredClone(geometry);
  shifted.bodies[0].bounds.max[0]+=.1;
  expect(await measure(shifted)).toEqual(first);
  expect(integrate).toHaveBeenCalledTimes(4);
  expect(combine).toHaveBeenCalledTimes(2);
  shifted.bodies[0].positions[0]+=.1;
  await expect(measure(shifted)).rejects.toThrow('missing or stale');
  expect(integrate).toHaveBeenCalledTimes(4);
 }finally{integrate.mockRestore();combine.mockRestore();}
});

it('reuses authored hinge clearance while keeping live filtering separate for each world',async()=>{
 const doc=fixture();
 doc.nodes.rotor={...structuredClone(doc.nodes.right),id:'rotor',name:'rotor',transform:{...identityTransform(),position:[60,0,20]}};
 doc.roots.push('rotor');
 doc.joints!.push(jointAtWorldFrame(doc,'hinge','right','rotor',[40,0,20],[0,1,0]));
 const document=preparePhysicsDocument(doc),geometry=kernel.evaluate(doc);
 const prepared=await prepareDocumentCollisions(doc,geometry,kernel);
 const measure=vi.spyOn(hingeClearance,'hingeMembersSeparated');
 let world:Awaited<ReturnType<typeof createPhysicsWorld>>|undefined;
 try{
  world=await createPhysicsWorld(document,geometry,prepared,{J});
  expect(measure).toHaveBeenCalledTimes(1);
  expect(world.separatedHingePairCount).toBe(1);
  world.setLinearVelocity('left',[100,0,0]);
  expect(world.separatedHingePairCount).toBe(0);
  world.dispose();
  world=await createPhysicsWorld(document,geometry,prepared,{J});
  expect(measure).toHaveBeenCalledTimes(1);
  expect(world.separatedHingePairCount).toBe(1);
  world.dispose();
  const replacement=new Map(prepared);
  replacement.set('rotor',(await prepareDocumentCollisions(doc,geometry,kernel)).get('rotor')!);
  world=await createPhysicsWorld(document,geometry,replacement,{J});
  expect(measure).toHaveBeenCalledTimes(2);
  replacement.get('rotor')!.hulls[0].positions[0]+=1;
  await expect(createPhysicsWorld(document,geometry,replacement,{J})).rejects.toThrow('missing or stale');
  expect(measure).toHaveBeenCalledTimes(2);
 }finally{world?.dispose();measure.mockRestore();}
});

it('supports explicit adjacent-link exclusion while retaining other-body contacts and legacy behavior',async()=>{
 const authored=(exclude:boolean,obstacle=false)=>{const d=fixture();d.nodes.left.physics!.motion='static';d.nodes.rotor={...structuredClone(d.nodes.right),id:'rotor',name:'rotor',transform:{...identityTransform(),position:[20,0,23]}};d.roots.push('rotor');const joint=jointAtWorldFrame(d,'hinge','left','rotor',[-20,0,20],[0,1,0]);if(exclude)joint.collideConnected=false;d.joints!.push(joint);if(obstacle){d.nodes.probe={...structuredClone(d.nodes.left),id:'probe',name:'probe',transform:{...identityTransform(),position:[20,0,30]}};d.roots.push('probe');}return {d,id:joint.id};};
 const angles:number[]=[];
 for(const [exclude,obstacle]of [[false,false],[true,false],[true,true]]){const {d,id}=authored(exclude,obstacle),world=await worldFor(d);try{for(let i=0;i<20;i++)world.step(.005);angles.push(Math.abs(world.hingeAngle(id)));}finally{world.dispose();}}
 expect(angles[0]).toBeGreaterThan(.01);expect(angles[1]).toBeLessThan(1e-5);expect(angles[2]).toBeGreaterThan(.005);
});

it('robot self-collision mode retains loose-object contacts and ground, and serializes the explicit choice',async()=>{
 const d=fixture();d.nodes.left.physics!.motion='static';d.simulation!.selfCollisions=false;d.nodes.rotor={...structuredClone(d.nodes.right),id:'rotor',name:'rotor',transform:{...identityTransform(),position:[20,0,23]}};d.roots.push('rotor');const hinge=jointAtWorldFrame(d,'hinge','left','rotor',[-20,0,20],[0,1,0]);d.joints!.push(hinge);const world=await worldFor(d);
 try{world.step(.1);expect(Math.abs(world.hingeAngle(hinge.id))).toBeLessThan(1e-5);}finally{world.dispose();}
 d.nodes.probe={...structuredClone(d.nodes.left),id:'probe',name:'probe',transform:{...identityTransform(),position:[20,0,30]}};d.roots.push('probe');const contact=await worldFor(d);try{contact.step(.1);expect(Math.abs(contact.hingeAngle(hinge.id))).toBeGreaterThan(.005);}finally{contact.dispose();}
 const falling=fixture();falling.simulation={...defaultSimulationSettings(),selfCollisions:false};const ground=await worldFor(falling);try{for(let i=0;i<300;i++)ground.step(.005);expect(ground.boundsMm('left').min[2]).toBeGreaterThan(-.1);}finally{ground.dispose();}
});
