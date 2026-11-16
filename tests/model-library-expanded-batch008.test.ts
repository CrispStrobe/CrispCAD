// SPDX-License-Identifier: BSD-3-Clause
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {beforeAll,expect,it} from 'vitest';
import {createCadSession,createLocalModelLibraryCatalogue} from '@brickwright/cad-core';
import {createGeometryKernel,insertModelLibrarySTL} from '@brickwright/cad-geometry';
import {readSelectedLDrawFiles} from '../scripts/lib/ldraw-source-files.mjs';
import {bundledAssetLicenceTexts} from '../apps/shared/model-library-files.js';
const read=(path:string)=>readFileSync('library/'+path),hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const sourceCommit='543f6dd60336243fc3d36f7c1af1f238b2a4b79b';
const spec=JSON.parse(read('ldraw-reviewed-batch-spec.json').toString());
const entries=spec.roots.filter((r:any)=>r.asset.sourceRevision.commit===sourceCommit);
const manifest=JSON.parse(read('ldraw-reviewed-batch-manifest.json').toString()),catalogue=createLocalModelLibraryCatalogue(manifest);
let kernel:Awaited<ReturnType<typeof createGeometryKernel>>;
beforeAll(async()=>{expect(entries).toHaveLength(7);kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});});
it.each(entries)('$rootPath retains exact source/grants/mesh, real editor provenance/history and substitution refusal',async(entry:any)=>{
 const asset=entry.asset,canonical=catalogue.assets.find(a=>a.id===asset.id)!,files=await readSelectedLDrawFiles(entry,async(path:string)=>read(path));
 expect(files.length).toBe(entry.files.length);expect(files.reduce((n:number,f:any)=>n+f.bytes.length,0)).toBeLessThanOrEqual(32768);expect(hash(files.find((f:any)=>f.path===entry.rootPath)!.bytes)).toBe(asset.original.sha256);expect(asset.author.length).toBeGreaterThan(0);expect(asset.licence.spdx).toBe('CC-BY-4.0');expect(asset.sourceRevision.commit).toBe(sourceCommit);expect(asset.quality.closedPositiveVolume).toBe(true);
 const notices=Object.fromEntries(asset.licence.localEvidence.map((f:any)=>{const bytes=read(f.path);expect(hash(bytes)).toBe(f.sha256);expect(bytes.length).toBe(f.bytes);return ['../../library/'+f.path,bytes.toString()];}));expect(bundledAssetLicenceTexts([asset],notices).get(asset.id)).toBe(asset.licence.localEvidence.map((f:any)=>read(f.path).toString()).join('\n\n'));
 const mesh=new Uint8Array(read(asset.derivatives[0].path));expect(mesh.length).toBe(asset.derivatives[0].bytes);expect(hash(mesh)).toBe(entry.expectedMeshSha256);const session=createCadSession();
 try{
  session.rename('Retained redo');const renamed=session.serialize();session.undo();const before=session.serialize(),wrong=mesh.slice();wrong[100]^=1;let calls=0;
  await expect(insertModelLibrarySTL(session,catalogue,{assetId:asset.id,file:{derivative:0}},wrong,{evaluate:doc=>{calls++;return kernel.evaluate(doc);},toMillimetresZUp:asset.quality.screeningPolicy.toMillimetresZUp,checkedOn:'2026-11-16',modificationNotes:'Source-bound byte mismatch refusal'})).rejects.toThrow('SHA-256 mismatch');expect(calls).toBe(0);expect(session.serialize()).toBe(before);session.redo();expect(session.serialize()).toBe(renamed);session.undo();
  await insertModelLibrarySTL(session,catalogue,{assetId:asset.id,file:{derivative:0}},mesh,{evaluate:kernel.evaluate,toMillimetresZUp:asset.quality.screeningPolicy.toMillimetresZUp,checkedOn:'2026-11-16',modificationNotes:'Unchanged authored original derivative; retained native output; no manual edits'});
  const saved=session.serialize(),record=session.state.document.provenance!.records.at(-1)!;expect(record.asset).toEqual(canonical);expect(record.selectedFile).toEqual(canonical.derivatives[0]);const restored=createCadSession(JSON.parse(saved));try{expect(restored.serialize()).toBe(saved);expect(kernel.evaluate(restored.state.document).volume).toBeGreaterThan(0);}finally{restored.dispose();}session.undo();expect(session.serialize()).toBe(before);session.redo();expect(session.serialize()).toBe(saved);
 }finally{session.dispose();}
});
