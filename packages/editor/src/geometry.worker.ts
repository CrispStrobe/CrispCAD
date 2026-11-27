// SPDX-License-Identifier: BSD-3-Clause
import {FeatureEvaluationError,setLocale,t} from '@brickwright/cad-core';
import type {ExactCommandResult} from '@brickwright/cad-core';
import { createGeometryKernel } from '@brickwright/cad-geometry';
import type { GeometryKernel } from '@brickwright/cad-geometry';
import type {GeometryRequest} from './geometry-client.js';
let kernel: Promise<GeometryKernel> | null = null;
// The exact kernel is a separate, lazily imported chunk with its own 9.4 MB WebAssembly. Only a
// worker that receives an exact request loads it; Manifold-only sessions never fetch it.
/** The message for a kernel failure the kernel cannot recover from (see isFatalExactError). */
const exactFailure=(error:unknown)=>{
  const detail=error instanceof Error?error.message:String(error);
  return /out of memory|bad_alloc|SM_ERR_OUT_OF_MEMORY|Cannot enlarge memory/i.test(detail)
    ?t('The exact kernel ran out of memory for this job, so it was stopped. The model was not changed. Simplify the feature (fewer edges or holes) or run it on a computer.')
    :t`The exact kernel failed and was restarted. The model was not changed. (${detail.split('\n')[0].slice(0,200)})`;
};
let exact:Promise<{module:typeof import('@brickwright/cad-exact');backend:import('@brickwright/cad-exact').ExactBackend}>|null=null;
self.onmessage = async (event: MessageEvent<GeometryRequest>) => {
  const {request,wasmURL}=event.data;
  try {
    setLocale(event.data.locale??'en');
    if('exact' in event.data){
      const started=performance.now();
      // The kernel's memory ceiling (maxMemoryBytes) and its guard for shell-like steps
      // (guardSeconds, derived from the request budget) apply when it loads, once per worker (the
      // first exact request); the client starts a new worker when its limits change. The request
      // budget, ending this worker, stays the real stop for a job the guard does not reach.
      const limits=event.data.exactLimits;
      exact??=import('@brickwright/cad-exact').then(async module=>({module,backend:await module.createExactBackend(limits?module.exactKernelOptions(limits):{})})).catch(error=>{exact=null;throw error;});
      const {module,backend}=await exact;
      try{
        const result:ExactCommandResult=module.runExactRequest(backend,event.data.exact,performance.now()-started,{limits});
        self.postMessage({request,result});
      }catch(error){
        // A trap or memory exhaustion leaves the kernel unusable: say so, and the client ends this
        // worker (freeing its memory) and runs the next request in a new one.
        if(!module.isFatalExactError(error))throw error;
        const diagnostic=error&&typeof error==='object'&&'diagnostic' in error?(error as {diagnostic:{message:string}}).diagnostic:undefined;
        const message=exactFailure(error);
        self.postMessage({request,error:message,fatal:true,...(diagnostic?{exactDiagnostic:{...diagnostic,message}}:{})});
      }
      return;
    }
    kernel ??= createGeometryKernel({ wasmURL });
    const ready=await kernel;
    if('offset' in event.data){
      const {sketch,context,distance}=event.data.offset;
      self.postMessage({request,result:ready.offsetSketch(sketch,context,distance)});
      return;
    }
    if('slice' in event.data){
      const {geometry,cut}=event.data.slice;
      self.postMessage({request,result:ready.sliceAssembly(geometry,cut)});
      return;
    }
    const result=ready.evaluate(event.data.document);
    if(event.data.manufacturing){
      const {checkManufacturing}=await import('@brickwright/cad-geometry/manufacturing');
      const {settings,bodies,exact,exactUnavailable,kernel}=event.data.manufacturing;
      self.postMessage({request,result:checkManufacturing({meshes:result.bodies,bodies,...(exact?{exact}:{}),...(exactUnavailable?{exactUnavailable}:{}),...(kernel?{kernel}:{})},settings)});
      return;
    }
    if(event.data.printability){
      const {checkPrintability}=await import('@brickwright/cad-geometry/printability');
      self.postMessage({request,result:checkPrintability(result.bodies,event.data.printability)});
      return;
    }
    self.postMessage({ request, result }, { transfer: result.bodies.flatMap(b => [b.positions.buffer, b.indices.buffer]) });
  } catch (error) {
    const diagnostic=error instanceof FeatureEvaluationError?error.diagnostic:error&&typeof error==='object'&&'diagnostic' in error?(error as {diagnostic:unknown}).diagnostic:undefined;
    self.postMessage({ request, error: error instanceof Error ? error.message : String(error), ...(error instanceof FeatureEvaluationError?{diagnostic}:diagnostic?{exactDiagnostic:diagnostic}:{}) });
  }
};
