// SPDX-License-Identifier: BSD-3-Clause
// Exact-kernel requests (export step, measure exact, exact feature display meshes) in their own thread: the host only starts
// it on the first exact request, a timeout or cancellation terminates it, and the kernel's
// WebAssembly memory goes with it.
import {parentPort} from 'node:worker_threads';
import {setLocale} from '@brickwright/cad-core';
import {createExactBackend} from '@brickwright/cad-exact';
const started=performance.now(),backend=await createExactBackend();let loadMs=performance.now()-started;
parentPort.on('message',({id,locale,request})=>{
 try{
  setLocale(locale??'en');
  const begin=performance.now(),computed=request.operation==='measure'?{operation:'measure',...backend.measure(request.document,request.bodies)}:request.operation==='feature-display'?{operation:'feature-display',...backend.featureDisplays(request.document,request.bodies)}:{operation:'export-step',...backend.exportStep(request.document,request.bodies)};
  parentPort.postMessage({id,result:{...computed,timing:{loadMs,runMs:performance.now()-begin,memoryBytes:backend.kernel.memory().heap}}});loadMs=0;
 }catch(error){parentPort.postMessage({id,error:error instanceof Error?error.message:String(error),...(error?.diagnostic?{diagnostic:error.diagnostic}:{})});}
});
