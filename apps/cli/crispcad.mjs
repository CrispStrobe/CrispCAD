#!/usr/bin/env node
// SPDX-License-Identifier: BSD-3-Clause
// Headless CLI over the shared command registry. It reuses the MCP host, so it
// has the same writer lock, validation, size limits and atomic history append.
import {resolve} from 'node:path';
import {t,setLocale} from '@brickwright/cad-core';
import {createCodeHost} from '../mcp/host.mjs';

const usage=()=>t('CrispCAD CLI\nnode apps/cli/crispcad.mjs commands\nnode apps/cli/crispcad.mjs run <project.bcad> "<command>" ["<command>" ...] [--dry-run]\nnode apps/cli/crispcad.mjs inspect|interference|printability <project.bcad>\nOptions: --locale en|de. Output is JSON on stdout.\n');
const argv=process.argv.slice(2),positional=[];let dryRun=false;
for(let i=0;i<argv.length;i++){
 if(argv[i]==='--locale'&&['en','de'].includes(argv[i+1]))setLocale(argv[++i]);
 else if(argv[i]==='--dry-run')dryRun=true;
 else if(argv[i]==='--help'||argv[i]==='-h'){process.stdout.write(usage());process.exit(0);}
 else if(argv[i].startsWith('--')){process.stderr.write(t`Unknown argument: ${argv[i]}\n`);process.exit(1);}
 else positional.push(argv[i]);
}
const [verb,project,...commands]=positional;
const tools={inspect:'cad_inspect',interference:'cad_check_interference',printability:'cad_check_printability'};
if(!verb||verb!=='commands'&&!project||verb==='run'&&!commands.length||!['commands','run',...Object.keys(tools)].includes(verb)){process.stderr.write(usage());process.exit(1);}
const host=await createCodeHost(verb==='commands'?{}:{project:resolve(project)});
let code=0;
try{
 let result;
 if(verb==='commands')result=await host.call('cad_list_commands',{});
 else if(verb==='run'){const {revision}=await host.call('cad_get_model');result=await host.call('cad_run_commands',{commands:commands.join('\n'),expectedRevision:revision,...(dryRun?{preview:true}:{})});}
 else result=await host.call(tools[verb],{});
 process.stdout.write(JSON.stringify(result,null,2)+'\n');
}catch(error){process.stderr.write((error instanceof Error?error.message:String(error))+'\n');code=1;}
finally{await host.dispose();}
process.exit(code);
