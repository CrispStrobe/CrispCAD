// SPDX-License-Identifier: BSD-3-Clause
import {parentPort} from 'node:worker_threads';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {setLocale} from '@brickwright/cad-core';
import {createGeometryKernel,checkPrintability,checkManufacturing,inspectBodies,renderBodies,materialMeasures,inspectSurfaceBlends} from '@brickwright/cad-geometry';
const kernel=await createGeometryKernel({wasmBinary:readFileSync(fileURLToPath(import.meta.resolve('manifold-3d/manifold.wasm')))});
// Analyses run beside the evaluation so meshes never cross the thread boundary.
const analyses={
 printability:(bodies,options)=>({report:checkPrintability(bodies,options)}),
 inspect:bodies=>({bodies:inspectBodies(bodies)}),
 manufacturing:(bodies,{settings,bodies:ids,exact,exactUnavailable,kernel})=>({report:checkManufacturing({meshes:bodies,bodies:ids,...(exact?{exact}:{}),...(exactUnavailable?{exactUnavailable}:{}),...(kernel?{kernel}:{})},settings)}),
 interference:(bodies,options)=>kernel.interference(bodies,options),
 slice:(bodies,{cut})=>({section:kernel.sliceAssembly({bodies},cut)}),
 materials:bodies=>materialMeasures(kernel,bodies),
 blends:(_bodies,{document,exact,bodies:ids,kernel:label,marks})=>({report:inspectSurfaceBlends({document,exact,bodies:ids,...(label?{kernel:label}:{}),marks:!!marks})}),
 render:(bodies,options)=>({views:options.views.map(view=>({view,png:Buffer.from(renderBodies(bodies,view,options.size)).toString('base64')}))}),
};
parentPort.on('message',({id,document,locale,printability,analysis})=>{try{setLocale(locale??'en');const result=kernel.evaluate(document);
 if(printability)analysis={kind:'printability',options:printability};
 if(analysis){const run=analyses[analysis.kind];if(!run)throw new Error('Unknown analysis');parentPort.postMessage({id,result:run(result.bodies,analysis.options??{})});return;}
 parentPort.postMessage({id,result},result.bodies.flatMap(b=>[b.positions.buffer,b.indices.buffer]));}catch(error){parentPort.postMessage({id,error:error instanceof Error?error.message:String(error),diagnostic:error?.diagnostic});}});
