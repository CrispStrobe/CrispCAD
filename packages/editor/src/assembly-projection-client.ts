// SPDX-License-Identifier: BSD-3-Clause
import {getLocale,t} from '@brickwright/cad-core';
import type {GeometryResult} from '@brickwright/cad-geometry';
import type {AssemblyProjection} from './assembly-drawing.js';
import type {AssemblyProjectionRequest,AssemblyProjectionResponse} from './assembly-projection.worker.js';

const makeWorker=()=>new Worker(new URL('./assembly-projection.worker.js',import.meta.url),{type:'module'});
type ProjectionKey=string|GeometryResult;
type ActiveProjection={
 key:ProjectionKey; promise:Promise<AssemblyProjection>; reject:(error:Error)=>void;
};

export function createAssemblyProjectionClient(createWorker=makeWorker){
 let active:ActiveProjection|undefined;
 let cached:{key:ProjectionKey; value:AssemblyProjection}|undefined;
 let disposed=false;

 function project(geometry:GeometryResult):Promise<AssemblyProjection>{
  if(disposed)return Promise.reject(new Error(t('Editor was disposed')));
  const key=geometry.sourceKey??geometry;
  if(cached?.key===key)return Promise.resolve(cached.value);
  if(active?.key===key)return active.promise;
  active?.reject(new Error(t('The assembly changed while projecting the drawing.')));
  let worker:Worker;
  try{worker=createWorker();}
  catch(error){return Promise.reject(error);}

  let resolve!:(value:AssemblyProjection)=>void,reject!:(error:Error)=>void;
  const promise=new Promise<AssemblyProjection>((ok,fail)=>{resolve=ok;reject=fail;});
  function finish(){
   if(active!==job)return false;
   active=undefined;
   clearTimeout(timer);
   worker.terminate();
   return true;
  }
  const job:ActiveProjection={key,promise,reject(error){if(finish())reject(error);}};
  const timer=setTimeout(()=>job.reject(new Error(t('The assembly projection exceeded 30 seconds.'))),30000);
  active=job;
  worker.onmessage=({data}:MessageEvent<AssemblyProjectionResponse>)=>{
   if('error' in data){job.reject(new Error(data.error));return;}
   if(!finish())return;
   cached={key,value:data.projection};
   resolve(data.projection);
  };
  worker.onerror=event=>job.reject(new Error(event.message||t('Assembly projection worker failed.')));
  worker.onmessageerror=()=>job.reject(new Error(t('Assembly projection worker failed.')));
  try{
   // Keep the evaluated mesh buffers available to the viewport and simulation.
   worker.postMessage({geometry,locale:getLocale()} satisfies AssemblyProjectionRequest);
  }catch(error){
   job.reject(error instanceof Error?error:new Error(String(error)));
  }
  return promise;
 }

 return {project,dispose(){
  disposed=true;
  active?.reject(new Error(t('Editor was disposed')));
  cached=undefined;
 }};
}
