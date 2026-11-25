// SPDX-License-Identifier: BSD-3-Clause
import {readFile,writeFile,copyFile,mkdir,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
const out='dist/brickwright-sdk';
await mkdir(join(out,'cad-assets'),{recursive:true});
await copyFile('node_modules/manifold-3d/manifold.wasm',join(out,'cad-assets/manifold.wasm'));
await copyFile('LICENSE',join(out,'LICENSE'));
// Preserve the same complete runtime notices as the standalone distribution.
await import('./copy-assets.mjs');
await copyFile('apps/standalone/public/cad-assets/notices.txt',join(out,'NOTICE.txt'));
// Host bundlers parse sdk.js and its chunks as ES2020; only worker chunks under assets/ may use
// newer syntax (the exact kernel's top-level await).
{const {transform}=await import('esbuild');for(const entry of await readdir(out))if(entry.endsWith('.js'))await transform(await readFile(join(out,entry),'utf8'),{format:'esm',target:'es2020',loader:'js'});}
// Vite's library mode inlines WebAssembly as base64 unless the build marks it (emitWasmFiles in
// scripts/exact-kernel-assets.js). Refuse any chunk that carries a WebAssembly payload, and require
// the exact kernel's WebAssembly as its own lazily fetched file under assets/exact/.
{
 const {findInlineWasm}=await import('./sdk-wasm-check.mjs');
 const {EXACT_ASSET_DIR}=await import('./exact-kernel-assets.js');
 const problems=[];
 async function scan(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const full=join(dir,entry.name);if(entry.isDirectory())await scan(full);else if(entry.name.endsWith('.js'))for(const hit of findInlineWasm(await readFile(full,'utf8')))problems.push(`${full}: ${hit}`);}}
 await scan(out);
 if(problems.length)throw new Error(`SDK chunks inline WebAssembly instead of emitting it as a file:\n${problems.join('\n')}`);
 const exactDir=join(out,EXACT_ASSET_DIR),exactFiles=await readdir(exactDir);
 const wasm=exactFiles.filter(name=>/^smlibwasm-.*\.wasm$/.test(name));
 if(wasm.length!==1)throw new Error(`Expected one smlibwasm-*.wasm under ${EXACT_ASSET_DIR}, found: ${wasm.join(', ')||'none'}`);
 let referenced=false;
 for(const name of exactFiles.filter(name=>name.endsWith('.js')))if((await readFile(join(exactDir,name),'utf8')).includes(`"${wasm[0]}"`))referenced=true;
 if(!referenced)throw new Error(`No exact chunk references ${wasm[0]} relative to itself`);
 for(const entry of await readdir(out))if(entry.endsWith('.js')&&(await readFile(join(out,entry),'utf8')).includes('smlibwasm'))throw new Error(`${entry} names the exact kernel's WebAssembly; it must load only inside the exact worker`);
}
const files={};
async function walk(dir,rel=''){
 for(const entry of await readdir(dir,{withFileTypes:true})){
  const file=join(rel,entry.name),full=join(dir,entry.name);
  if(entry.isDirectory())await walk(full,file);
  else if(file!=='manifest.json')files[file]=createHash('sha256').update(await readFile(full)).digest('hex');
 }
}
await walk(out);
await writeFile(join(out,'manifest.json'),JSON.stringify({format:'brickwright-cad-sdk',version:1,
 repository:'https://github.com/CrispStrobe/brickwright-cad',
 commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
 dirty:!!execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),
 entry:'sdk.js',wasm:'cad-assets/manifold.wasm',files},null,2)+'\n');
console.log(`Packaged browser SDK: ${Object.keys(files).length} files`);
