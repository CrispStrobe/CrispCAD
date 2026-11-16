// SPDX-License-Identifier: BSD-3-Clause
import {beforeAll,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createGeometryKernel} from '@brickwright/cad-geometry';
import {createCadSession,defaultSimulationSettings,defaultPartPhysics,identityTransform} from '@brickwright/cad-core';
import {createPhysicsWorld,prepareDocumentCollisions} from '@brickwright/cad-physics';
let kernel:Awaited<ReturnType<typeof createGeometryKernel>>;
beforeAll(async()=>{kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});});
async function fixture(kind:'hinge'|'slider',fixed=false){const s=createCadSession(),settings=defaultSimulationSettings();settings.gravity=[0,0,0];s.setSimulation(settings);
 const a=s.add({kind:'box',size:[10,10,10]},{name:'A',transform:{...identityTransform(),position:[-10,0,20]}});
 const b=s.add({kind:'box',size:[10,10,10]},{name:'B',transform:{...identityTransform(),position:[10,0,20]}});
 if(fixed)s.update(a,{physics:{...defaultPartPhysics(),motion:'static'}});
 const joint=s.addJoint(kind,a,b,[0,0,20],[0,0,1]);const doc=structuredClone(s.state.document);s.dispose();const geometry=kernel.evaluate(doc),prepared=await prepareDocumentCollisions(doc,geometry,kernel),world=await createPhysicsWorld(doc,geometry,prepared,{ground:false});return {world,a,b,joint,doc};}
it('applies a motor reaction to both dynamic bodies and reverses physical hinge motion',async()=>{const{world,a,b,joint,doc}=await fixture('hinge'),before=JSON.stringify(doc);try{
 world.applyJointImpulse(joint,1e-6);expect(world.angularVelocity(a)[2]).toBeLessThan(0);expect(world.angularVelocity(b)[2]).toBeGreaterThan(0);expect(world.angularVelocity(a)[2]+world.angularVelocity(b)[2]).toBeCloseTo(0,8);world.step();const first=world.hingeAngle(joint);expect(first).toBeGreaterThan(0);world.applyJointImpulse(joint,-3e-6);world.step();expect(world.hingeAngle(joint)).toBeLessThan(first);expect(JSON.stringify(doc)).toBe(before);
 }finally{world.dispose();}},30000);
it('supports slider force impulses without a velocity motor and rejects invalid commands',async()=>{const{world,a,b,joint}=await fixture('slider',true);try{
 world.applyJointImpulse(joint,1e-4);world.step();expect(world.sliderPosition(joint)).toBeGreaterThan(0);expect(world.pose(a).positionMm).toEqual([0,0,0]);expect(()=>world.applyJointImpulse(joint,Infinity)).toThrow();expect(()=>world.applyJointImpulse('missing',.001)).toThrow();world.dispose();expect(()=>world.applyJointImpulse(joint,.001)).toThrow();
 }finally{world.dispose();}},30000);
