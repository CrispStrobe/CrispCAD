// SPDX-License-Identifier: BSD-3-Clause
// The exact kernel in a module worker, as the editor's exact worker runs it.
import type {ExactCommandRequest} from '@brickwright/cad-core';
let loaded:Promise<{module:typeof import('@brickwright/cad-exact');backend:import('@brickwright/cad-exact').ExactBackend}>|undefined;
self.onmessage=async(event:MessageEvent<{id:number;request:ExactCommandRequest}>)=>{
 const {id,request}=event.data,started=performance.now();
 try{
  loaded??=import('@brickwright/cad-exact').then(async module=>({module,backend:await module.createExactBackend()}));
  const {module,backend}=await loaded;
  self.postMessage({id,result:module.runExactRequest(backend,request,performance.now()-started)});
 }catch(error){self.postMessage({id,error:error instanceof Error?error.message:String(error)});}
};
