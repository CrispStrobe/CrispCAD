// SPDX-License-Identifier: BSD-3-Clause
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {createCadSession,CadCodeError} from '@brickwright/cad-core';
import {createGeometryKernel} from '@brickwright/cad-geometry';
import {convertSource} from './convert-code.mjs';
import {loadCodeCorpus} from './load-code-corpus.mjs';
const args=process.argv.slice(2),value=flag=>{const i=args.indexOf(flag);return i<0?undefined:args[i+1];};
const path=resolve(value('--manifest')??'tests/fixtures/code-corpus/manifest.json'),library=value('--library'),paths=library?['seed-catalogue.json','fixtures-manifest.json','examples-manifest.json','supported-models-manifest.json'].map(file=>resolve(library,file)):[path];const models=(await Promise.all(paths.map(loadCodeCorpus))).flat();
const kernel=await createGeometryKernel({wasmBinary:await readFile(new URL('../node_modules/manifold-3d/manifold.wasm',import.meta.url))});
const results=[];let unexpected=0;
for(const item of models){const start=performance.now();let result;try{
 const source=await readFile(resolve(item.file),'utf8'),sha256=createHash('sha256').update(source).digest('hex');if(item.sha256&&item.sha256!==sha256)throw Error('Source hash differs from manifest');
 const converted=convertSource(source,{from:item.format,entryPoint:item.entryPoint,arguments:item.arguments,parameters:item.parameters??{}}),session=createCadSession();session.addCode(converted.program);const geometry=kernel.evaluate(session.state.document);
 const outputs=[];for(const output of converted.outputs){const s=createCadSession();s.addCode(output.program);const evaluated=kernel.evaluate(s.state.document);outputs.push({volumeMm3:evaluated.volume,boundsMm:evaluated.bodies[0].bounds,color:output.color??null});}
 result={id:item.id,status:'converted',sha256,evaluatedSnapshot:converted.evaluatedSnapshot,warnings:converted.warnings,geometry:{volumeMm3:geometry.volume,triangles:geometry.triangles,outputs}};
 }catch(error){result={id:item.id,status:error instanceof CadCodeError&&error.code==='unsupported-feature'?'unsupported':error instanceof CadCodeError&&error.code==='resource-limit'?'limited':'failed',error:{message:error.message,...(error instanceof CadCodeError?{code:error.code,line:error.line,column:error.column,offset:error.offset}:{})}};}
 result.elapsedMs=Math.round(performance.now()-start);const expected=item.expected??(item.expectedGap?'unsupported':undefined);result.expected=expected??null;result.unexpected=expected?result.status!==expected||(result.status==='unsupported'&&item.expectedGap&&!result.error.message.includes(item.expectedGap)):['failed','limited'].includes(result.status);if(result.unexpected)unexpected++;results.push(result);
}
const report={version:1,manifest:library?paths:path,converted:results.filter(r=>r.status==='converted').length,unsupported:results.filter(r=>r.status==='unsupported').length,failed:results.filter(r=>r.status==='failed').length,limited:results.filter(r=>r.status==='limited').length,unexpected,results};const text=JSON.stringify(report,null,2)+'\n';if(value('--report'))await writeFile(resolve(value('--report')),text);console.log(text);if(unexpected||args.includes('--strict')&&(report.unsupported||report.limited))process.exitCode=1;
