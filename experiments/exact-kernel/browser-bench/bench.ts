// SPDX-License-Identifier: BSD-3-Clause
// Main-thread cost of exact requests: the same requests run in a module worker (the product) or
// on the page's thread (the in-thread fallback, i.e. the state before the worker move), while a
// 0 ms timer loop on the main thread records how long it could not run. Driven by
// tests/browser/exact-kernel-bench.spec.ts; see experiments/exact-kernel/README.md.
import type {ExactCommandRequest,ExactCommandResult} from '@brickwright/cad-core';

interface Blocking {maxGapMs:number;blockedMs:number;longTasks?:{count:number;totalMs:number}}
interface Step {label:string;wallMs:number;loadMs?:number;runMs?:number;wasmMiB?:number;triangles?:number;error?:string;main:Blocking}
declare global {interface Window {exactBench:(mode:'worker'|'main',requests:{label:string;request:ExactCommandRequest}[])=>Promise<unknown>}}

/** Watch the main thread: a 0 ms timer chain, and long tasks where the browser reports them. */
function watch(){
 let last=performance.now(),maxGap=0,blocked=0,running=true;
 const tick=()=>{const now=performance.now(),gap=now-last;last=now;if(gap>maxGap)maxGap=gap;if(gap>50)blocked+=gap-50;if(running)setTimeout(tick,0);};
 setTimeout(tick,0);
 const tasks:PerformanceEntry[]=[];let observer:PerformanceObserver|undefined;
 if(PerformanceObserver.supportedEntryTypes?.includes('longtask')){observer=new PerformanceObserver(list=>tasks.push(...list.getEntries()));observer.observe({type:'longtask'});}
 return ():Blocking=>{
  running=false;const now=performance.now(),gap=now-last;if(gap>maxGap)maxGap=gap;if(gap>50)blocked+=gap-50;
  if(observer){for(const entry of observer.takeRecords())tasks.push(entry);observer.disconnect();}
  return {maxGapMs:Math.round(maxGap),blockedMs:Math.round(blocked),...(observer?{longTasks:{count:tasks.length,totalMs:Math.round(tasks.reduce((sum,task)=>sum+task.duration,0))}}:{})};
 };
}
const idle=()=>new Promise(resolve=>setTimeout(resolve,100));

async function memory(){
 const out:Record<string,number|string>={};
 const heap=(performance as unknown as {memory?:{usedJSHeapSize:number}}).memory;
 if(heap)out.jsHeapMiB=Math.round(heap.usedJSHeapSize/1048576);
 const measure=(performance as unknown as {measureUserAgentSpecificMemory?:()=>Promise<{bytes:number}>}).measureUserAgentSpecificMemory;
 if(typeof measure!=='function')out.userAgentMemory='unavailable in this browser';
 else if(!crossOriginIsolated)out.userAgentMemory='needs cross-origin isolation';
 else{
  const result=await Promise.race([measure.call(performance),new Promise<undefined>(resolve=>setTimeout(()=>resolve(undefined),60_000))]);
  if(result)out.userAgentMemoryMiB=Math.round(result.bytes/1048576);else out.userAgentMemory='timed out';
 }
 return out;
}

window.exactBench=async(mode,requests)=>{
 let run:(request:ExactCommandRequest)=>Promise<ExactCommandResult>;
 let worker:Worker|undefined;
 if(mode==='worker'){
  worker=new Worker(new URL('./bench.worker.ts',import.meta.url),{type:'module'});
  const pending=new Map<number,{resolve:(r:ExactCommandResult)=>void;reject:(e:Error)=>void}>();let sequence=0;
  worker.onmessage=event=>{const {id,result,error}=event.data;const p=pending.get(id)!;pending.delete(id);if(error)p.reject(new Error(error));else p.resolve(result);};
  run=request=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});worker!.postMessage({id,request});});
 }else{
  // The in-thread fallback: the kernel's module is imported (and its WebAssembly compiled) here.
  run=async request=>(await import('@brickwright/cad-exact')).createInThreadExactHost().run(request);
 }
 const steps:Step[]=[];
 const before=await memory();
 for(const {label,request} of requests){
  await idle();
  const stop=watch(),started=performance.now();
  try{
   const result=await run(request);
   const wallMs=Math.round(performance.now()-started);
   // In-thread, this line still runs inside the blocking task: let it end, so the browser can
   // report it as a long task before the probe stops.
   await new Promise(resolve=>setTimeout(resolve,20));
   const triangles=result.operation==='feature-display'?result.features.reduce((sum,f)=>sum+f.display.indices.length/3,0):undefined;
   steps.push({label,wallMs,loadMs:Math.round(result.timing!.loadMs),runMs:Math.round(result.timing!.runMs),wasmMiB:Math.round(result.timing!.memoryBytes/1048576),...(triangles!==undefined?{triangles}:{}),main:stop()});
  }catch(error){const wallMs=Math.round(performance.now()-started);await new Promise(resolve=>setTimeout(resolve,20));steps.push({label,wallMs,error:error instanceof Error?error.message:String(error),main:stop()});}
 }
 const after=await memory();
 worker?.terminate();
 return {mode,userAgent:navigator.userAgent,crossOriginIsolated,memoryBefore:before,memoryAfter:after,steps};
};
document.getElementById('state')!.textContent='ready';
