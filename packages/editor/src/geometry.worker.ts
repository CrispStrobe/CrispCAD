// SPDX-License-Identifier: BSD-3-Clause
import {FeatureEvaluationError,setLocale} from '@brickwright/cad-core';
import type {ExactCommandResult} from '@brickwright/cad-core';
import { createGeometryKernel } from '@brickwright/cad-geometry';
import type { GeometryKernel } from '@brickwright/cad-geometry';
import type {GeometryRequest} from './geometry-client.js';
let kernel: Promise<GeometryKernel> | null = null;
// The exact kernel is a separate, lazily imported chunk with its own 9.4 MB WebAssembly. Only a
// worker that receives an exact request loads it; Manifold-only sessions never fetch it.
let exact:Promise<import('@brickwright/cad-exact').ExactBackend>|null=null;
self.onmessage = async (event: MessageEvent<GeometryRequest>) => {
  const {request,wasmURL}=event.data;
  try {
    setLocale(event.data.locale??'en');
    if('exact' in event.data){
      const {operation,document,bodies}=event.data.exact,started=performance.now();
      exact??=import('@brickwright/cad-exact').then(module=>module.createExactBackend()).catch(error=>{exact=null;throw error;});
      const backend=await exact,loaded=performance.now();
      const result:ExactCommandResult=operation==='measure'?{operation,...backend.measure(document,bodies)}:{operation,...backend.exportStep(document,bodies)};
      self.postMessage({request,result,timing:{loadMs:loaded-started,runMs:performance.now()-loaded,memory:backend.kernel.memory()}});
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
