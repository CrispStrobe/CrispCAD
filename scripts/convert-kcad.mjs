#!/usr/bin/env node
// SPDX-License-Identifier: BSD-3-Clause
// Convert kernelCAD `.kcad.ts` model scripts to Brickwright CAD Script.
//   node scripts/convert-kcad.mjs <file.kcad.ts|directory> [--out dir] [--report report.json] [--evaluate]
// TypeScript annotations are stripped with the TypeScript compiler (a development
// dependency); the bounded interpreter then evaluates the script without running it.
// Only models whose meta() declares CC0-1.0 or MIT are converted.
import {readFile,readdir,writeFile,mkdir,stat} from 'node:fs/promises';
import {join,relative,resolve,basename} from 'node:path';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {importKernelCAD,createCadSession} from '@brickwright/cad-core';

export function stripTypes(source){return ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,removeComments:false}}).outputText;}

export function convertKernelCAD(source,overrides={}){return importKernelCAD(stripTypes(source),overrides);}

async function files(path){const info=await stat(path);if(info.isFile())return [path];const out=[];for(const entry of await readdir(path,{withFileTypes:true})){const full=join(path,entry.name);if(entry.isDirectory())out.push(...await files(full));else if(entry.name.endsWith('.kcad.ts'))out.push(full);}return out.sort();}

if(import.meta.url===`file://${process.argv[1]}`){
 const args=process.argv.slice(2),value=flag=>{const i=args.indexOf(flag);return i<0?undefined:args[i+1];};
 const input=args.find((a,i)=>!a.startsWith('--')&&!['--out','--report'].includes(args[i-1]));
 if(!input){process.stderr.write('Usage: node scripts/convert-kcad.mjs <file.kcad.ts|directory> [--out dir] [--report report.json] [--evaluate]\n');process.exit(1);}
 const out=value('--out'),reportPath=value('--report'),evaluate=args.includes('--evaluate');
 let kernel;if(evaluate){const {createGeometryKernel}=await import('@brickwright/cad-geometry');kernel=await createGeometryKernel({wasmBinary:await readFile(new URL('../node_modules/manifold-3d/manifold.wasm',import.meta.url))});}
 const results=[],root=resolve(input);
 for(const file of await files(root)){
  const source=await readFile(file,'utf8'),id=relative((await stat(root)).isFile()?resolve(root,'..'):root,file),sha256=createHash('sha256').update(source).digest('hex');
  try{
   const converted=convertKernelCAD(source);let geometry;
   if(kernel){geometry=[];for(const part of converted.parts){const s=createCadSession();try{s.addCode(part.program,part.name);const r=kernel.evaluate(s.state.document);geometry.push({name:part.name,volumeMm3:r.volume,triangles:r.triangles});}catch(error){geometry.push({name:part.name,error:String(error?.message??error).slice(0,200)});}finally{s.dispose();}}}
   if(out){const dir=resolve(out,id.replace(/\.kcad\.ts$/,''));await mkdir(dir,{recursive:true});
    for(const [i,part] of converted.parts.entries())await writeFile(join(dir,`${String(i+1).padStart(2,'0')}-${part.name.replace(/[^a-zA-Z0-9_-]+/g,'-')}.cad`),`// Converted from kernelCAD ${id} (sha256 ${sha256}); content licence ${converted.license}.\n// Evaluated snapshot at default parameters${part.color?`; colour ${part.color}`:''}.\n${part.program.source}\n`);
   }
   const geometryFailures=geometry?.filter(g=>g.error).length??0;
   results.push({id,sha256,status:geometryFailures===converted.parts.length?'failed':converted.skippedParts.length||geometryFailures?'partial':'converted',license:converted.license,title:converted.title??null,parts:converted.parts.length,skippedParts:converted.skippedParts,warnings:converted.warnings,...(geometry?{geometry}:{})});
  }catch(error){results.push({id,sha256,status:error?.code==='licence'?'licence':error?.code==='unsupported-feature'?'unsupported':error?.code==='resource-limit'?'limited':'failed',error:String(error?.message??error).split('\n')[0].slice(0,300)});}
 }
 const counts=Object.fromEntries(['converted','partial','unsupported','limited','licence','failed'].map(s=>[s,results.filter(r=>r.status===s).length]));
 const report={tool:'convert-kcad',files:results.length,counts,results};
 if(reportPath)await writeFile(reportPath,JSON.stringify(report,null,1)+'\n');
 process.stdout.write(JSON.stringify({files:results.length,counts},null,1)+'\n');
 if(results.length===1&&results[0].error)process.stderr.write(`${basename(results[0].id)}: ${results[0].error}\n`);
}
