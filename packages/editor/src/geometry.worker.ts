// SPDX-License-Identifier: BSD-3-Clause
import {FeatureEvaluationError,setLocale} from '@brickwright/cad-core';
import { checkPrintability, createGeometryKernel } from '@brickwright/cad-geometry';
import type { PrintabilitySettings } from '@brickwright/cad-geometry';
import type { GeometryKernel } from '@brickwright/cad-geometry';
import type { CadDocument } from '@brickwright/cad-core';
let kernel: Promise<GeometryKernel> | null = null;
self.onmessage = async (event: MessageEvent<{ request: number; document: CadDocument; wasmURL: string;locale?:string;printability?:Partial<PrintabilitySettings> }>) => {
  const { request, document, wasmURL, printability } = event.data;
  try {
    kernel ??= createGeometryKernel({ wasmURL });
    const ready=await kernel;setLocale(event.data.locale??'en');
    const result = ready.evaluate(document);
    if (printability) { self.postMessage({ request, report: checkPrintability(result.bodies, printability) }); return; }
    self.postMessage({ request, result }, { transfer: result.bodies.flatMap(b => [b.positions.buffer, b.indices.buffer]) });
  } catch (error) { self.postMessage({ request, error: error instanceof Error ? error.message : String(error), ...(error instanceof FeatureEvaluationError?{diagnostic:error.diagnostic}:{}) }); }
};
