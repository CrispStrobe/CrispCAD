// SPDX-License-Identifier: BSD-3-Clause
import {beforeAll,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import initJolt from 'jolt-physics/debug-wasm-compat';
import {createCadSession,defaultPartPhysics,defaultSimulationSettings,identityTransform,parseDocument,serializeDocument,generateModelSource,compileModelSource} from '@brickwright/cad-core';
import {createGeometryKernel} from '@brickwright/cad-geometry';
import type {CadDocument} from '@brickwright/cad-core';
import type {GeometryKernel} from '@brickwright/cad-geometry';
import {createPhysicsWorld,prepareDocumentCollisions} from '../packages/physics/src/index.js';
let kernel:GeometryKernel,J:Awaited<ReturnType<typeof initJolt>>;
beforeAll(async()=>{kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});J=await initJolt();});
const fixture=()=>{const s=createCadSession(),a=s.add({kind:'box',size:[10,10,10]},{transform:{...identityTransform(),position:[0,0,80]}}),b=s.add({kind:'box',size:[10,10,10]},{transform:{...identityTransform(),position:[20,0,80]}});s.update(a,{physics:{...defaultPartPhysics(),motion:'static'}});s.setSimulation({...defaultSimulationSettings(),gravity:[0,0,0],ground:false});return {s,a,b};};
const worldFor=async(doc:CadDocument)=>{const g=kernel.evaluate(doc);return createPhysicsWorld(doc,g,await prepareDocumentCollisions(doc,g,kernel),{J});};
it('authors slider frames, drives millimetres/second and respects travel limits',async()=>{
 const {s,a,b}=fixture(),id=s.addJoint('slider',a,b,[0,0,80],[1,0,0],{limits:[-10,30]});const before=s.serialize(),world=await worldFor(s.state.document);
 try{world.setSliderMotor(id,100,10);for(let i=0;i<40;i++)world.step();expect(world.sliderPosition(id)).toBeCloseTo(20,0);for(let i=0;i<100;i++)world.step();expect(world.sliderPosition(id)).toBeLessThan(30.2);expect(Math.abs(world.pose(b).positionMm[1])).toBeLessThan(.1);world.stopSliderMotor(id,'coast');world.stopSliderMotor(id,'brake');expect(s.serialize()).toBe(before);}finally{world.dispose();}
});
it('limits a ball pivot cone without freezing its free twist',async()=>{
 const {s,a,b}=fixture();s.update(b,{transform:{...identityTransform(),position:[0,0,80]}});s.addJoint('pivot',a,b,[0,0,80],[0,0,1],{coneAngle:Math.PI/9});const world=await worldFor(s.state.document);
 try{world.setAngularVelocity(b,[0,3,1]);let swung=false;for(let i=0;i<200;i++){world.step();const [x,y]=world.pose(b).quaternion;const angle=Math.acos(Math.max(-1,Math.min(1,1-2*(x*x+y*y))));if(angle>.1)swung=true;expect(angle).toBeLessThan(Math.PI/9+.04);}expect(swung).toBe(true);expect(Math.abs(world.pose(b).quaternion[2])).toBeGreaterThan(.1);}finally{world.dispose();}
});
it('uses saved gravity and initial velocities in physical units',async()=>{
 const {s,a,b}=fixture();s.remove([a]);s.setSimulation({...defaultSimulationSettings(),gravity:[0,0,-10],ground:false});s.setInitialVelocity(b,[100,0,0],[0,0,0]);const world=await worldFor(s.state.document);
 try{for(let i=0;i<20;i++)world.step();expect(world.pose(b).positionMm[0]).toBeCloseTo(10,1);expect(world.pose(b).positionMm[2]).toBeCloseTo(-52.5,0);}finally{world.dispose();}
});
it('material mass changes impulse response, and fixed bodies reject throws',async()=>{
 const {s,a,b}=fixture();s.applyPhysicsMaterial('steel',[b]);const world=await worldFor(s.state.document);
 try{expect(()=>world.applyImpulse(a,[.001,0,0])).toThrow('fixed');world.applyImpulse(b,[.001,0,0]);expect(world.linearVelocityMmS(b)[0]).toBeCloseTo(1000/7.8,1);world.setLinearVelocity(b,[250,0,0]);expect(world.linearVelocityMmS(b)[0]).toBeCloseTo(250,1);}finally{world.dispose();}
});
it('keeps connector and tracer definitions through history, source round-trip, paste and deletion',()=>{
 const {s,a,b}=fixture();s.addJoint('slider',a,b,[0,0,80],[1,0,0]);s.addTracer(b,[2,0,0]);const text=s.serialize(),doc=parseDocument(text),source=generateModelSource(doc);
 expect(parseDocument(serializeDocument(compileModelSource(source,doc))).tracers).toEqual(doc.tracers);
 s.select([a,b]);s.duplicate();expect(s.state.document.tracers).toHaveLength(2);expect(new Set(s.state.document.joints!.map(j=>j.control?.port)).size).toBe(2);
 s.remove([b]);expect(s.state.document.tracers).toHaveLength(1);s.undo();expect(s.state.document.tracers).toHaveLength(2);s.undo();expect(s.serialize()).toBe(text);
 const fragment=s.fragment([b]);expect(fragment.joints).toEqual([]);expect(fragment.tracers).toHaveLength(1);s.insert(fragment);expect(s.state.document.tracers).toHaveLength(2);
 s.setRole('hole',[s.state.selection[0]]);expect(s.state.document.version).toBe(8);expect(s.state.document.tracers).toHaveLength(1);
});
it('rejects malformed scenes, bad slider limits and legacy field replacement transactionally',()=>{
 const {s,a,b}=fixture(),before=s.serialize();expect(()=>s.addJoint('slider',a,b,[0,0,80],[0,0,0])).toThrow();expect(s.serialize()).toBe(before);
 expect(()=>s.addJoint('slider',a,b,[0,0,80],[1,0,0],{limits:[20,-20]})).toThrow();expect(s.serialize()).toBe(before);
 expect(()=>s.setSimulation({...defaultSimulationSettings(),gravity:[0,0,Infinity]})).toThrow();expect(s.serialize()).toBe(before);
 const legacy=JSON.parse(before);legacy.version=7;legacy.simulation={opaque:'preserve'};delete legacy.tracers;const old=createCadSession(legacy);expect(()=>old.setSimulation(defaultSimulationSettings())).toThrow('legacy');expect(old.state.document.simulation).toEqual({opaque:'preserve'});
});

it('throws transient analytic balls and applies bounded drag forces without authoring writes',async()=>{
 const {s,b}=fixture(),before=s.serialize(),world=await worldFor(s.state.document);
 try{world.spawnSphere('preview-test',[0,-30,80],[0,100,0],6);for(let i=0;i<20;i++)world.step();expect(world.pose('preview-test').positionMm[1]).toBeCloseTo(-20,1);expect(()=>world.grabBody(s.state.document.roots[0],[0,0,80],[20,0,80])).toThrow('dynamic');world.grabBody(b,[20,0,80],[40,0,80]);for(let i=0;i<100;i++)world.step();expect(world.pose(b).positionMm[0]).toBeGreaterThan(18);expect(world.pose(b).positionMm[0]).toBeLessThan(21);world.releaseGrab();expect(s.serialize()).toBe(before);expect(()=>world.spawnSphere('preview-test',[0,0,0],[0,0,0])).toThrow();}finally{world.dispose();}
});
