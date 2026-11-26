// SPDX-License-Identifier: BSD-3-Clause
// Guards for heavy exact jobs (iPad safety): the WebAssembly memory ceiling, pre-flight refusal of
// fillets/chamfers/shells that touch too many edges or faces, and the editor's exact channel:
// recycling the worker after a job that grew its memory or broke its kernel, the request budget
// from the host's limits, cancellation and the busy state.
import {afterEach,beforeAll,describe,expect,it,vi} from 'vitest';
import {createCadSession,createDocument,identityTransform} from '@brickwright/cad-core';
import type {CadDocument,ExactFeatureSettings} from '@brickwright/cad-core';
import {ExactKernelError,lowerDocumentNode,capWasmMemory,checkExactFeatureCost,createExactBackend,EXACT_LIMITS_DESKTOP,EXACT_LIMITS_NONE,EXACT_LIMITS_TABLET,exactFeatureCost,exactKernelIdentity,isFatalExactError,resolveExactLimits,runExactRequest,withWasmMemoryCap} from '@brickwright/cad-exact';
import type {ExactBackend} from '@brickwright/cad-exact';
import * as limitsOnly from '@brickwright/cad-exact/limits';
import {createGeometryClient} from '../packages/editor/dist/geometry-client.js';
import type {ExactActivity} from '../packages/editor/dist/geometry-client.js';

const MiB=1048576;
/** A module with one exported memory: 1 page initially, at most `maxPages`, the max as `width` LEB bytes. */
function memoryModule(maxPages:number|undefined,width=3):Uint8Array{
 const lebOf=(value:number,bytes?:number)=>{const out=[];do{let b=value&127;value=Math.floor(value/128);if(value||bytes&&out.length<bytes-1)b|=128;out.push(b);}while(value||bytes&&out.length<bytes);return out;};
 const limits=maxPages===undefined?[0,1]:[1,1,...lebOf(maxPages,width)];
 const memory=[1,...limits],exports=[1,1,'m'.charCodeAt(0),2,0];
 return new Uint8Array([0,0x61,0x73,0x6d,1,0,0,0,5,memory.length,...memory,7,exports.length,...exports]);
}
const memoryOf=async(bytes:Uint8Array)=>((await WebAssembly.instantiate(bytes)).instance.exports.m as WebAssembly.Memory);

describe('WebAssembly memory ceiling',()=>{
 it('lowers a module\'s memory maximum in place, so growth past it fails',async()=>{
  const original=memoryModule(65536);
  const capped=capWasmMemory(original,3*65536)!;
  expect(capped).toBeInstanceOf(Uint8Array);expect(capped.length).toBe(original.length);
  expect(original).toEqual(memoryModule(65536));// the input is not changed
  const memory=await memoryOf(capped);
  expect(memory.grow(2)).toBe(1);
  expect(()=>memory.grow(1)).toThrow(RangeError);
  expect(memory.buffer.byteLength).toBe(3*65536);
  // Uncapped, the same growth succeeds.
  expect((await memoryOf(original)).grow(3)).toBe(1);
 });
 it('never goes below the initial size and leaves modules it cannot or need not change alone',()=>{
  const capped=capWasmMemory(memoryModule(65536),1)!;
  expect(capped).toBeDefined();
  expect(capWasmMemory(memoryModule(undefined),3*65536)).toBeUndefined();// no maximum: section would grow
  expect(capWasmMemory(memoryModule(4),8*65536)).toBeUndefined();// already lower
  expect(capWasmMemory(memoryModule(65536),Infinity)).toBeUndefined();
  expect(capWasmMemory(new Uint8Array([1,2,3,4,5,6,7,8]),65536)).toBeUndefined();// not WebAssembly
  // A ceiling that does not fit the old number's width is refused rather than moving offsets.
  expect(capWasmMemory(memoryModule(100,1),2*65536)).toBeDefined();
  expect(capWasmMemory(memoryModule(127,1),126*65536)).toBeDefined();
 });
 it('caps modules instantiated while the kernel loads, and restores WebAssembly afterwards',async()=>{
  const instantiate=WebAssembly.instantiate;
  const {value,capped}=await withWasmMemoryCap(2*65536,()=>memoryOf(memoryModule(65536)));
  expect(capped).toBe(true);expect(()=>value.grow(2)).toThrow(RangeError);
  expect(WebAssembly.instantiate).toBe(instantiate);
  await expect(withWasmMemoryCap(2*65536,async()=>{throw new Error('load failed');})).rejects.toThrow('load failed');
  expect(WebAssembly.instantiate).toBe(instantiate);
  expect((await withWasmMemoryCap(undefined,async()=>1)).capped).toBe(false);
 });
 it('tells fatal kernel failures from ordinary refusals',()=>{
  expect(isFatalExactError(new WebAssembly.RuntimeError('unreachable'))).toBe(true);
  expect(isFatalExactError(new Error('Aborted(OOM)'))).toBe(true);
  expect(isFatalExactError(new Error('SMLib mesh failed',{cause:new Error('SM_ERR_OUT_OF_MEMORY: the kernel ran out of memory (std::bad_alloc)')}))).toBe(true);
  expect(isFatalExactError(new Error('SMLib fillet failed: the radius may be too large'))).toBe(false);
  expect(isFatalExactError(undefined)).toBe(false);
 });
});

