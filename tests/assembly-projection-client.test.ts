// SPDX-License-Identifier: BSD-3-Clause
import {expect,it,vi} from 'vitest';
import type {GeometryResult} from '@brickwright/cad-geometry';
import type {AssemblyProjection} from '../packages/editor/src/assembly-drawing.js';
import type {AssemblyProjectionResponse} from '../packages/editor/src/assembly-projection.worker.js';
import {createAssemblyProjectionClient} from '../packages/editor/src/assembly-projection-client.js';

function fixture(){
 const workers:ReturnType<typeof mockWorker>[]=[];
 const client=createAssemblyProjectionClient(()=>{
  const worker=mockWorker();
  workers.push(worker);
  return worker as unknown as Worker;
 });
 return {client,workers};
}
function mockWorker(){
 return {
  postMessage:vi.fn(),terminate:vi.fn(),
  onmessage:undefined as ((event:MessageEvent<AssemblyProjectionResponse>)=>void)|undefined,
  onerror:undefined as ((event:ErrorEvent)=>void)|undefined,
  receive(data:AssemblyProjectionResponse){this.onmessage?.({data} as MessageEvent<AssemblyProjectionResponse>);}
 };
}
const geometry=(sourceKey:string):GeometryResult=>({sourceKey,bodies:[],triangles:0,volume:0});
const projection=(sourceKey:string):AssemblyProjection=>({sourceKey,views:[],origin:[0,0,0],bodyIds:[]});

it('shares one pending projection and reuses its result for identical geometry',async()=>{
 const {client,workers}=fixture(),source=geometry('same-shape');
 const first=client.project(source);
 expect(client.project(geometry('same-shape'))).toBe(first);
 expect(workers).toHaveLength(1);
 expect(workers[0].postMessage).toHaveBeenCalledWith({geometry:source,locale:'en'});
 workers[0].receive({projection:projection('same-shape')});
 const value=await first;
 expect(await client.project(geometry('same-shape'))).toBe(value);
 expect(workers[0].terminate).toHaveBeenCalledOnce();
 expect(workers).toHaveLength(1);
 client.dispose();
 await expect(client.project(source)).rejects.toThrow('disposed');
});

it('terminates outdated work and ignores its late reply',async()=>{
 const {client,workers}=fixture();
 const obsolete=client.project(geometry('old'));
 const rejected=expect(obsolete).rejects.toThrow('assembly changed');
 const current=client.project(geometry('new'));
 await rejected;
 expect(workers[0].terminate).toHaveBeenCalledOnce();
 workers[0].receive({projection:projection('old')});
 const value=projection('new');
 workers[1].receive({projection:value});
 expect(await current).toBe(value);
 expect(await client.project(geometry('new'))).toBe(value);
});

it('cleans up a crashed or timed-out worker and lets the next request retry',async()=>{
 vi.useFakeTimers();
 const {client,workers}=fixture(),source=geometry('shape');
 try{
  const crash=client.project(source);
  workers[0].onerror?.({message:'Worker unavailable'} as ErrorEvent);
  await expect(crash).rejects.toThrow('Worker unavailable');
  const timeout=client.project(source);
  const rejected=expect(timeout).rejects.toThrow('exceeded 30 seconds');
  await vi.advanceTimersByTimeAsync(30000);
  await rejected;
  const retry=client.project(source);
  workers[2].receive({projection:projection('shape')});
  await expect(retry).resolves.toMatchObject({sourceKey:'shape'});
  const disposed=client.project(geometry('other'));
  const pending=expect(disposed).rejects.toThrow('disposed');
  client.dispose();
  await pending;
  for(const worker of workers)expect(worker.terminate).toHaveBeenCalledOnce();
 }finally{
  client.dispose();
  vi.useRealTimers();
 }
});
