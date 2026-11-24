// SPDX-License-Identifier: BSD-3-Clause
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createCadSession} from '@brickwright/cad-core';
import {createSimulationController} from '../packages/editor/src/simulation-controller.js';
import type {SimulationFrame,SimulationTelemetry} from '../packages/editor/src/simulation-protocol.js';

const client=vi.hoisted(()=>({available:true,send:vi.fn(),dispose:vi.fn()}));
vi.mock('../packages/editor/src/simulation-client.js',()=>({createSimulationClient:()=>client}));
const fullFrame=(time=0):SimulationFrame=>({time,poses:[{id:'body',positionMm:[time*1000,0,0],quaternion:[0,0,0,1]}],angles:{hinge:time*180},speeds:{hinge:180},linearPositions:{slider:time*10},linearSpeeds:{slider:10},distances:{range:100-time}});
const telemetry=(time=.005):SimulationTelemetry=>{const {poses,...sample}=fullFrame(time);return sample;};
const deferred=<T>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};};
beforeEach(()=>{
 vi.stubGlobal('document',Object.assign(new EventTarget(),{hidden:false,baseURI:'https://brickwright.test/'}));
 vi.stubGlobal('window',new EventTarget());
 client.send.mockReset().mockImplementation(async()=>fullFrame());client.dispose.mockReset();
});
afterEach(()=>vi.unstubAllGlobals());
function fixture(){
 const session=createCadSession();session.add({kind:'box',size:[10,10,10]});
 const changed=vi.fn(),frameChanged=vi.fn();
 const controller=createSimulationController(session,'/manifold.wasm',async()=>{},changed,frameChanged);
 return {session,controller,changed,frameChanged,dispose:()=>{controller.dispose();session.dispose();}};
}

it('keeps intermediate samples separate from full snapshots and records only the completed displayed batch',async()=>{
 const f=fixture(),document=f.session.serialize(),revision=f.session.state.revision;
 try{
  const lease=await f.controller.acquireExternalClock();f.changed.mockClear();f.frameChanged.mockClear();
  const reply=telemetry();client.send.mockResolvedValueOnce(reply);
  const sample=await lease.stepTelemetry([{id:'hinge',impulse:.001}]);
  expect(client.send).toHaveBeenLastCalledWith({op:'actuator-step',impulses:[{id:'hinge',impulse:.001}],rays:[],servos:[],telemetryOnly:true});
  expect(sample).toEqual(reply);expect(sample).not.toHaveProperty('poses');
  sample.angles.hinge=999;sample.distances!.range=-1;
  expect(reply.angles.hinge).toBe(.9);expect(reply.distances!.range).toBe(99.995);
  expect(lease.snapshot()).toEqual(fullFrame());expect(f.controller.state.time).toBe(0);
  expect(f.changed).not.toHaveBeenCalled();expect(f.frameChanged).not.toHaveBeenCalled();
  for(let step=2;step<=9;step++){client.send.mockResolvedValueOnce(telemetry(step*.005));await lease.stepTelemetry([]);}
  client.send.mockResolvedValueOnce(fullFrame(.05));
  const complete=await lease.step([],[],[],false);
  expect(client.send).toHaveBeenLastCalledWith({op:'actuator-step',impulses:[],rays:[],servos:[]});
  expect(f.frameChanged).not.toHaveBeenCalled();expect(lease.snapshot()).toEqual(fullFrame(.05));
  complete.poses[0].positionMm[0]=-100;expect(lease.snapshot().poses[0].positionMm[0]).toBe(50);
  lease.present();expect(f.frameChanged).toHaveBeenCalledExactlyOnceWith(fullFrame(.05));
  expect(f.controller.replayRange()).toEqual({first:0,last:.05,count:2});
  expect(f.session.serialize()).toBe(document);expect(f.session.state.revision).toBe(revision);
  f.controller.previousFrame();expect(f.frameChanged).toHaveBeenLastCalledWith(fullFrame());
 }finally{f.dispose();}
});

it('preserves full-frame default steps for callers without telemetry support',async()=>{
 const f=fixture();try{
  const lease=await f.controller.acquireExternalClock();f.frameChanged.mockClear();
  client.send.mockResolvedValueOnce(fullFrame(.005));const frame=await lease.step([]);
  expect(frame).toEqual(fullFrame(.005));expect(f.frameChanged).toHaveBeenCalledExactlyOnceWith(fullFrame(.005));
  expect(f.controller.state.time).toBe(.005);expect(f.controller.replayRange().count).toBe(1);
 }finally{f.dispose();}
});

it('serializes telemetry and full steps under the same external lease',async()=>{
 const f=fixture();try{
  const lease=await f.controller.acquireExternalClock(),pending=deferred<SimulationTelemetry>();client.send.mockReturnValueOnce(pending.promise);
  const first=lease.stepTelemetry([]);
  await expect(lease.stepTelemetry([])).rejects.toThrow('already pending');
  await expect(lease.step([])).rejects.toThrow('already pending');
  pending.resolve(telemetry());await expect(first).resolves.toEqual(telemetry());
  client.send.mockResolvedValueOnce(fullFrame(.01));await expect(lease.step([],[],[],false)).resolves.toEqual(fullFrame(.01));
 }finally{f.dispose();}
});

