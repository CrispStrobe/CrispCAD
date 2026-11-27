// SPDX-License-Identifier: BSD-3-Clause
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createSimulationClient} from '../packages/editor/src/simulation-client.js';

class MockWorker {
 static latest:MockWorker;
 onmessage?: (event:{data:{request:number;frame:object}})=>void;
 postMessage=vi.fn();
 terminate=vi.fn();
 constructor(){MockWorker.latest=this;}
 reply(request:number,frame:object={time:0}){this.onmessage?.({data:{request,frame}});}
}
const start={op:'start',fixBase:false,wasmURL:'/cad.wasm',locale:'en'} as const;
const step={op:'actuator-step',impulses:[],telemetryOnly:true} as const;
beforeEach(()=>{
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout','performance']});
 vi.stubGlobal('Worker',MockWorker);
});
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();vi.unstubAllGlobals();});

it('reuses a watchdog across 600 timely mechanical replies',async()=>{
 const timers=vi.spyOn(globalThis,'setTimeout'),cancel=vi.spyOn(globalThis,'clearTimeout');
 const client=createSimulationClient(),worker=MockWorker.latest;
 const starting=client.send(start);worker.reply(1);await starting;
 for(let tick=0;tick<600;tick++){
  const pending=client.send({...step,impulses:[]});
  vi.advanceTimersByTime(5);
  const frame={time:(tick+1)*.005};
  worker.reply(tick+2,frame);
  await expect(pending).resolves.toBe(frame);
 }
 expect(timers).toHaveBeenCalledTimes(2);
 expect(cancel).toHaveBeenCalledTimes(1);
 expect(worker.postMessage).toHaveBeenCalledTimes(601);
 client.dispose();
 expect(vi.getTimerCount()).toBe(0);
});

it('rearms for the next pending deadline and rejects every request when the worker stalls',async()=>{
 const client=createSimulationClient(),worker=MockWorker.latest;
 const starting=client.send(start),rejectedStart=expect(starting).rejects.toThrow('exceeded its time budget');
 vi.advanceTimersByTime(500);
 const fast=client.send({op:'step',seconds:.005});worker.reply(2);
 await fast;
 vi.advanceTimersByTime(2000);
 const stuck=client.send({op:'step',seconds:.005}),rejectedStep=expect(stuck).rejects.toThrow('exceeded its time budget');
 vi.advanceTimersByTime(9999);
 expect(worker.terminate).not.toHaveBeenCalled();
 vi.advanceTimersByTime(1);
 await Promise.all([rejectedStart,rejectedStep]);
 expect(worker.terminate).toHaveBeenCalledTimes(1);
 expect(client.available).toBe(false);
 expect(vi.getTimerCount()).toBe(0);
});

it('gives a pending start its full budget when all earlier requests finish',async()=>{
 const client=createSimulationClient(),worker=MockWorker.latest;
 const starting=client.send(start),rejected=expect(starting).rejects.toThrow('exceeded its time budget');
 const fast=client.send({op:'step',seconds:.005});worker.reply(2);
 await fast;
 vi.advanceTimersByTime(59999);
 expect(worker.terminate).not.toHaveBeenCalled();
 vi.advanceTimersByTime(1);
 await rejected;
 expect(worker.terminate).toHaveBeenCalledTimes(1);
});
