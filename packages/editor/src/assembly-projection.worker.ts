// SPDX-License-Identifier: BSD-3-Clause
import {setLocale} from '@brickwright/cad-core';
import type {ExactDrawingData,getLocale} from '@brickwright/cad-core';
import type {GeometryResult} from '@brickwright/cad-geometry';
import {projectAssembly} from './assembly-drawing.js';
import type {AssemblyProjection} from './assembly-drawing.js';
import {projectExactAssembly} from './exact-drawing-projection.js';

/** With `exact`, lines come from the exact B-rep where it has the body (exact-drawing-projection.ts). */
export type AssemblyProjectionRequest={geometry:GeometryResult;locale:ReturnType<typeof getLocale>;exact?:ExactDrawingData};
export type AssemblyProjectionResponse={projection:AssemblyProjection}|{error:string};

self.onmessage=(event:MessageEvent<AssemblyProjectionRequest>)=>{
 try{
  setLocale(event.data.locale);
  const {geometry,exact}=event.data;
  const projection=exact?projectExactAssembly(geometry,exact):projectAssembly(geometry);
  self.postMessage({projection} satisfies AssemblyProjectionResponse,
   {transfer:projection.views.flatMap(view=>[view.segments.buffer,view.edgePicks.buffer])});
 }catch(error){
  self.postMessage({error:error instanceof Error?error.message:String(error)} satisfies AssemblyProjectionResponse);
 }
};