describe('limits',()=>{
 it('resolve partial host limits onto the tablet defaults, and load no kernel code',()=>{
  expect(resolveExactLimits(undefined)).toEqual(EXACT_LIMITS_TABLET);
  expect(resolveExactLimits({maxFeatureEdges:500,maxMemoryBytes:-1})).toEqual({...EXACT_LIMITS_TABLET,maxFeatureEdges:500});
  expect(resolveExactLimits({},EXACT_LIMITS_DESKTOP)).toEqual(EXACT_LIMITS_DESKTOP);
  expect(EXACT_LIMITS_DESKTOP.maxFeatureEdges).toBeGreaterThan(EXACT_LIMITS_TABLET.maxFeatureEdges);
  expect(EXACT_LIMITS_TABLET.maxMemoryBytes).toBeLessThanOrEqual(512*MiB);
  // The editor's main thread imports this module: it must not pull in the kernel package.
  expect(Object.keys(limitsOnly).sort()).toEqual(['CURVED_EDGE_WEIGHT','EXACT_LIMITS_DESKTOP','EXACT_LIMITS_NONE','EXACT_LIMITS_TABLET','resolveExactLimits']);
 });
});

let exact:ExactBackend;
beforeAll(async()=>{exact=await createExactBackend();},120_000);
/** A plate with `holes` holes as one sketch region (top face: 4 lines + one circle per hole). */
function plate(holes:number,settings:ExactFeatureSettings):{document:CadDocument;id:string}{
 const session=createCadSession(undefined,{kernels:[exactKernelIdentity]});
 const cols=Math.ceil(Math.sqrt(holes*1.25)),rows=Math.ceil(holes/cols),w=cols*6+2,d=rows*6+2;
 const loops=[{kind:'outline' as const,id:'outside',points:[[0,0],[w,0],[w,d],[0,d]] as [number,number][]},
  ...Array.from({length:holes},(_,i)=>({kind:'circle' as const,id:`hole-${i}`,center:[4+i%cols*6,4+Math.floor(i/cols)*6] as [number,number],radius:2,segments:64}))];
 const body=session.addSketchExtrusion({kind:'region',id:'plate',loops},{distance:settings.operation==='shell'?4:3});
 const [id]=session.addExactFeatures([{source:body,settings}]);
 return {document:session.state.document,id};
}
const top={faceNormal:[0,0,1] as [number,number,number],outermost:true as const};

