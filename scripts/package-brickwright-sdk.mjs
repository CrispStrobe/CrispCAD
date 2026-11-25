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
// Host bundlers parse sdk.js as ES2020; only worker chunks may use newer syntax (top-level await).
{const {transform}=await import('esbuild');await transform(await readFile(join(out,'sdk.js'),'utf8'),{format:'esm',target:'es2020',loader:'js'});}
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
