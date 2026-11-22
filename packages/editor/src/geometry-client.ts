// SPDX-License-Identifier: BSD-3-Clause
import {FeatureEvaluationError,getLocale,t} from '@brickwright/cad-core';
import type {FeatureDiagnostic} from '@brickwright/cad-core';
import type { CadDocument,PlanarSketch,SketchProfile } from '@brickwright/cad-core';
import type { AssemblyCut,AssemblySection,GeometryResult } from '@brickwright/cad-geometry';
/** A timed-out/crashed kernel is discarded; the next edit starts a fresh worker. */
type OffsetRequest={offset:{sketch:PlanarSketch;context:Pick<CadDocument,'parametric'>;distance:number}};
type SliceRequest={slice:{geometry:GeometryResult;cut:AssemblyCut}};
type GeometryPayload={document:CadDocument}|OffsetRequest|SliceRequest;
export type GeometryRequest=GeometryPayload&{request:number;wasmURL:string;locale:string};
type WorkerResult=GeometryResult|SketchProfile|AssemblySection;
export function createGeometryClient(wasmURL: string, createWorker?: () => Worker) {
  let worker: Worker | null = null; let sequence = 0; let disposed = false;
  const pending = new Map<number, { resolve: (r: WorkerResult) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const fail = (error: Error) => {
    worker?.terminate(); worker = null;
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(error); } pending.clear();
  };
  const ensure = () => {
    if (worker) return worker;
    worker = createWorker ? createWorker() : new Worker(new URL('./geometry.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = e => {
      const data = e.data as { request: number; result?: WorkerResult; error?: string; diagnostic?:FeatureDiagnostic }; const request = pending.get(data.request);
      if (!request) return; pending.delete(data.request); clearTimeout(request.timer);
      if (data.error) request.reject(data.diagnostic?new FeatureEvaluationError(data.diagnostic):new Error(data.error)); else request.resolve(data.result!);
    };
    worker.onerror = event => fail(new Error(event.message || t('Geometry worker failed')));
    return worker;
  };
  function send<R extends WorkerResult>(payload:GeometryPayload):Promise<R>{
    if (disposed) return Promise.reject(new Error(t('Editor was disposed')));
    const request = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => fail(new Error(t('Geometry exceeded 30 seconds. Simplify the edit or Undo.'))), 30000);
      pending.set(request, { resolve:result=>resolve(result as R), reject, timer });
      try { ensure().postMessage({ ...payload, request, wasmURL,locale:getLocale() }); } catch (e) { fail(e instanceof Error ? e : new Error(String(e))); }
    });
  }
  return {
    evaluate(document:CadDocument){return send<GeometryResult>({document});},
    sliceAssembly(geometry:GeometryResult,cut:AssemblyCut){return send<AssemblySection>({slice:{geometry,cut}});},
    offsetSketch(sketch:PlanarSketch,context:Pick<CadDocument,'parametric'>,distance:number){
      return send<SketchProfile>({offset:{sketch,context,distance}});
    },
    dispose() { disposed = true; fail(new Error(t('Editor was disposed'))); },
  };
}
