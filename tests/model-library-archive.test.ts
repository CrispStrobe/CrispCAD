// SPDX-License-Identifier: BSD-3-Clause
import {describe,it,expect,vi} from 'vitest';
import {sha256Hex,validateModelLibraryCatalogue,createCadSession} from '@brickwright/cad-core';
import {fetchArchiveFile,screenArchiveSTL} from '../packages/editor/src/model-library-archive.js';
import {adafruitArchive} from '../packages/editor/src/adafruit-archive-data.js';
import {createGeometryKernel,insertModelLibrarySTL} from '@brickwright/cad-geometry';
import {readFileSync} from 'node:fs';
import type {ModelLibraryArchive} from '../packages/editor/src/model-library-archive.js';

describe('original archive retrieval',()=>{
 it('verifies selected bytes, reuses cache offline and refuses corrupt or oversized replies',async()=>{
  const bytes=new TextEncoder().encode('original'),sha256=await sha256Hex(bytes);
  const file={path:'folder/name +.step',bytes:bytes.length,sha256,format:'step',units:'unknown' as const};
  const archive:ModelLibraryArchive={title:'archive',commit:'1',upstreamCommit:'2',baseUrl:'https://example.com/',licence:'MIT',licenceUrl:'https://example.com/LICENSE',folders:[{name:'folder',files:[file]}]};
  const entries=new Map<string,Uint8Array>();const cache={read:async(h:string)=>entries.get(h),write:async(h:string,b:Uint8Array)=>{entries.set(h,b);},remove:async(h:string)=>{entries.delete(h);}};
  const fetcher=vi.fn(async()=>new Response(bytes));
  expect(await fetchArchiveFile(archive,file,cache,fetcher as typeof fetch)).toEqual(bytes);
  expect(fetcher.mock.calls[0][0]).toBe('https://example.com/folder/name%20%2B.step');
  expect(await fetchArchiveFile(archive,file,cache,fetcher as typeof fetch,true)).toEqual(bytes);
  expect(fetcher).toHaveBeenCalledTimes(1);
  entries.set(sha256,new TextEncoder().encode('corrupt!'));
  await expect(fetchArchiveFile(archive,file,cache,fetcher as typeof fetch,true)).rejects.toThrow('unavailable offline');
  await expect(fetchArchiveFile(archive,file,cache,async()=>new Response('wrong'))).rejects.toThrow('SHA-256 mismatch');
  await expect(fetchArchiveFile(archive,file,cache,async()=>new Response('too long for original'))).rejects.toThrow('exceeds declared size');
  await expect(fetchArchiveFile(archive,{...file},cache,fetcher as typeof fetch)).rejects.toThrow('Unknown archive file');
 });
 it('screens STL with explicit units and retains source identity and conversion',async()=>{
  const points=[[0,0,0],[1,0,0],[0,1,0],[0,0,1]],faces=[[0,2,1],[0,1,3],[0,3,2],[1,2,3]];
  const bytes=new TextEncoder().encode(`solid test\n${faces.map(face=>`facet normal 0 0 0\nouter loop\n${face.map(i=>`vertex ${points[i].join(' ')}`).join('\n')}\nendloop\nendfacet`).join('\n')}\nendsolid test`);
  const file={path:'part/example.stl',bytes:bytes.length,sha256:await sha256Hex(bytes),format:'stl',units:'unknown' as const};
  const folder={name:'Part',files:[file]},archive:ModelLibraryArchive={title:'archive',commit:'1'.repeat(40),upstreamCommit:'2'.repeat(40),baseUrl:'https://example.com/',licence:'MIT notice',licenceUrl:'https://example.com/LICENSE',folders:[folder]};
  const result=await screenArchiveSTL(archive,folder,file,bytes,'in','Y','2026-11-15');
  expect(validateModelLibraryCatalogue(result.catalogue).valid).toBe(true);
  expect(result.matrix).toEqual([25.4,0,0,0,0,0,25.4,0,0,-25.4,0,0,0,0,0,1]);
  expect(result.catalogue.assets[0].conversion.unitAssumption).toContain('User selected in and Y up');
  const kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')}),session=createCadSession();
  const before=session.serialize();await insertModelLibrarySTL(session,result.catalogue,{assetId:result.id,file:'original'},bytes,{evaluate:kernel.evaluate,toMillimetresZUp:result.matrix,checkedOn:'2026-11-15',modificationNotes:result.assumption});
  expect(session.state.document.provenance?.records[0].asset.conversion.unitAssumption).toBe(result.assumption);
  const inserted=session.serialize();session.undo();expect(session.serialize()).toBe(before);session.redo();expect(session.serialize()).toBe(inserted);
  await expect(screenArchiveSTL(archive,folder,file,new Uint8Array(bytes.length),'mm','Z','2026-11-15')).rejects.toThrow('identity');
 });

});

it('indexes every original file once under the exact mirrored revision',()=>{
 const files=adafruitArchive.folders.flatMap(folder=>folder.files);
 expect(adafruitArchive.upstreamCommit).toBe('9f2a89f3d5c3491886d58cb7fe83385417563cf4');
 expect(adafruitArchive.commit).toMatch(/^[a-f0-9]{40}$/);
 expect(adafruitArchive.baseUrl).toContain(`/${adafruitArchive.commit}/`);
 expect(adafruitArchive.folders).toHaveLength(483);expect(files).toHaveLength(1825);
 expect(new Set(files.map(file=>file.path)).size).toBe(files.length);
 expect(files.every(file=>/^[a-f0-9]{64}$/.test(file.sha256)&&file.bytes>0&&file.bytes<=64*1024*1024&&file.units==='unknown')).toBe(true);
});
