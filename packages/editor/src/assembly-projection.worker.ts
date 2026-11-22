// SPDX-License-Identifier: BSD-3-Clause
import {setLocale} from '@brickwright/cad-core';
import type {getLocale} from '@brickwright/cad-core';
import type {GeometryResult} from '@brickwright/cad-geometry';
import {projectAssembly} from './assembly-drawing.js';
import type {AssemblyProjection} from './assembly-drawing.js';

export type AssemblyProjectionRequest={geometry:GeometryResult;locale:ReturnType<typeof getLocale>};
export type AssemblyProjectionResponse={projection:AssemblyProjection}|{error:string};

self.onmessage=(event:MessageEvent<AssemblyProjectionRequest>)=>{
 try{
  setLocale(event.data.locale);
  const projection=projectAssembly(event.data.geometry);
  self.postMessage({projection} satisfies AssemblyProjectionResponse,
   {transfer:projection.views.map(view=>view.segments.buffer)});
 }catch(error){
  self.postMessage({error:error instanceof Error?error.message:String(error)} satisfies AssemblyProjectionResponse);
 }
};
