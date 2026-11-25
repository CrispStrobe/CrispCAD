#!/usr/bin/env node
// SPDX-License-Identifier: BSD-3-Clause
// Headless CLI over the shared command registry. It reuses the MCP host, so it
// has the same writer lock, validation, size limits and atomic history append.
import {resolve,basename,join} from 'node:path';
import {writeFile} from 'node:fs/promises';
import {t,setLocale} from '@brickwright/cad-core';
import {createCodeHost} from '../mcp/host.mjs';

const usage=()=>t('CrispCAD CLI\nnode apps/cli/crispcad.mjs commands\nnode apps/cli/crispcad.mjs run <project.bcad> "<command>" ["<command>" ...] [--dry-run] [--out <directory>]\nnode apps/cli/crispcad.mjs inspect|interference|printability|measure <project.bcad>\nnode apps/cli/crispcad.mjs step <project.bcad> <file.step>\nOptions: --locale en|de. Output is JSON on stdout. measure, step and the commands fillet, chamfer, shell and recompute exact use the exact B-rep kernel; --out writes files that commands produce, such as export step.\n');
const argv=process.argv.slice(2),positional=[];let dryRun=false,outDir;
for(let i=0;i<argv.length;i++){
 if(argv[i]==='--locale'&&['en','de'].includes(argv[i+1]))setLocale(argv[++i]);
 else if(argv[i]==='--dry-run')dryRun=true;
 else if(argv[i]==='--out'&&argv[i+1])outDir=resolve(argv[++i]);
 else if(argv[i]==='--help'||argv[i]==='-h'){process.stdout.write(usage());process.exit(0);}
 else if(argv[i].startsWith('--')){process.stderr.write(t`Unknown argument: ${argv[i]}\n`);process.exit(1);}
 else positional.push(argv[i]);
}
const [verb,project,...commands]=positional;
const tools={inspect:'cad_inspect',interference:'cad_check_interference',printability:'cad_check_printability',measure:'cad_measure_exact'};
if(!verb||verb!=='commands'&&!project||verb==='run'&&!commands.length||verb==='step'&&commands.length!==1||!['commands','run','step',...Object.keys(tools)].includes(verb)){process.stderr.write(usage());process.exit(1);}
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
 else if(verb==='step'){
  const {base64,...rest}=await host.call('cad_export_step',{}),path=resolve(commands[0]),bytes=Buffer.from(base64,'base64');
  await writeFile(path,bytes);result={...rest,path,bytes:bytes.length};
 }
 else result=await host.call(tools[verb],{});
 process.stdout.write(JSON.stringify(result,null,2)+'\n');
}catch(error){process.stderr.write((error instanceof Error?error.message:String(error))+'\n');code=1;}
finally{await host.dispose();}
process.exit(code);
