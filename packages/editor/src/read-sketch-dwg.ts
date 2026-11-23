// SPDX-License-Identifier: BSD-3-Clause
import {t} from '@brickwright/cad-core';

export function readSketchDwg(buffer:ArrayBuffer,signal:AbortSignal):Promise<string>{
 if(signal.aborted)return Promise.reject(signal.reason);
 return new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./sketch-dwg.worker.js',import.meta.url),{type:'module'});
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
   reject(new Error(t('This DWG could not be decoded as a supported 2D drawing.')));
  };
  const timer=setTimeout(()=>{
   finish();
   reject(new Error(t('DWG import took too long. Try a smaller 2D drawing.')));
  },10000);
  signal.addEventListener('abort',abort,{once:true});
  worker.onerror=worker.onmessageerror=fail;
  worker.onmessage=({data}:MessageEvent<{text?:string}>)=>{
   if(typeof data?.text!=='string'){fail();return;}
   finish();
   resolve(data.text);
  };
  try{worker.postMessage(buffer,[buffer]);}
  catch{fail();}
 });
}
