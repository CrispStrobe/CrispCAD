// SPDX-License-Identifier: BSD-3-Clause
import {mkdir,mkdtemp,rename,rm,access} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
if(process.platform!=='darwin')throw Error('The native macOS app requires macOS');
const source=resolve('apps/macos/build/CrispCAD.app'),apps=join(homedir(),'Applications'),target=join(apps,'CrispCAD.app');
// Same bundle identifier before the 2026-11-24 rename: retire the old bundle so only one app remains.
const legacy=join(apps,'Brickwright CAD.app');
const run=(command,args)=>execFileSync(command,args,{encoding:'utf8',stdio:['ignore','pipe','pipe']});
run('codesign',['--verify','--deep','--strict',source]);
await mkdir(apps,{recursive:true});const scratch=await mkdtemp(join(apps,'.brickwright-cad-')),staged=join(scratch,'new.app'),previous=join(scratch,'previous.app');
let replaced=false;
try{
 run('ditto',[source,staged]);run('codesign',['--verify','--deep','--strict',staged]);
 // Ask Cocoa to terminate normally. The app's quit hook flushes its journal;
 // never force-quit or replace a bundle while its process is still running.
 run('xcrun',['swift','-e','import AppKit; MainActor.assumeIsolated { for app in NSWorkspace.shared.runningApplications where app.bundleIdentifier == "com.crispstrobe.brickwrightcad.macos" { _ = app.terminate() } }']);
 const running=()=>run('ps',['-axo','command=']).split('\n').some(line=>[join(target,'Contents/MacOS/CrispCAD'),join(legacy,'Contents/MacOS/BrickwrightCAD')].includes(line.trim()));
 const deadline=Date.now()+20000;while(running()&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,200));
 if(running())throw Error('The app did not finish quitting; the existing installation was left intact. Finish any open save/error dialog and retry.');
 try{await access(target);await rename(target,previous);}catch(error){if(error.code!=='ENOENT')throw error;}
 await rename(staged,target);replaced=true;try{await rename(legacy,join(scratch,'legacy.app'));}catch(error){if(error.code!=='ENOENT')throw error;}run('codesign',['--verify','--deep','--strict',target]);run('open',[target]);
 let ready=false;for(let attempt=0;attempt<50;attempt++){try{const response=await fetch('http://127.0.0.1:4318/',{signal:AbortSignal.timeout(500)});if(response.ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,200));}
 if(!ready)throw Error('The installed app did not start its local asset server');
 console.log(`Installed and launched ${target}. Existing projects and histories are retained.`);
 await rm(scratch,{recursive:true,force:true});
}catch(error){
 if(!replaced){try{await access(previous);await rename(previous,target);run('open',[target]);}catch{}}
 throw error;
}
