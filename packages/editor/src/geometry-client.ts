// SPDX-License-Identifier: BSD-3-Clause
import {FeatureEvaluationError,getLocale,t} from '@brickwright/cad-core';
import type {FeatureDiagnostic,ExactCommandRequest,ExactCommandResult,ExactCommandHost,ExactDrawingData,ManufacturingReport,ManufacturingSettings} from '@brickwright/cad-core';
import type { CadDocument,PlanarSketch,SketchProfile } from '@brickwright/cad-core';
import type { AssemblyCut,AssemblySection,GeometryResult,PrintabilityReport,PrintabilitySettings } from '@brickwright/cad-geometry';
import {EXACT_LIMITS_TABLET,resolveExactLimits} from '@brickwright/cad-exact/limits';
import type {ExactLimits} from '@brickwright/cad-exact/limits';
/** A timed-out/crashed kernel is discarded; the next edit starts a fresh worker. */
type OffsetRequest={offset:{sketch:PlanarSketch;context:Pick<CadDocument,'parametric'>;distance:number}};
type SliceRequest={slice:{geometry:GeometryResult;cut:AssemblyCut}};
type ExactRequest={exact:{operation:ExactCommandRequest['operation'];document:CadDocument;bodies:string[];step?:ExactCommandRequest['step']}};
/** The manufacturing check: the meshes are evaluated in the worker, the exact data comes with the request. */
export type ManufacturingRequest={settings:ManufacturingSettings;bodies:string[];exact?:ExactDrawingData;exactUnavailable?:string;kernel?:string};
type GeometryPayload={document:CadDocument;printability?:Partial<PrintabilitySettings>;manufacturing?:ManufacturingRequest}|OffsetRequest|SliceRequest|ExactRequest;
export type GeometryRequest=GeometryPayload&{request:number;wasmURL:string;locale:string;exactLimits?:ExactLimits};
type WorkerResult=GeometryResult|SketchProfile|AssemblySection|PrintabilityReport|ManufacturingReport|ExactCommandResult;
/** An exact-kernel failure with the body and feature it names (see @brickwright/cad-exact). */
export class ExactCommandError extends Error {
  constructor(message:string,readonly diagnostic?:{code:string;bodyId:string;nodeId:string;feature:string;message:string}){super(message);this.name='ExactCommandError';}
}
/** First exact request: load + compile 9.4 MB of WebAssembly, then the request itself. The
 * editor's default (EXACT_LIMITS_TABLET.requestTimeoutMs); hosts change it with `exactLimits`. */