it('rejects stale telemetry after release and cannot stop or publish into a replacement lease',async()=>{
 const f=fixture();try{
  const old=await f.controller.acquireExternalClock(),pending=deferred<SimulationTelemetry>();client.send.mockReturnValueOnce(pending.promise);
  const first=old.stepTelemetry([]),rejected=expect(first).rejects.toThrow('Simulation was stopped');old.release();
  const replacement=await f.controller.acquireExternalClock();f.frameChanged.mockClear();
  pending.resolve(telemetry());await rejected;
  expect(f.frameChanged).not.toHaveBeenCalled();expect(replacement.snapshot()).toEqual(fullFrame());
  const sends=client.send.mock.calls.length;old.release();expect(client.send.mock.calls.length).toBe(sends);
  await expect(old.stepTelemetry([])).rejects.toThrow('Simulation was stopped');
  client.send.mockResolvedValueOnce(fullFrame(.005));await replacement.step([]);expect(f.controller.state.time).toBe(.005);
 }finally{f.dispose();}
});

it.each(['edit','dispose'] as const)('does not publish pending telemetry after %s invalidates the simulation',async action=>{
 const f=fixture();try{
  const lease=await f.controller.acquireExternalClock(),pending=deferred<SimulationTelemetry>();client.send.mockReturnValueOnce(pending.promise);
  const sample=lease.stepTelemetry([]),rejected=expect(sample).rejects.toThrow('Simulation was stopped');
  if(action==='edit')f.session.add({kind:'box',size:[5,5,5]});else f.controller.dispose();
  f.frameChanged.mockClear();pending.resolve(telemetry());await rejected;
  expect(f.frameChanged).not.toHaveBeenCalled();expect(client.dispose).toHaveBeenCalled();
 }finally{f.dispose();}
});

it('rejects invalid compact actuator commands without consuming the lease',async()=>{
 const f=fixture();try{
  const lease=await f.controller.acquireExternalClock(),sends=client.send.mock.calls.length;
  for(const impulse of [Infinity,NaN,1.01,-1.01])await expect(lease.stepTelemetry([{id:'hinge',impulse}])).rejects.toThrow('Invalid actuator impulse');
  expect(client.send.mock.calls.length).toBe(sends);
  client.send.mockResolvedValueOnce(telemetry());await expect(lease.stepTelemetry([])).resolves.toEqual(telemetry());
 }finally{f.dispose();}
});


it('keeps a circuit clock acquisition alive when the window blurs during preparation',async()=>{
 const f=fixture(),initial=deferred<SimulationFrame>();
 try{
  client.send.mockReturnValueOnce(initial.promise);
  const acquiring=f.controller.acquireExternalClock();
  await vi.waitFor(()=>expect(client.send).toHaveBeenCalled());
  expect(f.controller.state.state).toBe('preparing');
  window.dispatchEvent(new Event('blur'));
  initial.resolve(fullFrame());
  const lease=await acquiring;
  expect(f.controller.state.state).toBe('running');
  client.send.mockResolvedValueOnce(fullFrame(.005));
  await lease.step([]);
  expect(f.controller.state.time).toBe(.005);
  lease.release();
 }finally{f.dispose();}
});

it('returns to the editable design when a circuit releases its clock, retaining recorded motion',async()=>{
 const f=fixture(),source=f.session.serialize();try{
  const lease=await f.controller.acquireExternalClock();
  client.send.mockResolvedValueOnce(fullFrame(.005));await lease.step([]);
  const recording=f.controller.replayRange();f.frameChanged.mockClear();
  lease.release();
  expect(f.controller.state.state).toBe('idle');
  expect(f.frameChanged).toHaveBeenLastCalledWith(null);
  expect(client.send).toHaveBeenLastCalledWith({op:'park'});
  expect(f.controller.replayRange()).toEqual(recording);
  expect(f.session.serialize()).toBe(source);
  f.controller.previousFrame();
  expect(f.frameChanged).toHaveBeenLastCalledWith(fullFrame());
  expect(f.controller.state.state).toBe('paused');
  await f.controller.stop();
  expect(f.controller.state.state).toBe('idle');
  expect(f.controller.replayRange()).toEqual(recording);
  const replacement=await f.controller.acquireExternalClock();
  expect(replacement.snapshot().time).toBe(0);
  expect(client.send).toHaveBeenLastCalledWith(expect.objectContaining({op:'start'}));
 }finally{f.dispose();}
});

it('returns to the editable design on manual Stop without requiring Reset',async()=>{
 const f=fixture();try{
  await f.controller.prepare();f.frameChanged.mockClear();
  await f.controller.stop();
  expect(f.controller.state.state).toBe('idle');
  expect(f.frameChanged).toHaveBeenLastCalledWith(null);
 }finally{f.dispose();}
});

it('inspects the end of a stopped recording and returns from replay to the editable design',async()=>{
 const f=fixture();try{
  const lease=await f.controller.acquireExternalClock();
  for(const time of [.05,.1]){client.send.mockResolvedValueOnce(fullFrame(time));await lease.step([]);}
  lease.release();f.frameChanged.mockClear();
  f.controller.previousFrame();
  expect(f.frameChanged).toHaveBeenLastCalledWith(fullFrame(.05));
  f.controller.live();
  expect(f.frameChanged).toHaveBeenLastCalledWith(null);
  expect(f.controller.state.state).toBe('idle');
  expect(f.controller.snapshot().time).toBe(.1);
 }finally{f.dispose();}
});

it('keeps a completed worker warm through Stop and invalidates it on an edit',async()=>{
 const f=fixture();
 try{
  await f.controller.prepare();
  await f.controller.stop();
  expect(client.send).toHaveBeenLastCalledWith({op:'park'});
  expect(client.dispose).not.toHaveBeenCalled();
  expect(f.controller.state.state).toBe('idle');
  await f.controller.prepare();
  expect(client.send).toHaveBeenLastCalledWith(expect.objectContaining({op:'start'}));
  await f.controller.stop();
  f.session.add({kind:'box',size:[3,3,3]});
  expect(client.dispose).toHaveBeenCalledOnce();
 }finally{f.dispose();}
});
