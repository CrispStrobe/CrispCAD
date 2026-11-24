// SPDX-License-Identifier: BSD-3-Clause
import {FeatureEvaluationError,setLocale} from '@brickwright/cad-core';
import { createGeometryKernel } from '@brickwright/cad-geometry';
import type { GeometryKernel } from '@brickwright/cad-geometry';
import type {GeometryRequest} from './geometry-client.js';
let kernel: Promise<GeometryKernel> | null = null;
self.onmessage = async (event: MessageEvent<GeometryRequest>) => {
  const {request,wasmURL}=event.data;
  try {
    kernel ??= createGeometryKernel({ wasmURL });
    const ready=await kernel;setLocale(event.data.locale??'en');
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
  } catch (error) { self.postMessage({ request, error: error instanceof Error ? error.message : String(error), ...(error instanceof FeatureEvaluationError?{diagnostic:error.diagnostic}:{}) }); }
};
