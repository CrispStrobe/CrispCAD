// SPDX-License-Identifier: BSD-3-Clause
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {createCadSession,createLocalModelLibraryCatalogue} from '@brickwright/cad-core';
import {createGeometryKernel,insertModelLibrarySTL} from '@brickwright/cad-geometry';
import {readSelectedLDrawFiles} from '../scripts/lib/ldraw-source-files.mjs';
import {bundledAssetLicenceTexts} from '../apps/shared/model-library-files.js';
const read=(path:string)=>readFileSync('library/'+path),hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const spec=JSON.parse(read('ldraw-reviewed-batch-spec.json').toString()),entry=spec.roots.find((r:any)=>r.rootPath==='parts/t1098.dat'),asset=entry.asset;
it('binds all twelve unchanged originals, exact grant texts and the native-passed derivative',async()=>{
 const files=await readSelectedLDrawFiles(entry,async(path:string)=>read(path));expect(files).toHaveLength(12);expect(files.reduce((n:number,f:any)=>n+f.bytes.length,0)).toBe(11867);expect(hash(files[0].bytes)).toBe('63d413c323a3b1245396803c768a40ab6c6d64db4a4f19462ca9794c27c0534c');expect(asset.author).toBe('Philippe Hurbain [Philo]');
 expect(asset.sourceRevision.commit).toBe('5abbbfc91a6d73ba1e018a60ebb6d0557e5743fc');expect(hash(read(asset.derivatives[0].path))).toBe('5e5dd81728aa6b55ad80fc217564d8a6e3f0978bf094fedb6d64c579168b442d');expect(asset.quality.closedPositiveVolume).toBe(true);
 const notices=Object.fromEntries(asset.licence.localEvidence.map((f:any)=>{const bytes=read(f.path);expect(hash(bytes)).toBe(f.sha256);expect(bytes.length).toBe(f.bytes);return ['../../library/'+f.path,bytes.toString()];}));expect(bundledAssetLicenceTexts([asset],notices).get(asset.id)).toBe(asset.licence.localEvidence.map((f:any)=>read(f.path).toString()).join('\n\n'));
});
it('refuses path escape and colliding declared sources before reading the filesystem',async()=>{
 for(const kind of ['escape','collision']){const bad=structuredClone(entry);if(kind==='escape')bad.asset.original.path='sources/../../outside.dat';else bad.asset.sourceBundle.dependencies[0].path=bad.rootPath;let reads=0;await expect(readSelectedLDrawFiles(bad,async()=>{reads++;throw Error('Must not read');})).rejects.toThrow(kind==='escape'?'Invalid local LDraw source path':'Duplicate LDraw source binding');expect(reads).toBe(0);}
});
it('refuses substituted local source bytes instead of falling back to another part library',async()=>{
 await expect(readSelectedLDrawFiles(entry,async(path:string)=>{const b=Buffer.from(read(path));if(path===asset.original.path)b[0]^=1;return b;})).rejects.toThrow('Source/grant identity mismatch');
});
it('preserves real mesh insertion, provenance, restore, undo and redo; bad mesh bytes never evaluate',async()=>{
 const catalogue=createLocalModelLibraryCatalogue({format:'brickwright-local-fixture-library',version:1,pathBase:'library/',assets:[asset]}),canonical=catalogue.assets[0],kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')}),session=createCadSession(),mesh=new Uint8Array(read(asset.derivatives[0].path));
 try{session.rename('Retained redo');const renamed=session.serialize();session.undo();const before=session.serialize(),wrong=mesh.slice();wrong[100]^=1;let calls=0;
 await expect(insertModelLibrarySTL(session,catalogue,{assetId:asset.id,file:{derivative:0}},wrong,{evaluate:doc=>{calls++;return kernel.evaluate(doc);},toMillimetresZUp:asset.quality.screeningPolicy.toMillimetresZUp,checkedOn:'2026-11-15',modificationNotes:'Mismatch refusal control'})).rejects.toThrow('SHA-256 mismatch');expect(calls).toBe(0);expect(session.serialize()).toBe(before);session.redo();expect(session.serialize()).toBe(renamed);session.undo();
 await insertModelLibrarySTL(session,catalogue,{assetId:asset.id,file:{derivative:0}},mesh,{evaluate:kernel.evaluate,toMillimetresZUp:asset.quality.screeningPolicy.toMillimetresZUp,checkedOn:'2026-11-15',modificationNotes:'Unchanged authored original derivative; no manual changes'});const saved=session.serialize(),record=session.state.document.provenance!.records.at(-1)!;expect(record.asset).toEqual(canonical);expect(record.selectedFile).toEqual(canonical.derivatives[0]);const restored=createCadSession(JSON.parse(saved));try{expect(restored.serialize()).toBe(saved);expect(kernel.evaluate(restored.state.document).volume).toBeGreaterThan(0);}finally{restored.dispose();}session.undo();expect(session.serialize()).toBe(before);session.redo();expect(session.serialize()).toBe(saved);
 }finally{session.dispose();}
});
