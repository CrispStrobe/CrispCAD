// SPDX-License-Identifier: BSD-3-Clause
// Bundle source-bound thumbnails from an immutable media revision; no runtime download.
import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const [repo,commit]=process.argv.slice(2);
if(!repo||!/^[a-f0-9]{40}$/.test(commit??''))throw Error('Provide media checkout and full commit');
const show=path=>execFileSync('git',['-C',repo,'show',`${commit}:${path}`],{maxBuffer:8*1024*1024});
const archive=JSON.parse((await readFile('packages/editor/src/adafruit-archive-data.ts','utf8')).split('export const adafruitArchive:ModelLibraryArchive=')[1].trim().replace(/;$/,''));
const manifestPath='projects/adafruit-thumbnails/manifest.json',manifest=JSON.parse(show(manifestPath));
if(manifest.version!==1||manifest.upstreamCommit!==archive.upstreamCommit||manifest.archiveCommit!==archive.commit||manifest.entries.length!==482||manifest.failures.length)throw Error('Unexpected thumbnail manifest');
const previews={};
for(const entry of manifest.entries){
 const folder=archive.folders.find(f=>f.name===entry.folder),source=folder?.files.find(f=>f.path===entry.source.path);
 if(!source||source.bytes!==entry.source.bytes||source.sha256!==entry.source.sha256||source.format!==entry.source.format||Object.hasOwn(previews,entry.folder))throw Error('Thumbnail source mismatch: '+entry.folder);
 const image=entry.image;if(image.format!=='png'||!image.path.startsWith('projects/adafruit-thumbnails/images/')||image.path.includes('..')||image.bytes>131072)throw Error('Invalid thumbnail identity');
 const bytes=show(image.path);
 if(bytes.length!==image.bytes||createHash('sha256').update(bytes).digest('hex')!==image.sha256||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||bytes.readUInt32BE(16)!==256||bytes.readUInt32BE(20)!==192)throw Error('Thumbnail bytes mismatch: '+entry.folder);
 previews[entry.folder]='data:image/png;base64,'+bytes.toString('base64');
}
if(archive.folders.some(f=>f.name!=='Adafruit archive files'&&!previews[f.name]))throw Error('Missing component preview');
await writeFile('packages/editor/src/adafruit-preview-data.json',JSON.stringify({mediaCommit:commit,upstreamCommit:archive.upstreamCommit,archiveCommit:archive.commit,previews})+'\n');
await writeFile('library/adafruit-thumbnail-manifest.json',JSON.stringify({...manifest,mediaCommit:commit,manifestPath},null,2)+'\n');
console.log('Verified and bundled 482 Adafruit thumbnails from '+commit);
