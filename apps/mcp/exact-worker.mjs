// SPDX-License-Identifier: BSD-3-Clause
// Exact-kernel requests (export step, measure exact) in their own thread: the host only starts
// it on the first exact request, a timeout or cancellation terminates it, and the kernel's
// WebAssembly memory goes with it.
import {parentPort} from 'node:worker_threads';
import {setLocale} from '@brickwright/cad-core';
import {createExactBackend} from '@brickwright/cad-exact';
const backend=await createExactBackend();
parentPort.on('message',({id,locale,request})=>{
 try{
  setLocale(locale??'en');
  const result=request.operation==='measure'?{operation:'measure',...backend.measure(request.document,request.bodies)}:{operation:'export-step',...backend.exportStep(request.document,request.bodies)};
  parentPort.postMessage({id,result});
 }catch(error){parentPort.postMessage({id,error:error instanceof Error?error.message:String(error),...(error?.diagnostic?{diagnostic:error.diagnostic}:{})});}
});
