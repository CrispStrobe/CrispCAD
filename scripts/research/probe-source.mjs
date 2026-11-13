// SPDX-License-Identifier: BSD-3-Clause
// One bounded source probe per process; no source JS or upstream renderer runs.
import {readFile} from 'node:fs/promises';
import {importOpenSCAD,createCadSession,CadCodeError,CODE_LIMITS} from '@brickwright/cad-core';
import {createGeometryKernel} from '@brickwright/cad-geometry';
let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>262144)throw Error('Probe request too large');}
const {source,geometry:wantGeometry}=JSON.parse(input);const start=performance.now();let result;
if(typeof source!=='string'||Buffer.byteLength(source)>CODE_LIMITS.sourceBytes)result={status:'limited',reason:'source-bytes',maxSourceBytes:CODE_LIMITS.sourceBytes};
else try{const program=importOpenSCAD(source),convertedMs=performance.now()-start;result={status:'converted',convertedMs};if(wantGeometry){const initialization=performance.now(),kernel=await createGeometryKernel({wasmBinary:await readFile(new URL('../../node_modules/manifold-3d/manifold.wasm',import.meta.url))}),session=createCadSession();session.addCode(program);const at=performance.now(),evaluated=kernel.evaluate(session.state.document);result.geometry={status:'positive-solid',volumeMm3:evaluated.volume,triangles:evaluated.triangles,bounds:evaluated.bodies.map(b=>b.bounds),initializationMs:at-initialization,evaluationMs:performance.now()-at};}}
catch(error){result={status:error instanceof CadCodeError&&error.code==='unsupported-feature'?'unsupported':error instanceof CadCodeError&&error.code==='resource-limit'?'limited':'failed',error:{code:error.code??'geometry-or-conversion',message:error.message,...(error instanceof CadCodeError?{line:error.line,column:error.column}:{})},elapsedMs:performance.now()-start};}
result.rssBytes=process.memoryUsage().rss;console.log(JSON.stringify(result));
