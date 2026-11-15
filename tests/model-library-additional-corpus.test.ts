// SPDX-License-Identifier: BSD-3-Clause
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {createCadSession,createLocalModelLibraryCatalogue,createModelAttributionSidecar} from '@brickwright/cad-core';
import {createGeometryKernel,insertModelLibrarySTL} from '@brickwright/cad-geometry';
const read=(path:string)=>readFileSync('library/'+path),hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const manifest=JSON.parse(read('editor-corpus-manifest.json').toString());
const asset=manifest.assets.find((a:any)=>a.id==='corpus-smooth-prim-authored-default');
it('binds the authored CC0 default to its full unchanged source, notice and measured derivative',()=>{
 expect(asset.author).toBe('Ryan A. Colyer');expect(asset.sourceRevision.commit).toBe('0d0038f984465f3eb0f6026a4d5de2f79d2dcea8');expect(asset.original.bytes).toBe(8818);expect(asset.original.sha256).toBe('16de0aac3dc3cf8d357d52e1e2d333a2d0e11c21a59efb042bd4604fc341e8e0');expect(read(asset.original.path)).toEqual(read(asset.corpusSelection.archivedPath));expect(hash(read(asset.original.path))).toBe(asset.original.sha256);expect(read(asset.original.path).toString()).toContain('Demo();');
 expect(asset.licence.spdx).toBe('CC0-1.0');for(const grant of asset.licence.localEvidence){const bytes=read(grant.path);expect(bytes.length).toBe(grant.bytes);expect(hash(bytes)).toBe(grant.sha256);expect(bytes.toString()).toContain('CC0 1.0 Universal');}
 expect(asset.measurements.triangles).toBe(5220);expect(asset.quality.closedPositiveVolume).toBe(true);expect(hash(read(asset.derivatives[0].path))).toBe('4391dafaed2d22f011eb280d2c0124f658326f62babca82324e6da6391640d0d');
});
it('refuses mismatched local bytes before evaluation and retains real insertion/provenance/history',async()=>{
 const kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')}),session=createCadSession(),catalogue=createLocalModelLibraryCatalogue(manifest),mesh=new Uint8Array(read(asset.derivatives[0].path)),before=session.serialize(),identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
 try{
  const wrong=mesh.slice();wrong[100]^=1;let evaluations=0;
  await expect(insertModelLibrarySTL(session,catalogue,{assetId:asset.id,file:{derivative:0}},wrong,{evaluate:doc=>{evaluations++;return kernel.evaluate(doc);},toMillimetresZUp:identity,checkedOn:'2026-11-15',modificationNotes:'Mismatched-byte refusal control'})).rejects.toThrow('SHA-256 mismatch');expect(evaluations).toBe(0);expect(session.serialize()).toBe(before);
  await insertModelLibrarySTL(session,catalogue,{assetId:asset.id,file:{derivative:0}},mesh,{evaluate:kernel.evaluate,toMillimetresZUp:identity,checkedOn:'2026-11-15',modificationNotes:'Exact unchanged authored default STL inserted'});const saved=session.serialize();const restored=createCadSession(JSON.parse(saved));try{expect(restored.serialize()).toBe(saved);expect(kernel.evaluate(restored.state.document).volume).toBeGreaterThan(0);}finally{restored.dispose();}session.undo();expect(session.serialize()).toBe(before);session.redo();expect(session.serialize()).toBe(saved);const sidecar=await createModelAttributionSidecar(session.state.document,{filename:'smooth.stl',format:'stl',bytes:mesh,modificationNotes:'No manual model edits'});expect(sidecar.records[0].asset.original.sha256).toBe(asset.original.sha256);expect(sidecar.records[0].asset.licence.spdx).toBe('CC0-1.0');
 }finally{session.dispose();}
});
