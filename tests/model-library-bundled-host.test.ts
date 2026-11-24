// SPDX-License-Identifier: BSD-3-Clause
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import {createCadSession,createLocalModelLibraryCatalogue} from '@brickwright/cad-core';
import {insertModelLibrarySource} from '@brickwright/cad-geometry';
import {bundledSourceFiles,bundledAssetLicenceTexts,bundledLibraryFiles} from '../apps/shared/model-library-files.js';
const read=(path:string)=>readFileSync('library/'+path),manifest=JSON.parse(read('editor-corpus-manifest.json').toString()),asset=manifest.assets.find((a:any)=>a.id==='corpus-smooth-prim-authored-default'),mit=manifest.assets.find((a:any)=>a.id==='corpus-angelo-beam-h');
const documentMap=()=>Object.fromEntries([asset,mit].flatMap(a=>a.licence.localEvidence.map((e:any)=>['../../library/'+e.path,read(e.path).toString()])));
it('checks bundled availability without decoding and reads only the requested file',()=>{
 const decode=vi.spyOn(globalThis,'atob');
 try{
  const files=bundledLibraryFiles({'../../library/sources/one.cad':'box(1, 1, 1)'},{
   '../../library/meshes/one.stl':'data:application/octet-stream;base64,AAEC',
   '../../library/meshes/two.stl':'data:application/octet-stream;base64,AwQF',
  });
  expect(files.has('meshes/two.stl')).toBe(true);
  expect(files.get('missing')).toBeUndefined();
  expect(files.get('sources/one.cad')).toEqual(new TextEncoder().encode('box(1, 1, 1)'));
  expect(decode).not.toHaveBeenCalled();
  expect(files.get('meshes/two.stl')).toEqual(new Uint8Array([3,4,5]));
  expect(decode).toHaveBeenCalledExactlyOnceWith('AwQF');
 }finally{decode.mockRestore();}
});
it('binds a reviewed source in a new family directory and its own CC0 notice, independently of the MIT collection',()=>{
 const files=bundledSourceFiles({['../../library/'+asset.original.path]:read(asset.original.path).toString()}),source=files.get(asset.original.path)!;
 expect(source).toEqual(new Uint8Array(read(asset.original.path)));expect(createHash('sha256').update(source).digest('hex')).toBe(asset.original.sha256);
 const notices=bundledAssetLicenceTexts([asset,mit],documentMap());expect(notices.get(asset.id)).toBe(read(asset.licence.localEvidence[0].path).toString());expect(notices.get(asset.id)).toContain('CC0 1.0 Universal');expect(notices.get(asset.id)).not.toContain('Angelo_Nicoli');expect(notices.get(mit.id)).toContain('MIT License');
});
it('refuses missing or substituted declared notices instead of falling back to another family notice',()=>{
 const wrong=documentMap();delete wrong['../../library/'+asset.licence.localEvidence[0].path];expect(()=>bundledAssetLicenceTexts([asset],wrong)).toThrow('Missing or changed bundled licence evidence');
 wrong['../../library/'+asset.licence.localEvidence[0].path]=read(mit.licence.localEvidence[0].path).toString();expect(()=>bundledAssetLicenceTexts([asset],wrong)).toThrow('Missing or changed bundled licence evidence');
});
it('measures a shared notice once and checks every asset against its declared length',()=>{
 const documentMapForAsset=Object.fromEntries(asset.licence.localEvidence.map((e:any)=>['../../library/'+e.path,read(e.path).toString()]));
 const encode=vi.spyOn(TextEncoder.prototype,'encode');
 try{
  const copied={...asset,id:'same-notice'};
  const checked=bundledAssetLicenceTexts([asset,copied],documentMapForAsset);
  expect(checked.get(copied.id)).toBe(checked.get(asset.id));
  expect(encode).toHaveBeenCalledTimes(asset.licence.localEvidence.length);
  const wrong={...copied,licence:{...copied.licence,localEvidence:copied.licence.localEvidence.map((e:any)=>({...e,bytes:e.bytes+1}))}};
  expect(()=>bundledAssetLicenceTexts([asset,wrong],documentMapForAsset)).toThrow('Missing or changed bundled licence evidence');
 }finally{encode.mockRestore();}
});
it('keeps tampered bundled source refusal before evaluation, preserving the document and redo history',async()=>{
 const files=bundledSourceFiles({['../../library/'+asset.original.path]:read(asset.original.path).toString()}),bad=files.get(asset.original.path)!.slice();bad[0]^=1;const session=createCadSession();session.rename('Retained redo');const renamed=session.serialize();session.undo();const before=session.serialize();let calls=0;
 try{await expect(insertModelLibrarySource(session,createLocalModelLibraryCatalogue(manifest),{assetId:asset.id,file:'original'},bad,{evaluate:async()=>{calls++;throw new Error('Must not evaluate');},modificationNotes:'Tamper refusal'})).rejects.toThrow('SHA-256 mismatch');expect(calls).toBe(0);expect(session.serialize()).toBe(before);session.redo();expect(session.serialize()).toBe(renamed);}finally{session.dispose();}
});

it('binds original manifest evidence before catalogue normalization drops extension metadata',()=>{
 const normalized=createLocalModelLibraryCatalogue(manifest).assets.find(a=>a.id===asset.id)!;
 expect((normalized.licence as any).localEvidence).toBeUndefined();
 const notices=bundledAssetLicenceTexts(manifest.assets, Object.fromEntries(manifest.assets.flatMap((a:any)=>a.licence.localEvidence.map((e:any)=>['../../library/'+e.path,read(e.path).toString()]))));
 expect(notices.get(normalized.id)).toBe(read(asset.licence.localEvidence[0].path).toString());
});
