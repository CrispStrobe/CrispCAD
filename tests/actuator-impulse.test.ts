// SPDX-License-Identifier: BSD-3-Clause
import {beforeAll,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createGeometryKernel} from '@brickwright/cad-geometry';
import {createCadSession,defaultSimulationSettings,defaultPartPhysics,identityTransform} from '@brickwright/cad-core';
import {createPhysicsWorld,prepareDocumentCollisions} from '@brickwright/cad-physics';
let kernel:Awaited<ReturnType<typeof createGeometryKernel>>;
beforeAll(async()=>{kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});});
async function fixture(kind:'hinge'|'slider',fixed=false,spaced=false){const s=createCadSession(),settings=defaultSimulationSettings();settings.gravity=[0,0,0];s.setSimulation(settings);
 const a=s.add({kind:'box',size:[10,10,10]},{name:'A',transform:{...identityTransform(),position:[spaced?-50:-10,0,20]}});
 const b=s.add({kind:'box',size:[10,10,10]},{name:'B',transform:{...identityTransform(),position:[10,0,20]}});
 if(fixed)s.update(a,{physics:{...defaultPartPhysics(),motion:'static'}});
 const joint=s.addJoint(kind,a,b,[spaced?15:0,spaced?5:0,spaced?25:20],[0,0,1]);const doc=structuredClone(s.state.document);s.dispose();const geometry=kernel.evaluate(doc),prepared=await prepareDocumentCollisions(doc,geometry,kernel),world=await createPhysicsWorld(doc,geometry,prepared,{ground:false});return {world,a,b,joint,doc};}
it('applies a motor reaction to both dynamic bodies and reverses physical hinge motion',async()=>{const{world,a,b,joint,doc}=await fixture('hinge'),before=JSON.stringify(doc);try{
 world.applyJointImpulse(joint,1e-6);expect(world.angularVelocity(a)[2]).toBeLessThan(0);expect(world.angularVelocity(b)[2]).toBeGreaterThan(0);expect(world.angularVelocity(a)[2]+world.angularVelocity(b)[2]).toBeCloseTo(0,8);world.step();const first=world.hingeAngle(joint);expect(first).toBeGreaterThan(0);world.applyJointImpulse(joint,-3e-6);world.step();expect(world.hingeAngle(joint)).toBeLessThan(first);expect(JSON.stringify(doc)).toBe(before);
 }finally{world.dispose();}},30000);
it('supports slider force impulses without a velocity motor and rejects invalid commands',async()=>{const{world,a,b,joint}=await fixture('slider',true);try{
 world.applyJointImpulse(joint,1e-4);world.step();expect(world.sliderPosition(joint)).toBeGreaterThan(0);expect(world.pose(a).positionMm).toEqual([0,0,0]);expect(()=>world.applyJointImpulse(joint,Infinity)).toThrow();expect(()=>world.applyJointImpulse('missing',.001)).toThrow();world.dispose();expect(()=>world.applyJointImpulse(joint,.001)).toThrow();
 }finally{world.dispose();}},30000);

it('body-mounted rays ignore their own rigid assembly and see external obstacles',async()=>{
 const s=createCadSession();
 const host=s.add({kind:'box',size:[20,20,20]});
 const attachment=s.add({kind:'box',size:[20,20,20]},{transform:{...identityTransform(),position:[20,0,0]}});
 const wall=s.add({kind:'box',size:[20,20,20]},{transform:{...identityTransform(),position:[100,0,0]}});
 s.addJoint('fixed',host,attachment,[10,0,0],[1,0,0]);
 const doc=s.state.document,geometry=kernel.evaluate(doc),prepared=await prepareDocumentCollisions(doc,geometry,kernel),world=await createPhysicsWorld(doc,geometry,prepared,{ground:false});
 try{
  expect(world.bodyRay(host,[0,0,0],[1,0,0],200)).toBeCloseTo(90,2);
  expect(world.bodyRay(host,[0,0,0],[-1,0,0],200)).toBeNull();
  expect(()=>world.bodyRay(host,[0,0,0],[0,0,0],200)).toThrow('Invalid body sensor ray');
  expect(()=>world.validateBodyRay(host,[0,0,0],[0,0,0],200)).toThrow('Invalid body sensor ray');
  expect(()=>world.validateBodyRay(host,[0,0,0],[1,0,0],200)).not.toThrow();
  expect(world.raycast([40,0,0],[200,0,0])?.bodyId).toBe(wall);
 }finally{world.dispose();s.dispose();}
});

it('an implicit ideal position servo reaches its target with finite torque and reaction',async()=>{const {world,a,b,joint}=await fixture('hinge',true,true);try{world.setHingeServo(joint,Math.PI/4,.001);for(let i=0;i<1000;i++){world.setHingeServo(joint,Math.PI/4,.001);world.step(.005);}expect(world.hingeAngle(joint)).toBeCloseTo(Math.PI/4,2);expect(()=>world.setHingeServo(joint,NaN,.001)).toThrow();}finally{world.dispose();}});

it('keeps qualified rover hinge clearances under circuit-like startup torque',async()=>{
 const {createTTRoverDocument}=await import('../packages/editor/src/tt-rover.js'),doc=createTTRoverDocument(),source=JSON.stringify(doc),geometry=kernel.evaluate(doc),prepared=await prepareDocumentCollisions(doc,geometry,kernel),world=await createPhysicsWorld(doc,geometry,prepared);
 const ids=['drive-a','drive-b'],previous=ids.map(id=>world.hingeAngle(id)),speed=[0,0];
 try{
  for(let i=0;i<100;i++){
   for(let k=0;k<2;k++)world.applyJointImpulse(ids[k],(3.2-.25*speed[k])/15*.25*.005);
   world.step(.005);expect(world.separatedHingePairCount).toBe(2);
   for(let k=0;k<2;k++){const angle=world.hingeAngle(ids[k]);speed[k]=Math.atan2(Math.sin(angle-previous[k]),Math.cos(angle-previous[k]))/.005;previous[k]=angle;}
  }
  expect(world.pose('chassis').positionMm[0]).toBeGreaterThan(50);expect(JSON.stringify(doc)).toBe(source);
 }finally{world.dispose();}
},60000);
