// SPDX-License-Identifier: BSD-3-Clause
import {sha256Hex} from '@brickwright/cad-core';
import type {ModelLibraryFileCache} from '@brickwright/cad-core';

/** Original, unconverted files grouped by upstream folder. */
export interface ModelLibraryArchiveFile {path:string; bytes:number; sha256:string; format:string; units:'unknown'}
export interface ModelLibraryArchive {title:string; commit:string; upstreamCommit:string; baseUrl:string; licence:string; licenceUrl:string; folders:{name:string; files:ModelLibraryArchiveFile[]}[]}

/** Fetch exactly one original, enforcing its size and identity even on cache hits. */
export async function fetchArchiveFile(archive:ModelLibraryArchive,file:ModelLibraryArchiveFile,cache:ModelLibraryFileCache,fetcher:typeof fetch=globalThis.fetch,offline=false,signal?:AbortSignal):Promise<Uint8Array>{
 if(!archive.folders.some(folder=>folder.files.includes(file)))throw new Error('Unknown archive file.');
 if(!Number.isSafeInteger(file.bytes)||file.bytes<0||file.bytes>64*1024*1024||!/^[a-f0-9]{64}$/.test(file.sha256))throw new Error('Invalid archive file identity.');
 const valid=async(bytes:Uint8Array)=>bytes.length===file.bytes&&await sha256Hex(bytes)===file.sha256;
 let cached:Uint8Array|undefined;try{cached=await cache.read(file.sha256,file.bytes);}catch{/* unavailable cache */}
 signal?.throwIfAborted();
 if(cached&&await valid(cached))return cached.slice();
 if(cached)try{await cache.remove(file.sha256);}catch{/* future reads are verified */}
 if(offline)throw new Error('Verified file is unavailable offline.');
 const url=archive.baseUrl+file.path.split('/').map(encodeURIComponent).join('/');
 const parsed=new URL(url);if(parsed.protocol!=='https:'||parsed.username||parsed.password)throw new Error('Invalid archive URL.');
 const response=await fetcher(url,{credentials:'omit',mode:'cors',redirect:'error',cache:'no-store',signal});
 if(!response.ok||!response.body)throw new Error('Archive download failed.');
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let length=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>file.bytes)throw new Error('Archive file exceeds declared size.');chunks.push(value);}}catch(error){void reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 signal?.throwIfAborted();if(!await valid(bytes))throw new Error('Archive file size or SHA-256 mismatch.');
 try{await cache.write(file.sha256,bytes.slice());}catch{/* verified download is still available */}
 return bytes;
}

/** Default browser cache for embedded editors; hosts may supply their own adapter. */
export function createArchiveBrowserCache():ModelLibraryFileCache {
 const key=(hash:string)=>`https://brickwright.invalid/model-library/sha256/${hash}`;
 const open=()=>{if(!globalThis.caches)throw new Error('Browser storage unavailable.');return caches.open('brickwright-model-library-files-v1');};
 return {
  async read(hash,maxBytes){const response=await(await open()).match(key(hash));if(!response?.body)return undefined;const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>maxBytes)throw new Error('Cached file exceeds declared size.');chunks.push(value);}}catch(e){void reader.cancel().catch(()=>{});throw e;}finally{reader.releaseLock();}const result=new Uint8Array(size);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}return result;},
  async write(hash,bytes){await(await open()).put(key(hash),new Response(bytes.slice() as BodyInit));},
  async remove(hash){await(await open()).delete(key(hash));},
 };
}

/** Screen a user-declared STL conversion and construct its provenance snapshot. */
export async function screenArchiveSTL(archive:ModelLibraryArchive,folder:ModelLibraryArchive['folders'][number],file:ModelLibraryArchiveFile,bytes:Uint8Array,units:'mm'|'in',axis:'Y'|'Z',checkedOn:string) {
 const {checkModelLibrarySTL,MODEL_LIBRARY_MESH_MAX_BYTES}=await import('@brickwright/cad-geometry');
 if(!folder.files.includes(file)||!archive.folders.includes(folder)||!file.path.toLowerCase().endsWith('.stl'))throw new Error('Select an original STL.');
 if(file.bytes>MODEL_LIBRARY_MESH_MAX_BYTES||bytes.length!==file.bytes||await sha256Hex(bytes)!==file.sha256)throw new Error('STL exceeds the analysis limit or does not match its identity.');
 if(!['mm','in'].includes(units)||!['Y','Z'].includes(axis))throw new Error('Choose source units and up axis.');
 const scale=units==='mm'?1:25.4;
 const matrix=axis==='Z'?[scale,0,0,0,0,scale,0,0,0,0,scale,0,0,0,0,1]:[scale,0,0,0,0,0,scale,0,0,-scale,0,0,0,0,0,1];
 const screened=await checkModelLibrarySTL(bytes,{toMillimetresZUp:matrix,checkedOn});
 if(!screened.quality||!Object.values(screened.checks).every(check=>check==='pass'))throw new Error(`STL failed quality screening. ${screened.diagnostics.join(' ')}`);
 const url=archive.baseUrl+file.path.split('/').map(encodeURIComponent).join('/');
 const assumption=`User selected ${units} and ${axis} up; STL does not establish its own units or orientation.`;
 const id=`adafruit-${file.sha256.slice(0,32)}`;
 const catalogue={format:'brickwright-model-library' as const,version:1 as const,assets:[{id,version:archive.upstreamCommit,title:folder.name,author:'Adafruit Industries',sourceUrl:url,sourceRevision:{repositoryUrl:'https://github.com/adafruit/Adafruit_CAD_Parts',commit:archive.upstreamCommit},licence:{spdx:'MIT' as const,scope:'asset' as const,attribution:`Adafruit Industries. ${archive.licence.replace(/\s+/g,' ').trim()}`,evidenceUrl:archive.licenceUrl,capturedOn:'2026-11-15',review:'accepted' as const,reviewer:'Adafruit root licence review'},original:{url,format:'stl',sha256:file.sha256,bytes:file.bytes},derivatives:[],modificationNotes:'Original Adafruit STL; screened on demand without repair.',conversion:{sourceUnits:units,unitAssumption:assumption,sourceUpAxis:axis,toMillimetresZUp:matrix},quality:screened.quality}]};
 return {catalogue,id,matrix,assumption};
}
