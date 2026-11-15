// SPDX-License-Identifier: BSD-3-Clause
// Generate the lightweight editor index from a verified media-lab mirror.
// Usage: node scripts/generate-adafruit-archive.mjs /path/to/media-lab MIRROR_COMMIT
import {writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const [repo,commit]=process.argv.slice(2);
if(!repo||!/^[a-f0-9]{40}$/.test(commit??''))throw Error('Provide media-lab checkout and full mirror commit.');
if(execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim()!==commit)throw Error('Mirror checkout does not match requested commit.');
const project='projects/adafruit-cad-parts/';
const show=path=>execFileSync('git',['show',`${commit}:${project}${path}`],{cwd:repo,encoding:'utf8',maxBuffer:16*1024*1024});
const manifest=JSON.parse(show('files.json'));
if(manifest.commit!=='9f2a89f3d5c3491886d58cb7fe83385417563cf4'||manifest.files.length!==1825)throw Error('Unexpected upstream identity or file count.');
const tree=execFileSync('git',['ls-tree','-rz','--full-tree',commit,'--',project+'original/'],{cwd:repo,maxBuffer:16*1024*1024}).toString().split('\0').filter(Boolean);
const objects=new Map(tree.map(entry=>{const match=/^\d+ blob ([a-f0-9]{40})\t([\s\S]+)$/.exec(entry);if(!match)throw Error('Invalid mirror tree entry.');return [match[2].slice((project+'original/').length),match[1]];}));
if(objects.size!==manifest.files.length||manifest.files.some(file=>objects.get(file.path)!==file.gitBlob))throw Error('Manifest and mirror tree do not match.');
const folders=new Map();
for(const f of manifest.files){
 if(!f.path||!Number.isSafeInteger(f.bytes)||f.bytes<=0||!/^[a-f0-9]{64}$/.test(f.sha256))throw Error('Invalid file identity.');
 const name=f.path.includes('/')?f.path.split('/')[0]:'Adafruit archive files';
 if(!folders.has(name))folders.set(name,[]);
 const filename=f.path.split('/').pop();const dot=filename.lastIndexOf('.');const format=dot>0?filename.slice(dot+1).toLowerCase():'unknown';
 folders.get(name).push({path:f.path,bytes:f.bytes,sha256:f.sha256,format,units:'unknown'});
}
const prefix=`https://raw.githubusercontent.com/CrispStrobe/brickwright-media-lab/${commit}/projects/adafruit-cad-parts/original/`;
const data={title:'Adafruit CAD Parts',commit,upstreamCommit:manifest.commit,baseUrl:prefix,licence:show('original/LICENSE'),licenceUrl:prefix+'LICENSE',folders:[...folders].map(([name,files])=>({name,files}))};
await writeFile('packages/editor/src/adafruit-archive-data.ts',`// SPDX-License-Identifier: BSD-3-Clause\n// Generated from the verified media mirror; see scripts/generate-adafruit-archive.mjs.\nimport type {ModelLibraryArchive} from './model-library-archive.js';\nexport const adafruitArchive:ModelLibraryArchive=${JSON.stringify(data)};\n`);
console.log(`${manifest.files.length} originals in ${data.folders.length} folders`);