describe('pre-flight refusal of heavy exact features',()=>{
 it('counts the edges a fillet or chamfer touches and the faces a shell offsets',()=>{
  exact.kernel.scope(()=>{
   const box=exact.kernel.box([20,30,10]);
   expect(exactFeatureCost(box,'fillet','all')).toEqual({edges:12,curvedEdges:0,faces:6,weightedEdges:12});
   expect(exactFeatureCost(box,'chamfer',top)).toEqual({edges:4,curvedEdges:0,faces:6,weightedEdges:4});
   const P=exact.kernel.profile,holes=Array.from({length:10},(_,i)=>P.translate(P.circle(2),[4+i*6,4]));
   const holed=exact.kernel.extrude(P.subtract(P.rectangle(64,8,false),...holes),3);
   expect(exactFeatureCost(holed,'fillet',top)).toEqual({edges:14,curvedEdges:10,faces:16,weightedEdges:44});
   expect(exactFeatureCost(holed,'shell')?.faces).toBe(16);
   expect(()=>checkExactFeatureCost(holed,'fillet',top,{maxFeatureEdges:43,maxShellFaces:100})).toThrow('Rounding 14 edges (10 of them curved) at once is too much for the exact kernel on this device, which allows about 10 curved or 43 straight edges per feature. Choose a face with fewer edges.');
   expect(()=>checkExactFeatureCost(holed,'chamfer',top,{maxFeatureEdges:43,maxShellFaces:100})).toThrow(/^Beveling 14 edges \(10 of them curved\)/);
   expect(()=>checkExactFeatureCost(holed,'shell',undefined,{maxFeatureEdges:100,maxShellFaces:15})).toThrow(/^Shelling a body with 16 faces is too much for the exact kernel on this device, which allows 15\./);
   expect(checkExactFeatureCost(holed,'fillet',top,{maxFeatureEdges:44,maxShellFaces:16})).toMatchObject({edges:14,weightedEdges:44});
   // Straight edges are cheap: a box's 12 edges are far below any limit.
   expect(checkExactFeatureCost(box,'fillet','all',{maxFeatureEdges:12,maxShellFaces:6})).toMatchObject({weightedEdges:12});
   // Not an smlibwasm part: not pre-flighted.
   expect(exactFeatureCost({} as never,'fillet','all')).toBeUndefined();
  });
 },120_000);
 it('refuses before the kernel runs, names the feature, and leaves normal work alone',()=>{
  const heavy=plate(12,{operation:'fillet',size:.5,edges:top});
  const tight={maxFeatureEdges:40,maxShellFaces:10};
  let error:unknown;
  try{runExactRequest(exact,{operation:'feature-display',document:heavy.document,bodies:[heavy.id]},0,{limits:tight});}catch(e){error=e;}
  expect(error).toMatchObject({code:'unsupported',diagnostic:{nodeId:heavy.id,feature:'exact-feature'}});
  expect((error as Error).message).toMatch(/Rounding 16 edges \(12 of them curved\) at once is too much/);
  // STEP export and measures rebuild the feature, so they are refused the same way.
  expect(()=>runExactRequest(exact,{operation:'export-step',document:heavy.document,bodies:[]},0,{limits:tight})).toThrow(/Rounding 16 edges/);
  // A smaller plate passes the same tight limits and builds; no limits accept anything (MCP, CLI).
  const light=plate(4,{operation:'fillet',size:.5,edges:top});
  const result=runExactRequest(exact,{operation:'feature-display',document:light.document,bodies:[light.id]},0,{limits:{...tight,maxFeatureEdges:20}});
  expect(result.operation==='feature-display'&&result.features[0].volume).toBeGreaterThan(0);
  expect(()=>runExactRequest(exact,{operation:'measure',document:light.document,bodies:[]},0,{limits:EXACT_LIMITS_NONE})).not.toThrow();
  // The tablet limits accept the 12-hole plate (12 × 4 + 4 = 52 weighted edges).
  expect(EXACT_LIMITS_TABLET.maxFeatureEdges).toBeGreaterThan(52);
  // Shell counts faces.
  const shell=plate(12,{operation:'shell',size:.5,openFaces:[top]});
  expect(()=>runExactRequest(exact,{operation:'feature-display',document:shell.document,bodies:[shell.id]},0,{limits:{maxFeatureEdges:1000,maxShellFaces:17}})).toThrow(/Shelling a body with 18 faces/);
  // Everyday parts are far below the tablet limits: a box, filleted on every edge.
  const session=createCadSession(undefined,{kernels:[exactKernelIdentity]});
  const box=session.add({kind:'box',size:[20,30,10]},{transform:identityTransform()});
  const [id]=session.addExactFeatures([{source:box,settings:{operation:'fillet',size:2,edges:'all'}}]);
  expect(()=>runExactRequest(exact,{operation:'feature-display',document:session.state.document,bodies:[id]},0,{limits:EXACT_LIMITS_TABLET})).not.toThrow();
 },600_000);
});

