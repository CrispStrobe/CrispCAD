// SPDX-License-Identifier: BSD-3-Clause
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {CadDocument} from '@brickwright/cad-core';
import type {SimulationCommand,SimulationFrame,SimulationTelemetry} from '../packages/editor/src/simulation-protocol.js';

// The worker protocol is exercised with a deterministic world. Existing real
// Jolt actuator tests separately establish the mechanics; this test proves that
// selecting a compact reply never changes commands, clocks or sensor samples.
const mock=vi.hoisted(()=>{
 const state={time:0,angle:0,linear:0,servo:0,speed:0,linearSpeed:0,target:0};
 const world={
  get time(){return state.time;},dispose:vi.fn(),
  pose:vi.fn((id:string)=>({positionMm:[Number(id.slice(5))||0,state.linear,state.angle],quaternion:[0,0,0,1]})),
  hingeAngle:vi.fn((id:string)=>id==='servo'?state.servo:state.angle),sliderPosition:vi.fn(()=>state.linear),
  bodyRay:vi.fn(()=>100-state.linear+state.angle),
  applyJointImpulse:vi.fn((id:string,impulse:number)=>{if(id==='slider')state.linearSpeed+=impulse*10;else state.speed+=impulse*100;}),
  setHingeServo:vi.fn((_id:string,angle:number)=>{state.target=angle;}),coastHingeMotor:vi.fn(),
  step:vi.fn((seconds:number)=>{state.time+=seconds;state.angle+=state.speed*seconds;state.linear+=state.linearSpeed*seconds;state.servo+=(state.target-state.servo)*.25;})
 };
 const create=vi.fn(async()=>{for(const key of Object.keys(state) as (keyof typeof state)[])state[key]=0;return world;});
 return {world,create};
});
vi.mock('@brickwright/cad-geometry',()=>({createGeometryKernel:async()=>({evaluate:()=>({})})}));
vi.mock('@brickwright/cad-physics',()=>({createPhysicsWorld:mock.create,prepareDocumentCollisions:async()=>({})}));
let scope:{onmessage:(event:MessageEvent)=>Promise<void>;postMessage:ReturnType<typeof vi.fn>},sequence=0;
beforeEach(async()=>{
 vi.resetModules();vi.clearAllMocks();sequence=0;
 scope={onmessage:async()=>{},postMessage:vi.fn()};vi.stubGlobal('self',scope);
 await import('../packages/editor/src/simulation.worker.js');
});
afterEach(()=>vi.unstubAllGlobals());
function scene(bodyCount=128):CadDocument{
 const roots=Array.from({length:bodyCount},(_,index)=>`body-${index}`);
 return {id:'telemetry-scene',roots,nodes:Object.fromEntries(roots.map(id=>[id,{id,name:id,role:'solid'}])),joints:[{id:'hinge',kind:'hinge'},{id:'slider',kind:'slider'},{id:'servo',kind:'hinge'}]} as unknown as CadDocument;
}
async function send(command:SimulationCommand){
 const request=++sequence;await scope.onmessage({data:{...command,request}} as MessageEvent);
 const response=scope.postMessage.mock.lastCall![0];expect(response.request).toBe(request);return response;
}
const start=(document=scene())=>send({op:'start',document,wasmURL:'/manifold.wasm',fixBase:false,locale:'en'});
const command={op:'actuator-step',impulses:[{id:'hinge',impulse:.001},{id:'slider',impulse:.002}],rays:[{id:'range',bodyId:'body-0',originMm:[0,0,0],direction:[1,0,0],rangeMm:4000}],servos:[{id:'servo',angleRad:.25,torqueNm:.01,enabled:true}]} as const;
const actuation=()=>structuredClone(command) as unknown as Extract<SimulationCommand,{op:'actuator-step'}>;
const withoutPoses=(frame:SimulationFrame):SimulationTelemetry=>{const {poses,...sample}=frame;return sample;};

it('sends identical 200 Hz feedback with 75% fewer pose queries for a four-step displayed batch',async()=>{
 const document=scene(),saved=JSON.stringify(document),full:SimulationFrame[]=[],batched:(SimulationTelemetry|SimulationFrame)[]=[];
 await start(document);mock.world.pose.mockClear();
 for(let index=0;index<4;index++){const response=await send(actuation());expect(response.error).toBeUndefined();full.push(response.frame);}
 const fullPoseQueries=mock.world.pose.mock.calls.length;expect(fullPoseQueries).toBe(4*document.roots.length);
 await start(document);mock.world.pose.mockClear();
 for(let index=0;index<4;index++){
  const response=await send({...actuation(),...(index<3?{telemetryOnly:true}:{})});expect(response.error).toBeUndefined();batched.push(response.frame);
  if(index<3){expect(response.frame).not.toHaveProperty('poses');expect(response.frame).toEqual(withoutPoses(full[index]));expect(mock.world.pose).not.toHaveBeenCalled();}
  else expect(response.frame).toEqual(full[index]);
 }
 const batchedPoseQueries=mock.world.pose.mock.calls.length;expect(batchedPoseQueries).toBe(document.roots.length);
 const fullBytes=Buffer.byteLength(JSON.stringify(full)),batchedBytes=Buffer.byteLength(JSON.stringify(batched));
 expect(batchedBytes).toBeLessThan(fullBytes*.3);
 expect(batched.at(-1)!.time).toBe(.02);expect(JSON.stringify(document)).toBe(saved);
 console.info(JSON.stringify({benchmark:'cad-coupled-telemetry',bodies:document.roots.length,substeps:4,fullPoseQueries,batchedPoseQueries,fullBytes,batchedBytes,payloadReduction:1-batchedBytes/fullBytes}));
});

it('keeps full legacy actuator and manual replies, including sensor and linear fields',async()=>{
 await start(scene(2));
 const reply=await send(actuation());expect(reply.error).toBeUndefined();expect(reply.frame.poses).toHaveLength(2);
 expect(reply.frame).toHaveProperty('angles.hinge');expect(reply.frame).toHaveProperty('angles.servo');
 expect(reply.frame).toHaveProperty('linearPositions.slider');expect(reply.frame).toHaveProperty('linearSpeeds.slider');expect(reply.frame).toHaveProperty('distances.range');
 const manual=await send({op:'step',seconds:.005});expect(manual.frame.poses).toHaveLength(2);expect(manual.frame.time).toBe(.01);
 const sensed=await send({op:'sense',rays:actuation().rays!});expect(sensed.frame.poses).toHaveLength(2);expect(sensed.frame.time).toBe(.01);
});

it('applies the same actuator validation before a compact step can advance the clock',async()=>{
 await start(scene(2));
 for(const impulses of [[{id:'hinge',impulse:Infinity}],[{id:'missing',impulse:.001}],[{id:'hinge',impulse:.001},{id:'hinge',impulse:.001}]]){
  const response=await send({...actuation(),impulses,telemetryOnly:true});expect(response.error).toMatch(/Invalid actuator impulse/);expect(mock.world.time).toBe(0);
 }
 const servo=await send({...actuation(),servos:[{id:'servo',angleRad:NaN,torqueNm:.01,enabled:true}],telemetryOnly:true});expect(servo.error).toMatch(/Invalid position servo/);expect(mock.world.time).toBe(0);
 const valid=await send({...actuation(),telemetryOnly:true});expect(valid.error).toBeUndefined();expect(valid.frame.time).toBe(.005);expect(valid.frame).not.toHaveProperty('poses');
});
