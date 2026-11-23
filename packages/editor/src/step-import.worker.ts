// SPDX-License-Identifier: BSD-3-Clause
import {decodeStep} from './decode-step.js';
import type {StepMesh} from './decode-step.js';

export type StepImportResponse={meshes:StepMesh[]}|{error:string};

self.onmessage=async({data}:MessageEvent<ArrayBuffer>)=>{
 try{
  const response=await fetch(new URL('../assets/step-tessellator.wasm',import.meta.url));
  if(!response.ok)throw new Error('STEP reader could not be loaded');
  const meshes=await decodeStep(await response.arrayBuffer(),new Uint8Array(data));
  self.postMessage({meshes} satisfies StepImportResponse,{
   transfer:meshes.flatMap(mesh=>[mesh.positions.buffer,mesh.indices.buffer])
  });
 }catch(error){
  self.postMessage({error:error instanceof Error?error.message:String(error)} satisfies StepImportResponse);
 }
};
