// SPDX-License-Identifier: BSD-3-Clause
import {FeatureEvaluationError,setLocale} from '@brickwright/cad-core';
import { createGeometryKernel } from '@brickwright/cad-geometry';
import type { GeometryKernel } from '@brickwright/cad-geometry';
import type { CadDocument } from '@brickwright/cad-core';
let kernel: Promise<GeometryKernel> | null = null;
self.onmessage = async (event: MessageEvent<{ request: number; document: CadDocument; wasmURL: string;locale?:string }>) => {
  const { request, document, wasmURL } = event.data;
  try {
    kernel ??= createGeometryKernel({ wasmURL });
    const ready=await kernel;setLocale(event.data.locale??'en');
    const result = ready.evaluate(document);
    self.postMessage({ request, result }, { transfer: result.bodies.flatMap(b => [b.positions.buffer, b.indices.buffer]) });
  } catch (error) { self.postMessage({ request, error: error instanceof Error ? error.message : String(error), ...(error instanceof FeatureEvaluationError?{diagnostic:error.diagnostic}:{}) }); }
};