describe('the kernel\'s own shell guard',()=>{
 it('turns smlibwasm\'s 20 s wall-clock stop into a translated message naming the feature',()=>{
  // Measured under heavy load: a shell whose offset step took more than 20 s wall failed with this
  // message (the kernel stayed usable). A stub kernel reproduces it without the wait.
  const session=createCadSession(undefined,{kernels:[exactKernelIdentity]});
  const box=session.add({kind:'box',size:[20,30,10]},{name:'Block'});
  const [id]=session.addExactFeatures([{source:box,settings:{operation:'shell',size:1,openFaces:[top]}}]);
  const stub=new Proxy({},{get:(_,key)=>key==='shell'?()=>{throw new ExactKernelError('kernel-failure','SMLib shell failed: shell: the kernel did not finish within 20 s; setGuardSeconds(seconds) sets the limit');}:()=>({})});
  let error:unknown;
  try{lowerDocumentNode(stub as never,session.state.document,id,{local:true});}catch(e){error=e;}
  expect(error).toMatchObject({code:'kernel-failure',diagnostic:{nodeId:id,feature:'exact-feature'}});
  expect((error as Error).message).toBe(`${session.state.document.nodes[id].name} (exact-feature): The exact kernel stopped this step at its own 20 s limit, so it was not built. The model was not changed. Try a simpler body.`);
 });
});

class MockWorker {
 onmessage:((event:{data:unknown})=>void)|null=null;
 onerror:((event:{message:string})=>void)|null=null;
 messages:any[]=[];terminated=false;
 postMessage(data:unknown){this.messages.push(data);}
 terminate(){this.terminated=true;}
 answer(index:number,data:Record<string,unknown>){this.onmessage!({data:{request:this.messages[index].request,...data}});}
}
const measure=(memoryBytes:number)=>({operation:'measure',kernel:exactKernelIdentity,bodies:[],timing:{loadMs:0,runMs:1,memoryBytes}});
const request=()=>({operation:'measure' as const,document:createDocument(),bodies:[]});
function client(exactLimits?:Parameters<typeof resolveExactLimits>[0]){
 const workers:MockWorker[]=[];
 const c=createGeometryClient('wasm',()=>{const w=new MockWorker();workers.push(w);return w as unknown as Worker;},{exactLimits});
 return {client:c,workers};
}
afterEach(()=>vi.useRealTimers());