export const EXACT_TIMEOUT_MS=EXACT_LIMITS_TABLET.requestTimeoutMs;
/** What the exact worker is doing, for a busy indicator with a Cancel button. */
export interface ExactActivity {readonly busy:boolean;readonly operation?:ExactCommandRequest['operation'];readonly since?:number}
export interface GeometryClientOptions {
  /**
   * Runs exact requests when the exact worker cannot start (no `Worker`, a constructor that throws,
   * or a worker script that fails before answering). It runs the kernel on the calling thread, so
   * a slow fillet blocks the UI for its duration; it is the last resort, not a second path. Hosts
   * pass e.g. `{run:(r,s)=>import('@brickwright/cad-exact').then(m=>m.createInThreadExactHost({limits}).run(r,s))}`.
   * Without it, those requests fail with the worker's error, as before.
   */
  exactFallback?: ExactCommandHost;
  /**
   * How much one exact job may take (see `@brickwright/cad-exact/limits`): pre-flight refusal of
   * fillets/chamfers/shells that touch too many edges or faces, a ceiling for the kernel's memory,
   * recycling the worker after a job that grew it, and the request timeout. Missing fields come
   * from EXACT_LIMITS_TABLET (iPad-safe); desktop hosts may pass EXACT_LIMITS_DESKTOP.
   */
  exactLimits?: Partial<ExactLimits>;
}
export function createGeometryClient(wasmURL: string, createWorker?: () => Worker, options: GeometryClientOptions = {}) {
  let disposed = false,sequence=0;
  const exactLimits=resolveExactLimits(options.exactLimits);
  // Manifold and the exact kernel run in separate instances of the same worker script, so a
  // cancelled or timed-out exact request never discards the Manifold evaluator, and the exact
  // kernel's memory (64 MiB at rest, never shrinking) is released by terminating its worker.
  interface ChannelOptions {
    timeoutMs:number;timeoutMessage:()=>string;fallback?:ExactCommandHost;extra?:Record<string,unknown>;
    /** After a result: whether the worker should be discarded once idle (memory grew too much). */
    recycleAfter?:(result:WorkerResult)=>boolean;
    onActivity?:(pending:readonly GeometryPayload[])=>void;
  }
  function channel({timeoutMs,timeoutMessage,fallback,extra={},recycleAfter,onActivity}:ChannelOptions){
    let worker: Worker | null = null, answered = false, inThread = false, recycle = false;
    type Pending = { resolve: (r: WorkerResult) => void; reject: (e: Error) => void; timer?: ReturnType<typeof setTimeout>; payload: GeometryPayload; signal?: AbortSignal };
    const pending = new Map<number, Pending>();
    const activity=()=>onActivity?.([...pending.values()].map(p=>p.payload));
    const discard=()=>{worker?.terminate(); worker = null; recycle = false;};
    const fail = (error: Error) => {
      discard();
      for (const p of pending.values()) { clearTimeout(p.timer); p.reject(error); } pending.clear();
      activity();
    };
    // The worker could not start: run what is waiting, and every later request, through the
    // fallback. Only for the exact channel, and only before the worker ever answered.
    const useFallback = () => {
      if (!fallback || answered) return false;
      inThread = true; discard();
      const waiting = [...pending.values()]; pending.clear();
      for (const p of waiting) { clearTimeout(p.timer); runFallback(p.payload, p.signal).then(p.resolve, p.reject); }
      activity();
      return true;
    };
    const runFallback = (payload: GeometryPayload, signal?: AbortSignal): Promise<WorkerResult> => {
      if (!('exact' in payload)) return Promise.reject(new Error(t('Geometry worker failed')));
      return fallback!.run(payload.exact, signal);
    };
    const post=(request:number,payload:GeometryPayload)=>ensure().postMessage({ ...payload, ...extra, request, wasmURL,locale:getLocale() });
    const ensure = () => {
      if (worker) return worker;
      if (!createWorker && typeof Worker === 'undefined') throw new Error(t('Geometry worker failed'));
      const created = createWorker ? createWorker() : new Worker(new URL('./geometry.worker.js', import.meta.url), { type: 'module' });
      worker = created;
      created.onmessage = e => {
        if (worker !== created) return;
        answered = true;
        const data = e.data as { request: number; result?: WorkerResult; error?: string; fatal?: boolean; diagnostic?:FeatureDiagnostic; exactDiagnostic?:ExactCommandError['diagnostic'] }; const request = pending.get(data.request);
        if (!request) return; pending.delete(data.request); clearTimeout(request.timer);
        if (data.fatal) {
          // The kernel in this worker is unusable (a trap or memory exhaustion): end the worker,
          // which frees its memory, and run whatever was queued behind this request in a new one.
          discard();
          for (const [id, p] of pending) { try { post(id, p.payload); } catch (error) { p.reject(error instanceof Error ? error : new Error(String(error))); pending.delete(id); } }
        } else if (!data.error && recycleAfter?.(data.result!)) recycle = true;
        if (data.error) request.reject(data.diagnostic?new FeatureEvaluationError(data.diagnostic):data.exactDiagnostic?new ExactCommandError(data.error,data.exactDiagnostic):new Error(data.error)); else request.resolve(data.result!);
        // A job left the kernel's memory high: once nothing else waits on it, end the worker so the
        // memory returns to the page; the next request starts a fresh one (lazily, as the first).
        if (recycle && !pending.size) discard();
        activity();
      };
      created.onerror = event => { if (worker === created && !useFallback()) fail(new Error(event.message || t('Geometry worker failed'))); };
      return created;
    };
    function send<R extends WorkerResult>(payload:GeometryPayload,signal?:AbortSignal):Promise<R>{
      if (disposed) return Promise.reject(new Error(t('Editor was disposed')));
      if(signal?.aborted)return Promise.reject(new Error(t('Request cancelled')));
      if (inThread) return runFallback(payload, signal) as Promise<R>;
      const request = ++sequence;
      return new Promise((resolve, reject) => {
        const abort=()=>fail(new Error(t('Request cancelled')));
        const done=()=>signal?.removeEventListener('abort',abort);
        // A non-finite budget (EXACT_LIMITS_NONE) means no timer: setTimeout would fire at once.
        const timer = Number.isFinite(timeoutMs) ? setTimeout(() => fail(new Error(timeoutMessage())), timeoutMs) : undefined;
        pending.set(request, { resolve:result=>{done();resolve(result as R);}, reject:error=>{done();reject(error);}, timer, payload, signal });
        signal?.addEventListener('abort',abort,{once:true});
        activity();
        try { post(request, payload); } catch (e) { if (!useFallback()) fail(e instanceof Error ? e : new Error(String(e))); }
      });
    }
    return {send,fail};
  }
  const geometry=channel({timeoutMs:30000,timeoutMessage:()=>t('Geometry exceeded 30 seconds. Simplify the edit or Undo.')});
  const activityListeners=new Set<(activity:ExactActivity)=>void>();
  let activityState:ExactActivity={busy:false};
  const exact=channel({
    timeoutMs:exactLimits.requestTimeoutMs,
    timeoutMessage:()=>t`The exact kernel did not finish within ${Math.round(exactLimits.requestTimeoutMs/1000)} seconds, so it was stopped. The model was not changed.`,
    fallback:options.exactFallback,
    extra:{exactLimits},
    recycleAfter:result=>'timing' in result&&!!result.timing&&result.timing.memoryBytes>exactLimits.recycleAboveBytes,
    onActivity:waiting=>{
      const first=waiting[0];
      const next:ExactActivity=first&&'exact' in first?{busy:true,operation:first.exact.operation,since:activityState.busy?activityState.since:Date.now()}:{busy:false};
      if(next.busy===activityState.busy&&next.operation===activityState.operation)return;
      activityState=next;for(const listener of activityListeners)listener(next);
    },
  });
  const exactHost:ExactCommandHost={
    run(request,signal){
      return exact.send<ExactCommandResult>({exact:{operation:request.operation,document:request.document,bodies:[...request.bodies],...(request.step?{step:{name:request.step.name,bytes:request.step.bytes}}:{})}},signal);
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
    /** The manufacturing check, in the worker (meshes stay there); exact data, if any, is passed in. */
    checkManufacturing(document:CadDocument,request:ManufacturingRequest,signal?:AbortSignal){
      return geometry.send<ManufacturingReport>({document,manufacturing:request},signal);
    },
    /** Exact-kernel requests (`export step`, `measure exact`); the kernel loads on first use. */
    exact:exactHost,
    /** Stop a running exact request and release the exact kernel's memory. */
    cancelExact(){exact.fail(new Error(t('Request cancelled')));},
    /** The limits exact jobs run under (resolved from GeometryClientOptions.exactLimits). */
    exactLimits,
    /** Whether an exact request is running or waiting. */
    get exactActivity(){return activityState;},
    /** Called whenever exact requests start or all finish; returns an unsubscribe function. */
    onExactActivity(listener:(activity:ExactActivity)=>void){activityListeners.add(listener);return()=>{activityListeners.delete(listener);};},
    dispose() { disposed = true; geometry.fail(new Error(t('Editor was disposed'))); exact.fail(new Error(t('Editor was disposed'))); activityListeners.clear(); },
  };
}
