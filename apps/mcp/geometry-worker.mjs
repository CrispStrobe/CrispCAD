// SPDX-License-Identifier: BSD-3-Clause
import {parentPort} from 'node:worker_threads';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {setLocale} from '@brickwright/cad-core';
import {createGeometryKernel,checkPrintability} from '@brickwright/cad-geometry';
const kernel=await createGeometryKernel({wasmBinary:readFileSync(fileURLToPath(import.meta.resolve('manifold-3d/manifold.wasm')))});
parentPort.on('message',({id,document,locale,printability})=>{try{setLocale(locale??'en');const result=kernel.evaluate(document);if(printability){parentPort.postMessage({id,result:{report:checkPrintability(result.bodies,printability)}});return;}parentPort.postMessage({id,result},result.bodies.flatMap(b=>[b.positions.buffer,b.indices.buffer]));}catch(error){parentPort.postMessage({id,error:error instanceof Error?error.message:String(error),diagnostic:error?.diagnostic});}});
