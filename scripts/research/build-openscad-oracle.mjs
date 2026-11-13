// SPDX-License-Identifier: BSD-3-Clause
// Optional external dev tool. Sources/binaries stay in the selected research cache.
import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const args=process.argv.slice(2),i=args.indexOf('--cache'),cache=resolve(i<0?'/tmp/brickwright-scad-oracle':args[i+1]);const here=fileURLToPath(new URL('.',import.meta.url)),pins=JSON.parse(await readFile(join(here,'openscad-oracle-pins.json'),'utf8'));
const run=(cmd,args,capture=false)=>execFileSync(cmd,args,{encoding:'utf8',...(capture?{}:{stdio:'inherit'})});
await mkdir(join(cache,'upstream'),{recursive:true});
for(const [name,pin] of [['openscad-rs',pins.parser],['csgrs',pins.hyperreal]]){const path=join(cache,'upstream',name);let exists=true;try{await access(join(path,'.git'));}catch{exists=false;}if(!exists)run('git',['clone','--filter=blob:none',...(name==='csgrs'?['--sparse']:[]),'--no-checkout',pin.repository+'.git',path]);else{const origin=run('git',['-C',path,'remote','get-url','origin'],true).trim().replace(/\.git$/,'');if(origin!==pin.repository)throw Error(`Unexpected cached repository: ${path}`);if(run('git',['-C',path,'status','--porcelain'],true).trim())throw Error(`Cached source has local changes: ${path}`);}if(name==='csgrs')run('git',['-C',path,'sparse-checkout','set',pin.subdirectory]);try{run('git',['-C',path,'cat-file','-e',pin.revision],true);}catch{run('git',['-C',path,'fetch','origin',pin.revision]);}run('git',['-C',path,'checkout','--detach',pin.revision]);}
const harness=join(cache,'harness');await mkdir(join(harness,'src'),{recursive:true});const parser=join(cache,'upstream','openscad-rs');await writeFile(join(harness,'Cargo.toml'),`[package]\nname="brickwright-scad-syntax-oracle"\nversion="0.1.0"\nedition="2024"\nlicense="BSD-3-Clause"\n[dependencies]\nopenscad-rs={path=${JSON.stringify(parser)}}\nserde={version="=1.0.228",features=["derive"]}\nserde_json="=1.0.149"\n`);await writeFile(join(harness,'src','main.rs'),await readFile(join(here,'openscad-oracle.rs')));const lock=await readFile(join(here,'openscad-oracle.Cargo.lock'));await writeFile(join(harness,'Cargo.lock'),lock);
const target=join(cache,'target');execFileSync('cargo',['build','--release','--locked','--manifest-path',join(harness,'Cargo.toml')],{stdio:'inherit',env:{...process.env,CARGO_TARGET_DIR:target,CAD_OPENSCAD_RS_REV:pins.parser.revision,CAD_HYPERREAL_REV:pins.hyperreal.revision}});
console.log(JSON.stringify({binary:join(target,'release',`brickwright-scad-syntax-oracle${process.platform==='win32'?'.exe':''}`),pins,lockSha256:createHash('sha256').update(lock).digest('hex')}));
