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
// One build receipt shared by browser/native hosts. Native bundle numbers are
// reported independently by the native bridge, not guessed from package.json.
const {execFileSync}=await import('node:child_process');
let commit=null,dirty=null;try{commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();dirty=!!execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim();}catch{}
const manifest=JSON.parse(await readFile('package.json','utf8'));
await writeFile('apps/standalone/public/cad-assets/build-info.json',JSON.stringify({version:manifest.version,commit,dirty,builtAt:new Date().toISOString()},null,2));
await copyFile('LICENSE','apps/standalone/public/cad-assets/app-license.txt');
let complete=await readFile('apps/standalone/public/cad-assets/notices.txt','utf8');
for(const packageName of ['core','geometry','editor','history','physics','brickwright'])complete+=`\n\n--- @brickwright/cad-${packageName} ---\n\n${await readFile(`packages/${packageName}/NOTICE.md`,'utf8')}`;
complete+='\n\n--- ion-ios-filesystem 2.0.1 (native Filesystem dependency) ---\n\n'+await readFile('third-party/ion-ios-filesystem/LICENSE','utf8');
await writeFile('apps/standalone/public/cad-assets/notices.txt',complete);
