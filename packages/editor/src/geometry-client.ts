// SPDX-License-Identifier: BSD-3-Clause
import type { CadDocument } from '@brickwright/cad-core';
import type { GeometryResult } from '@brickwright/cad-geometry';
/** A timed-out/crashed kernel is discarded; the next edit starts a fresh worker. */
export function createGeometryClient(wasmURL: string, createWorker?: () => Worker) {
  let worker: Worker | null = null; let sequence = 0; let disposed = false;
  const pending = new Map<number, { resolve: (r: GeometryResult) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const fail = (error: Error) => {
    worker?.terminate(); worker = null;
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(error); } pending.clear();
  };
  const ensure = () => {
    if (worker) return worker;
    worker = createWorker ? createWorker() : new Worker(new URL('./geometry.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = e => {
      const data = e.data as { request: number; result?: GeometryResult; error?: string }; const request = pending.get(data.request);
      if (!request) return; pending.delete(data.request); clearTimeout(request.timer);
      if (data.error) request.reject(new Error(data.error)); else request.resolve(data.result!);
    };
    worker.onerror = event => fail(new Error(event.message || 'Geometry worker failed'));
    return worker;
  };
  return {
    evaluate(document: CadDocument): Promise<GeometryResult> {
      if (disposed) return Promise.reject(new Error('Editor was disposed'));
      const request = ++sequence;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => fail(new Error('Geometry exceeded 30 seconds. Simplify the edit or Undo.')), 30000);
        pending.set(request, { resolve, reject, timer });
        try { ensure().postMessage({ request, document, wasmURL }); } catch (e) { fail(e instanceof Error ? e : new Error(String(e))); }
      });
    },
    dispose() { disposed = true; fail(new Error('Editor was disposed')); },
  };
}
