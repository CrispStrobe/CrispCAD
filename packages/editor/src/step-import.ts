// SPDX-License-Identifier: BSD-3-Clause
import {t} from '@brickwright/cad-core';
import type {StepMesh} from './decode-step.js';
import {maxStepBytes} from './decode-step.js';
import type {StepImportResponse} from './step-import.worker.js';

export function importStep(input:Uint8Array,signal:AbortSignal):Promise<StepMesh[]>{
 return new Promise((resolve,reject)=>{
  if(signal.aborted){reject(signal.reason);return;}
  if(input.byteLength>maxStepBytes){reject(new Error(t('STEP exceeds 16 MiB')));return;}
  const worker=new Worker(new URL('./step-import.worker.js',import.meta.url),{type:'module'});
  const finish=()=>{
   clearTimeout(timeout);
   signal.removeEventListener('abort',abort);
   worker.terminate();
  };
  const abort=()=>{finish();reject(signal.reason);};
  const timeout=setTimeout(()=>{
   finish();
   reject(new Error(t('STEP import took too long. Try a smaller part or assembly.')));
  },25000);
  signal.addEventListener('abort',abort,{once:true});
  const fail=()=>{
   finish();
   reject(new Error(t('Could not read STEP geometry.')));
  };
  worker.onerror=worker.onmessageerror=fail;
  worker.onmessage=({data}:MessageEvent<StepImportResponse>)=>{
   finish();
   if('error' in data)reject(new Error(t`Could not read STEP geometry: ${data.error}`));
   else resolve(data.meshes);
  };
  try{
   const copy=new Uint8Array(input).buffer;
   worker.postMessage(copy,[copy]);
  }catch{fail();}
 });
}
