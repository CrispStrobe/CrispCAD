import { copyFile, mkdir } from 'node:fs/promises';
await mkdir('apps/standalone/public/cad-assets', { recursive: true });
await copyFile('node_modules/manifold-3d/manifold.wasm', 'apps/standalone/public/cad-assets/manifold.wasm');
// Native/offline users can inspect runtime notices without an internet connection.
const {readFile,writeFile}=await import('node:fs/promises');
let notices=await readFile('THIRD-PARTY-NOTICES.md','utf8');
for(const dependency of ['@noble/hashes','three','manifold-3d','fflate','@capacitor/core','@capacitor/filesystem','@capacitor/share']){
 for(const file of ['LICENSE','LICENSE.txt','LICENSE.md']){try{notices+=`\n\n--- ${dependency} ---\n\n${await readFile(`node_modules/${dependency}/${file}`,'utf8')}`;break;}catch{}}
}
await writeFile('apps/standalone/public/cad-assets/notices.txt',notices);
