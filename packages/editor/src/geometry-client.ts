// SPDX-License-Identifier: BSD-3-Clause
import {FeatureEvaluationError,getLocale,t} from '@brickwright/cad-core';
import type {FeatureDiagnostic,ExactCommandRequest,ExactCommandResult,ExactCommandHost} from '@brickwright/cad-core';
import type { CadDocument,PlanarSketch,SketchProfile } from '@brickwright/cad-core';
import type { AssemblyCut,AssemblySection,GeometryResult,PrintabilityReport,PrintabilitySettings } from '@brickwright/cad-geometry';
/** A timed-out/crashed kernel is discarded; the next edit starts a fresh worker. */
type OffsetRequest={offset:{sketch:PlanarSketch;context:Pick<CadDocument,'parametric'>;distance:number}};
type SliceRequest={slice:{geometry:GeometryResult;cut:AssemblyCut}};
type ExactRequest={exact:{operation:ExactCommandRequest['operation'];document:CadDocument;bodies:string[]}};
type GeometryPayload={document:CadDocument;printability?:Partial<PrintabilitySettings>}|OffsetRequest|SliceRequest|ExactRequest;
export type GeometryRequest=GeometryPayload&{request:number;wasmURL:string;locale:string};
type WorkerResult=GeometryResult|SketchProfile|AssemblySection|PrintabilityReport|ExactCommandResult;
/** An exact-kernel failure with the body and feature it names (see @brickwright/cad-exact). */
export class ExactCommandError extends Error {
  constructor(message:string,readonly diagnostic?:{code:string;bodyId:string;nodeId:string;feature:string;message:string}){super(message);this.name='ExactCommandError';}
}
/** First exact request: load + compile 9.4 MB of WebAssembly, then the request itself. */
export const EXACT_TIMEOUT_MS=60000;
export interface GeometryClientOptions {
  /**
   * Runs exact requests when the exact worker cannot start (no `Worker`, a constructor that throws,
   * or a worker script that fails before answering). It runs the kernel on the calling thread, so
   * a slow fillet blocks the UI for its duration; it is the last resort, not a second path. Hosts
   * pass e.g. `{run:(r,s)=>import('@brickwright/cad-exact').then(m=>m.createInThreadExactHost().run(r,s))}`.
   * Without it, those requests fail with the worker's error, as before.
   */
  exactFallback?: ExactCommandHost;
}
export function createGeometryClient(wasmURL: string, createWorker?: () => Worker, options: GeometryClientOptions = {}) {
  let disposed = false,sequence=0;
  // Manifold and the exact kernel run in separate instances of the same worker script, so a
  // cancelled or timed-out exact request never discards the Manifold evaluator, and the exact
  // kernel's memory (64–92 MiB, never shrinking) is released by terminating its worker.
  function channel(timeoutMs:number,timeoutMessage:()=>string,fallback?:ExactCommandHost){
    let worker: Worker | null = null, answered = false, inThread = false;
    type Pending = { resolve: (r: WorkerResult) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout>; payload: GeometryPayload; signal?: AbortSignal };
    const pending = new Map<number, Pending>();
    const fail = (error: Error) => {
      worker?.terminate(); worker = null;
      for (const p of pending.values()) { clearTimeout(p.timer); p.reject(error); } pending.clear();
    };
    // The worker could not start: run what is waiting, and every later request, through the
    // fallback. Only for the exact channel, and only before the worker ever answered.
    const useFallback = () => {
      if (!fallback || answered) return false;
      inThread = true; worker?.terminate(); worker = null;
      const waiting = [...pending.values()]; pending.clear();
      for (const p of waiting) { clearTimeout(p.timer); runFallback(p.payload, p.signal).then(p.resolve, p.reject); }
      return true;
    };
    const runFallback = (payload: GeometryPayload, signal?: AbortSignal): Promise<WorkerResult> => {
      if (!('exact' in payload)) return Promise.reject(new Error(t('Geometry worker failed')));
      return fallback!.run(payload.exact, signal);
    };
    const ensure = () => {
      if (worker) return worker;
      if (!createWorker && typeof Worker === 'undefined') throw new Error(t('Geometry worker failed'));
      worker = createWorker ? createWorker() : new Worker(new URL('./geometry.worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = e => {
        answered = true;
        const data = e.data as { request: number; result?: WorkerResult; error?: string; diagnostic?:FeatureDiagnostic; exactDiagnostic?:ExactCommandError['diagnostic'] }; const request = pending.get(data.request);
        if (!request) return; pending.delete(data.request); clearTimeout(request.timer);
        if (data.error) request.reject(data.diagnostic?new FeatureEvaluationError(data.diagnostic):data.exactDiagnostic?new ExactCommandError(data.error,data.exactDiagnostic):new Error(data.error)); else request.resolve(data.result!);
      };
      worker.onerror = event => { if (!useFallback()) fail(new Error(event.message || t('Geometry worker failed'))); };
      return worker;
    };
    function send<R extends WorkerResult>(payload:GeometryPayload,signal?:AbortSignal):Promise<R>{
      if (disposed) return Promise.reject(new Error(t('Editor was disposed')));
      if(signal?.aborted)return Promise.reject(new Error(t('Request cancelled')));
      if (inThread) return runFallback(payload, signal) as Promise<R>;
      const request = ++sequence;
      return new Promise((resolve, reject) => {
        const abort=()=>fail(new Error(t('Request cancelled')));
        const done=()=>signal?.removeEventListener('abort',abort);
        const timer = setTimeout(() => fail(new Error(timeoutMessage())), timeoutMs);
        pending.set(request, { resolve:result=>{done();resolve(result as R);}, reject:error=>{done();reject(error);}, timer, payload, signal });
        signal?.addEventListener('abort',abort,{once:true});
        try { ensure().postMessage({ ...payload, request, wasmURL,locale:getLocale() }); } catch (e) { if (!useFallback()) fail(e instanceof Error ? e : new Error(String(e))); }
      });
    }
    return {send,fail};
  }
  const geometry=channel(30000,()=>t('Geometry exceeded 30 seconds. Simplify the edit or Undo.'));
  const exact=channel(EXACT_TIMEOUT_MS,()=>t('The exact kernel exceeded 60 seconds; the request was stopped.'),options.exactFallback);
  const exactHost:ExactCommandHost={
    run(request,signal){
      return exact.send<ExactCommandResult>({exact:{operation:request.operation,document:request.document,bodies:[...request.bodies]}},signal);
    },
  };
  return {
    evaluate(document:CadDocument){return geometry.send<GeometryResult>({document});},
    sliceAssembly(geometry_:GeometryResult,cut:AssemblyCut){return geometry.send<AssemblySection>({slice:{geometry:geometry_,cut}});},
    offsetSketch(sketch:PlanarSketch,context:Pick<CadDocument,'parametric'>,distance:number){
      return geometry.send<SketchProfile>({offset:{sketch,context,distance}});
    },
    /** Evaluate and screen in the worker without transferring meshes to the UI. */
    checkPrintability(document:CadDocument,settings:Partial<PrintabilitySettings>={}){
      return geometry.send<PrintabilityReport>({document,printability:settings});
    },
    /** Exact-kernel requests (`export step`, `measure exact`); the kernel loads on first use. */
    exact:exactHost,
    /** Stop a running exact request and release the exact kernel's memory. */
    cancelExact(){exact.fail(new Error(t('Request cancelled')));},
    dispose() { disposed = true; geometry.fail(new Error(t('Editor was disposed'))); exact.fail(new Error(t('Editor was disposed'))); },
  };
}