describe('editor exact channel guards',()=>{
 it('sends the resolved limits with every exact request',()=>{
  const {client:c,workers}=client({maxFeatureEdges:300});
  void c.exact.run(request()).catch(()=>{});
  expect(workers[0].messages[0].exactLimits).toEqual({...EXACT_LIMITS_TABLET,maxFeatureEdges:300});
  expect(c.exactLimits.maxFeatureEdges).toBe(300);
  c.dispose();
 });
 it('recycles the worker after a job that grew the kernel\'s memory, and starts a new one lazily',async()=>{
  const {client:c,workers}=client();
  // Simulated growth below the threshold keeps the worker (and its loaded kernel).
  const small=c.exact.run(request());workers[0].answer(0,{result:measure(64*MiB)});await small;
  expect(workers[0].terminated).toBe(false);
  // A job that left 600 MiB: the result is delivered, then the worker ends.
  const big=c.exact.run(request());workers[0].answer(1,{result:measure(600*MiB)});
  expect((await big).timing?.memoryBytes).toBe(600*MiB);
  expect(workers[0].terminated).toBe(true);expect(workers).toHaveLength(1);
  // The next request starts a new worker.
  const next=c.exact.run(request());expect(workers).toHaveLength(2);
  workers[1].answer(0,{result:measure(64*MiB)});await next;expect(workers[1].terminated).toBe(false);
  c.dispose();
 });
 it('waits for queued requests before recycling',async()=>{
  const {client:c,workers}=client({recycleAboveBytes:100*MiB});
  const a=c.exact.run(request()),b=c.exact.run(request());
  workers[0].answer(0,{result:measure(300*MiB)});await a;
  expect(workers[0].terminated).toBe(false);
  workers[0].answer(1,{result:measure(300*MiB)});await b;
  expect(workers[0].terminated).toBe(true);
  c.dispose();
 });
 it('ends a worker whose kernel broke (memory exhaustion, trap) and reruns what was queued in a new one',async()=>{
  const {client:c,workers}=client();
  const a=c.exact.run(request()),b=c.exact.run(request());
  const failed=expect(a).rejects.toThrow('The exact kernel ran out of memory');
  workers[0].answer(0,{error:'The exact kernel ran out of memory for this job, so it was stopped.',fatal:true,exactDiagnostic:{code:'kernel-failure',bodyId:'p',nodeId:'f',feature:'exact-feature',message:'The exact kernel ran out of memory for this job, so it was stopped.'}});
  await failed;await expect(a).rejects.toMatchObject({name:'ExactCommandError',diagnostic:{nodeId:'f'}});
  expect(workers[0].terminated).toBe(true);
  // The queued request moved to a fresh worker (a fresh kernel) and completes there.
  expect(workers).toHaveLength(2);expect(workers[1].messages[0].exact.operation).toBe('measure');
  workers[1].answer(0,{result:measure(64*MiB)});
  expect((await b).operation).toBe('measure');
  // An ordinary kernel refusal keeps the worker.
  const refused=c.exact.run(request());
  const rejection=expect(refused).rejects.toThrow('radius may be too large');
  workers[1].answer(1,{error:'SMLib fillet failed: the radius may be too large'});await rejection;
  expect(workers[1].terminated).toBe(false);
  c.dispose();
 });
 it('stops a request after the host\'s budget, terminates the hung worker and recovers',async()=>{
  vi.useFakeTimers();
  const {client:c,workers}=client({requestTimeoutMs:5000});
  const slow=c.exact.run(request());
  const failure=expect(slow).rejects.toThrow('The exact kernel did not finish within 5 seconds, so it was stopped. The model was not changed.');
  await vi.advanceTimersByTimeAsync(4999);expect(workers[0].terminated).toBe(false);
  await vi.advanceTimersByTimeAsync(1);await failure;expect(workers[0].terminated).toBe(true);
  const next=c.exact.run(request());workers[1].answer(0,{result:measure(64*MiB)});await next;
  // No budget at all (EXACT_LIMITS_NONE): no timer fires.
  const unlimited=client({requestTimeoutMs:Infinity});
  let settled=false;void unlimited.client.exact.run(request()).finally(()=>{settled=true;}).catch(()=>{});
  await vi.advanceTimersByTimeAsync(10*60000);expect(settled).toBe(false);
  c.dispose();unlimited.client.dispose();
 });
 it('reports busy state and cancels by terminating the worker',async()=>{
  const {client:c,workers}=client(),seen:ExactActivity[]=[];
  const unsubscribe=c.onExactActivity(activity=>seen.push(activity));
  expect(c.exactActivity.busy).toBe(false);
  const running=c.exact.run({operation:'export-step',document:createDocument(),bodies:[]});
  expect(c.exactActivity).toMatchObject({busy:true,operation:'export-step'});
  const cancelled=expect(running).rejects.toThrow('Request cancelled');
  c.cancelExact();await cancelled;
  expect(workers[0].terminated).toBe(true);
  expect(seen.map(a=>a.busy)).toEqual([true,false]);
  // Manifold requests never show as exact activity.
  void c.evaluate(createDocument()).catch(()=>{});
  expect(c.exactActivity.busy).toBe(false);
  unsubscribe();c.dispose();
 });
});
