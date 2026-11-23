// SPDX-License-Identifier: BSD-3-Clause
import {t} from '@brickwright/cad-core';
import type {CadDocument,PlanarSketch} from '@brickwright/cad-core';
import {describeSketchExchange,sketchForExchange} from './sketch-exchange.js';
import type {SketchExchange} from './sketch-exchange.js';
import type {SketchDwgRequest,SketchDwgResponse} from './sketch-dwg.worker.js';

function requestDwg(request:SketchDwgRequest,signal:AbortSignal):Promise<string|ArrayBuffer>{
 return new Promise((resolve,reject)=>{
  if(signal.aborted){reject(signal.reason);return;}
  const reading=request.kind==='read';
  const error=()=>new Error(reading?t('This DWG could not be decoded as a supported 2D drawing.'):t('Could not export the sketch as DWG.'));
  let worker:Worker;
  try{worker=new Worker(new URL('./sketch-dwg.worker.js',import.meta.url),{type:'module'});}
  catch{reject(error());return;}
  const finish=()=>{
   clearTimeout(timer);
   worker.terminate();
   signal.removeEventListener('abort',abort);
  };
  const abort=()=>{
   finish();
   reject(signal.reason);
  };
  const fail=()=>{
   finish();
   reject(error());
  };
  const timer=setTimeout(()=>{
   finish();
   reject(new Error(reading?t('DWG import took too long. Try a smaller 2D drawing.'):t('DWG export took too long. Try a simpler sketch.')));
  },10000);
  signal.addEventListener('abort',abort,{once:true});
  worker.onerror=worker.onmessageerror=fail;
  worker.onmessage=({data}:MessageEvent<SketchDwgResponse>)=>{
   if(data?.kind==='read'&&reading&&typeof data.text==='string'){
    finish();resolve(data.text);
   }else if(data?.kind==='write'&&!reading&&data.bytes instanceof ArrayBuffer){
    finish();resolve(data.bytes);
   }else fail();
  };
  try{worker.postMessage(request,request.kind==='read'?[request.bytes]:[]);}
  catch{fail();}
 });
}

export async function readSketchDwg(bytes:ArrayBuffer,signal:AbortSignal){
 const result=await requestDwg({kind:'read',bytes},signal);
 if(typeof result!=='string')throw new Error(t('This DWG could not be decoded as a supported 2D drawing.'));
 return result;
}

async function writeSketchDwg(drawing:SketchExchange,signal:AbortSignal){
 const result=await requestDwg({kind:'write',drawing},signal);
 if(typeof result==='string')throw new Error(t('Could not export the sketch as DWG.'));
 return {name:drawing.name+'.dwg',mime:'image/vnd.dwg',bytes:new Uint8Array(result)};
}

export function exportSketchDwg(doc:CadDocument,id:string,signal:AbortSignal){
 return writeSketchDwg(describeSketchExchange(doc,sketchForExchange(doc,id,'DWG')),signal);
}

export function exportSketchPathDwg(doc:CadDocument,sketch:PlanarSketch,signal:AbortSignal){
 if(sketch.profile.kind!=='path')throw new Error(t('Select an open sketch path'));
 return writeSketchDwg(describeSketchExchange(doc,sketch),signal);
}
