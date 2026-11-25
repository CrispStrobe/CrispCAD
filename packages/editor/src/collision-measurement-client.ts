// SPDX-License-Identifier: BSD-3-Clause
import type {CadDocument} from '@brickwright/cad-core';
import type {GeometryResult} from '@brickwright/cad-geometry';
import type {CollisionMeasurement,MeasureCollision} from '@brickwright/cad-physics';

export type CollisionMeasurementRequest={
 wasmURL:string;
 locale:string;
 source:Parameters<MeasureCollision>[0];
 hulls:Parameters<MeasureCollision>[1];
};
export type CollisionMeasurementReply=
 | {started:true}
 | {measurement:CollisionMeasurement}
 | {error:string}
 | {unavailable:true};

/** Offload one large compound when there is enough remaining work to overlap. */
export function createCollisionMeasurement(
 document:CadDocument, geometry:GeometryResult, wasmURL:string, locale:string, local:MeasureCollision,
){
 if(typeof Worker==='undefined'||(globalThis.navigator?.hardwareConcurrency??0)<4)return;
 let bodyId='',largest=0,total=0;
 for(const body of geometry.bodies){
  if(body.reference||body.hole)continue;
  const count=document.nodes[body.id]?.physics?.collisionAssembly?.length??0;
  total+=count;
  if(count>largest){bodyId=body.id;largest=count;}
 }
 if(largest<256||total-largest<256)return;
 let worker:Worker|undefined;
 try{worker=new Worker(new URL('./collision-measurement.worker.js',import.meta.url),{type:'module'});}
 catch{return;}
 let markStarted!:()=>void;
 const started=new Promise<void>(resolve=>{markStarted=resolve;});
 const close=()=>{worker?.terminate();worker=undefined;};
 const measure:MeasureCollision=(source,hulls)=>{
  const helper=worker;
  if(!helper)return local(source,hulls);
  return new Promise((resolve,reject)=>{
   const fallback=()=>{
    if(worker!==helper)return;
    close();
    Promise.resolve().then(()=>local(source,hulls)).then(resolve,reject);
   };
   helper.onmessage=({data}:MessageEvent<CollisionMeasurementReply>)=>{
    if('started' in data)markStarted();
    else if('unavailable' in data)fallback();
    else if('error' in data)reject(new Error(data.error));
    else resolve(data.measurement);
   };
   helper.onerror=event=>{event.preventDefault();fallback();};
   helper.onmessageerror=fallback;
   const request:CollisionMeasurementRequest={wasmURL,locale,source:{positions:source.positions,indices:source.indices},hulls};
   try{helper.postMessage(request);}catch{fallback();}
  });
 };
 return {bodyId,measure,started,close};
}
