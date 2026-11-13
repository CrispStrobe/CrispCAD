// SPDX-License-Identifier: BSD-3-Clause
import {parentPort} from 'node:worker_threads';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createGeometryKernel} from '@brickwright/cad-geometry';
const kernel=await createGeometryKernel({wasmBinary:readFileSync(fileURLToPath(import.meta.resolve('manifold-3d/manifold.wasm')))});
parentPort.on('message',({id,document})=>{try{const result=kernel.evaluate(document);parentPort.postMessage({id,result},result.bodies.flatMap(b=>[b.positions.buffer,b.indices.buffer]));}catch(error){parentPort.postMessage({id,error:error instanceof Error?error.message:String(error),diagnostic:error?.diagnostic});}});
