#!/usr/bin/env node
// SPDX-License-Identifier: BSD-3-Clause
// Headless CLI over the shared command registry. It reuses the MCP host, so it
// has the same writer lock, validation, size limits and atomic history append.
import {resolve,basename,join} from 'node:path';
import {readFile,writeFile} from 'node:fs/promises';
import {t,setLocale} from '@brickwright/cad-core';
import {createCodeHost} from '../mcp/host.mjs';

const usage=()=>t('CrispCAD CLI\nnode apps/cli/crispcad.mjs commands\nnode apps/cli/crispcad.mjs run <project.bcad> "<command>" ["<command>" ...] [--dry-run] [--out <directory>]\nnode apps/cli/crispcad.mjs inspect|interference|printability|measure <project.bcad>\nnode apps/cli/crispcad.mjs drawing <project.bcad> <out.pdf|out.svg|out.dxf> [--sheet <id or title>] [--scale 1:2] [--mesh] [--no-dimensions] [--dxf r12|r2000] [--no-hidden]\nnode apps/cli/crispcad.mjs manufacturing <project.bcad> [--process fdm|cnc|laser|molding] [--tool <mm>] [--axes +z,+x] [--depth-ratio <n>] [--dogbones] [--pull +z] [--draft <deg>] [--min-wall <mm>] [--max-wall <mm>] [--variation <fraction>] [--min-radius <mm>] [--max-radius <mm>] [--edge-break none|external|internal|all] [--mesh]\nnode apps/cli/crispcad.mjs materials <project.bcad> [--exact]\nnode apps/cli/crispcad.mjs blends <project.bcad>\nnode apps/cli/crispcad.mjs evidence <project.bcad> [<file.step>]\nnode apps/cli/crispcad.mjs step <project.bcad> <file.step>\nnode apps/cli/crispcad.mjs import <project.bcad> <file.step> [--dry-run]\nnode apps/cli/crispcad.mjs mechanism <project.bcad> [joint] [--range <from>,<to>] [--steps <n>] [--clearance <mm>]\nnode apps/cli/crispcad.mjs assembly <project.bcad>\nOptions: --locale en|de. Output is JSON on stdout. measure, blends, evidence, step, import and the commands fillet, chamfer, shell and recompute exact use the exact B-rep kernel; --out writes files that commands produce, such as export step.\n');
const argv=process.argv.slice(2),positional=[];let dryRun=false,outDir,materialsExact=false;
// Manufacturing check options (read-only; the CLI's "manufacturing" verb).
const drawing={},check={},mechanism={},numberOptions={'--tool':'toolDiameterMm','--min-wall':'minWallMm','--min-radius':'minRadiusMm','--max-radius':'maxRadiusMm','--nozzle':'nozzleMm','--min-hole':'minHoleMm','--depth-ratio':'maxPocketDepthRatio','--draft':'minDraftDeg','--max-wall':'maxWallMm','--variation':'wallVariation'};
for(let i=0;i<argv.length;i++){
 if(argv[i]==='--locale'&&['en','de'].includes(argv[i+1]))setLocale(argv[++i]);
 else if(argv[i]==='--dry-run')dryRun=true;
 else if(argv[i]==='--out'&&argv[i+1])outDir=resolve(argv[++i]);
 else if(argv[i]==='--process'&&argv[i+1])check.process=argv[++i];
 else if(Object.hasOwn(numberOptions,argv[i])&&argv[i+1])check[numberOptions[argv[i]]]=Number(argv[++i]);
 else if(argv[i]==='--axes'&&argv[i+1])check.approachAxes=argv[++i].split(',').map(a=>/^[xyz]$/i.test(a)?'+'+a.toLowerCase():a.toLowerCase());
 else if(argv[i]==='--edge-break'&&argv[i+1])check.edgeBreak=argv[++i];
 else if(argv[i]==='--pull'&&argv[i+1]){const axis=argv[++i].toLowerCase();check.pullAxis=/^[xyz]$/.test(axis)?'+'+axis:axis;}
 else if(argv[i]==='--dogbones')check.dogbones=true;
 else if(argv[i]==='--mesh')check.exact=false;
 // Drawing options (the "drawing" verb).
 else if(argv[i]==='--sheet'&&argv[i+1])drawing.sheet=argv[++i];
 else if(argv[i]==='--scale'&&argv[i+1])drawing.scale=argv[++i];
 else if(argv[i]==='--no-dimensions')drawing.autoDimensions=false;
 else if(argv[i]==='--no-hidden')drawing.hiddenLines=false;
 else if(argv[i]==='--dxf'&&argv[i+1])drawing.dxfVersion=argv[++i].toUpperCase();
 else if(argv[i]==='--exact')materialsExact=true;
 else if(argv[i]==='--steps'&&argv[i+1])mechanism.steps=Number(argv[++i]);
 else if(argv[i]==='--clearance'&&argv[i+1])mechanism.clearanceMm=Number(argv[++i]);
 else if(argv[i]==='--range'&&argv[i+1])mechanism.range=argv[++i].split(',').map(Number);
 else if(argv[i]==='--help'||argv[i]==='-h'){process.stdout.write(usage());process.exit(0);}
 else if(argv[i].startsWith('--')){process.stderr.write(t`Unknown argument: ${argv[i]}\n`);process.exit(1);}
 else positional.push(argv[i]);
}
const [verb,project,...commands]=positional;
const tools={inspect:'cad_inspect',interference:'cad_check_interference',printability:'cad_check_printability',measure:'cad_measure_exact',manufacturing:'cad_check_manufacturing',mechanism:'cad_check_mechanism',assembly:'cad_assembly',materials:'cad_inspect_materials',blends:'cad_surface_blends'};
if(!verb||verb!=='commands'&&!project||verb==='run'&&!commands.length||(verb==='step'||verb==='import'||verb==='drawing')&&commands.length!==1||verb==='evidence'&&commands.length>1||!['commands','run','step','import','drawing','evidence',...Object.keys(tools)].includes(verb)){process.stderr.write(usage());process.exit(1);}
const host=await createCodeHost(verb==='commands'?{}:{project:resolve(project)});
let code=0;
try{
 let result;
 if(verb==='commands')result=await host.call('cad_list_commands',{});
 else if(verb==='run'){
  const {revision}=await host.call('cad_get_model');result=await host.call('cad_run_commands',{commands:commands.join('\n'),expectedRevision:revision,...(dryRun?{preview:true}:{})});
  // Files (export step) are written with --out; the JSON keeps only their names and sizes.
  for(const entry of result.results??[])if(entry.file){
   const bytes=Buffer.from(entry.file.base64,'base64');
   if(outDir){const path=join(outDir,basename(entry.file.name));await writeFile(path,bytes);entry.file={name:entry.file.name,mime:entry.file.mime,bytes:bytes.length,path};}
   else entry.file={name:entry.file.name,mime:entry.file.mime,bytes:bytes.length};
  }
 }
 else if(verb==='import'){
  // STEP as exact bodies: the file's bytes go to cad_import_step (strict: all bodies or none).
  const path=resolve(commands[0]),bytes=await readFile(path),{revision}=await host.call('cad_get_model');
  if(bytes.length>3*1024*1024)throw new Error(t('The STEP file exceeds the 3 MiB limit of this host; import it in the editor.'));
  result=await host.call('cad_import_step',{name:basename(path),base64:bytes.toString('base64'),expectedRevision:revision,...(dryRun?{preview:true}:{})});
 }
 else if(verb==='drawing'){
  // The format from the file's extension; --mesh draws from the display meshes instead of exact edges.
  const path=resolve(commands[0]),format=path.toLowerCase().match(/\.(pdf|svg|dxf)$/)?.[1];
  if(!format)throw new Error(t('Name a .pdf, .svg or .dxf file for the drawing.'));
  const {base64,...rest}=await host.call('cad_drawing',{format,...drawing,...(check.exact===false?{exact:false}:{})}),bytes=Buffer.from(base64,'base64');
  await writeFile(path,bytes);result={...rest,path,bytes:bytes.length};
 }
 else if(verb==='step'){
  const {base64,...rest}=await host.call('cad_export_step',{}),path=resolve(commands[0]),bytes=Buffer.from(base64,'base64');
  await writeFile(path,bytes);result={...rest,path,bytes:bytes.length};
 }
 else if(verb==='evidence'){
  // STEP evidence of a file, or (no file) a round trip of the project's bodies. Read-only.
  if(commands.length){
   const path=resolve(commands[0]),bytes=await readFile(path);
   if(bytes.length>3*1024*1024)throw new Error(t('The STEP file exceeds the 3 MiB limit of this host; open it in the editor.'));
   result=await host.call('cad_step_evidence',{name:basename(path),base64:bytes.toString('base64')});
  }else result=await host.call('cad_step_evidence',{});
 }
 else result=await host.call(tools[verb],verb==='manufacturing'?{process:'cnc',...check}:verb==='materials'?{exact:materialsExact}:verb==='mechanism'?{joint:commands[0]??'1',...mechanism}:{});
 process.stdout.write(JSON.stringify(result,null,2)+'\n');
}catch(error){process.stderr.write((error instanceof Error?error.message:String(error))+'\n');code=1;}
finally{await host.dispose();}
process.exit(code);
