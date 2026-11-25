// SPDX-License-Identifier: BSD-3-Clause
import type {CadDocument} from '@brickwright/cad-core';
import type {GeometryResult} from '@brickwright/cad-geometry';
import type {CollisionMeasurement,MeasureCollision} from '@brickwright/cad-physics';

export type CollisionMeasurementRequest={
 id:number;
 wasmURL:string;
 locale:string;
 source:Parameters<MeasureCollision>[0];
 hulls:Parameters<MeasureCollision>[1];
};
export type CollisionMeasurementReply={id:number}&(
 | {started:true}
 | {measurement:CollisionMeasurement}
 | {error:string}
 | {unavailable:true});

const HELPER_START_TIMEOUT_MS=2000;

/** Balance large compounds across the simulation worker and one helper. */
export function createCollisionMeasurement(
 document:CadDocument, geometry:GeometryResult, wasmURL:string, locale:string, local:MeasureCollision,
){
 if(typeof Worker==='undefined'||(globalThis.navigator?.hardwareConcurrency??0)<4)return;
 const large:{id:string;hulls:number}[]=[];
 let localHulls=0,remoteHulls=0;
 for(const body of geometry.bodies){
  if(body.reference||body.hole)continue;
  const count=document.nodes[body.id]?.physics?.collisionAssembly?.length??0;
  if(count>=64)large.push({id:body.id,hulls:count});
  else localHulls+=count;
 }
 large.sort((a,b)=>b.hulls-a.hulls);
 const bodyIds=new Set<string>();
 for(const body of large){
  if(remoteHulls<=localHulls){bodyIds.add(body.id);remoteHulls+=body.hulls;}
  else localHulls+=body.hulls;
 }
 if(localHulls<256||remoteHulls<256)return;
 let worker:Worker|undefined;
 try{worker=new Worker(new URL('./collision-measurement.worker.js',import.meta.url),{type:'module'});}
 catch{return;}
 let markStarted!:()=>void;
 const started=new Promise<void>(resolve=>{markStarted=resolve;});
 let requestId=0,ready=false,startTimer:ReturnType<typeof setTimeout>|undefined;
 const pending=new Map<number,{
  request:CollisionMeasurementRequest;
  resolve:(measurement:CollisionMeasurement)=>void;
  reject:(error:unknown)=>void;
 }>();
 const close=()=>{clearTimeout(startTimer);worker?.terminate();worker=undefined;};
 const fallback=()=>{
  close();
  for(const {request,resolve,reject} of pending.values()){
   Promise.resolve().then(()=>local(request.source,request.hulls)).then(resolve,reject);
  }
  pending.clear();
 };
 worker.onmessage=({data}:MessageEvent<CollisionMeasurementReply>)=>{
  const job=pending.get(data.id);
  if(!job)return;
  if('unavailable' in data){fallback();return;}
  if('started' in data){
   clearTimeout(startTimer);ready=true;markStarted();return;
  }
  pending.delete(data.id);
  if('error' in data)job.reject(new Error(data.error));
  else job.resolve(data.measurement);
 };
 worker.onerror=event=>{event.preventDefault();fallback();};
 worker.onmessageerror=fallback;
 const measure:MeasureCollision=(source,hulls)=>{
  const helper=worker;
  if(!helper)return local(source,hulls);
  return new Promise((resolve,reject)=>{
   const request:CollisionMeasurementRequest={id:++requestId,wasmURL,locale,source:{positions:source.positions,indices:source.indices},hulls};
   pending.set(request.id,{request,resolve,reject});
   if(!ready&&startTimer===undefined)startTimer=setTimeout(fallback,HELPER_START_TIMEOUT_MS);
   try{helper.postMessage(request);}catch{fallback();}
  });
 };
 return {bodyIds,measure,started,close};
}
