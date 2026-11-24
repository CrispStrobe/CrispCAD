// SPDX-License-Identifier: BSD-3-Clause
import {FeatureEvaluationError,getLocale,t} from '@brickwright/cad-core';
import type {FeatureDiagnostic} from '@brickwright/cad-core';
import type { CadDocument } from '@brickwright/cad-core';
import type { GeometryResult, PrintabilityReport, PrintabilitySettings } from '@brickwright/cad-geometry';
/** A timed-out/crashed kernel is discarded; the next edit starts a fresh worker. */
export function createGeometryClient(wasmURL: string, createWorker?: () => Worker) {
  let worker: Worker | null = null; let sequence = 0; let disposed = false;
  const pending = new Map<number, { resolve: (r: GeometryResult & PrintabilityReport) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const fail = (error: Error) => {
    worker?.terminate(); worker = null;
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(error); } pending.clear();
  };
  const ensure = () => {
    if (worker) return worker;
    worker = createWorker ? createWorker() : new Worker(new URL('./geometry.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = e => {
      const data = e.data as { request: number; result?: GeometryResult; report?: PrintabilityReport; error?: string; diagnostic?:FeatureDiagnostic }; const request = pending.get(data.request);
      if (!request) return; pending.delete(data.request); clearTimeout(request.timer);
      if (data.error) request.reject(data.diagnostic?new FeatureEvaluationError(data.diagnostic):new Error(data.error)); else request.resolve((data.report ?? data.result) as GeometryResult & PrintabilityReport);
    };
    worker.onerror = event => fail(new Error(event.message || t('Geometry worker failed')));
    return worker;
  };
  const send = (document: CadDocument, printability?: Partial<PrintabilitySettings>): Promise<GeometryResult & PrintabilityReport> => {
    if (disposed) return Promise.reject(new Error(t('Editor was disposed')));
    const request = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => fail(new Error(t('Geometry exceeded 30 seconds. Simplify the edit or Undo.'))), 30000);
      pending.set(request, { resolve, reject, timer });
      try { ensure().postMessage({ request, document, wasmURL, locale: getLocale(), ...(printability ? { printability } : {}) }); } catch (e) { fail(e instanceof Error ? e : new Error(String(e))); }
    });
  };
  return {
    evaluate(document: CadDocument): Promise<GeometryResult> { return send(document); },
    /** Evaluate in the worker and screen the bodies there; meshes stay off the UI thread. */
    checkPrintability(document: CadDocument, settings: Partial<PrintabilitySettings> = {}): Promise<PrintabilityReport> { return send(document, settings); },
    dispose() { disposed = true; fail(new Error(t('Editor was disposed'))); },
  };
}
