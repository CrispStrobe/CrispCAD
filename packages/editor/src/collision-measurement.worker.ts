// SPDX-License-Identifier: BSD-3-Clause
import {setLocale} from '@brickwright/cad-core';
import {createGeometryKernel} from '@brickwright/cad-geometry';
import type {CollisionMeasurementReply,CollisionMeasurementRequest} from './collision-measurement-client.js';

let kernel:ReturnType<typeof createGeometryKernel>|undefined;
self.onmessage=async({data}:MessageEvent<CollisionMeasurementRequest>)=>{
 let reply:CollisionMeasurementReply;
 try{
  const ready=await(kernel??=createGeometryKernel({wasmURL:data.wasmURL}));
  setLocale(data.locale);
  self.postMessage({started:true} satisfies CollisionMeasurementReply);
  try{reply={measurement:ready.collisionCSG.measure(data.source,data.hulls)};}
  catch(error){reply={error:error instanceof Error?error.message:String(error)};}
 }catch{reply={unavailable:true};}
 self.postMessage(reply);
};
