import { afterEach, expect, it, vi } from 'vitest';
import { createGeometryClient } from '../packages/editor/dist/geometry-client.js';
import { createDocument } from '@brickwright/cad-core';
class MockWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  messages: any[] = []; terminated = false;
  postMessage(data: unknown) { this.messages.push(data); }
  terminate() { this.terminated = true; }
}
afterEach(() => vi.useRealTimers());
it('routes worker responses by request and disposal rejects unfinished work', async () => {
  const w = new MockWorker(); const client = createGeometryClient('https://host/wasm', () => w as unknown as Worker);
  const a = client.evaluate(createDocument()), b = client.evaluate(createDocument()); const value = { bodies: [], volume: 0, triangles: 0 };
  w.onmessage!({ data: { request: w.messages[1].request, result: value } }); expect(await b).toEqual(value);
  const rejected = expect(a).rejects.toThrow(/disposed/); client.dispose(); await rejected; expect(w.terminated).toBe(true);
});
it('discards a hung kernel and starts a new worker for the next evaluation', async () => {
  vi.useFakeTimers(); const workers: MockWorker[] = []; const client = createGeometryClient('wasm', () => { const w = new MockWorker(); workers.push(w); return w as unknown as Worker; });
  const first = client.evaluate(createDocument()); const failure = expect(first).rejects.toThrow(/30 seconds/); await vi.advanceTimersByTimeAsync(30000); await failure; expect(workers[0].terminated).toBe(true);
  const second = client.evaluate(createDocument()); const next = workers[1]; next.onmessage!({ data: { request: next.messages[0].request, result: { bodies: [], volume: 0, triangles: 0 } } }); expect((await second).volume).toBe(0); client.dispose();
});
it('retains stable feature diagnostics across worker replies and accepts a later recomputation',async()=>{
 const w=new MockWorker(),client=createGeometryClient('wasm',()=>w as unknown as Worker),first=client.evaluate(createDocument());
 const rejected=expect(first).rejects.toMatchObject({name:'FeatureEvaluationError',diagnostic:{source:'feature',id:'extrude-plate',message:'Invalid profile'}});
 w.onmessage!({data:{request:w.messages[0].request,error:'Invalid profile',diagnostic:{source:'feature',id:'extrude-plate',message:'Invalid profile'}}});await rejected;expect(w.terminated).toBe(false);
 const second=client.evaluate(createDocument());w.onmessage!({data:{request:w.messages[1].request,result:{bodies:[],volume:0,triangles:0}}});expect((await second).volume).toBe(0);client.dispose();
});
