// SPDX-License-Identifier: BSD-3-Clause
import {beforeAll,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createCadSession,createModelAttributionSidecar,sha256Hex} from '@brickwright/cad-core';
import {createGeometryKernel,exportSTL,checkModelLibrarySTL} from '@brickwright/cad-geometry';
import {insertModelLibrarySource} from '../packages/geometry/src/model-library-insert.js';
import {createBundledModelLibrary} from '../apps/standalone/src/model-library-local.js';
const manifest=JSON.parse(readFileSync('library/editor-corpus-manifest.json','utf8'));
const raw=manifest.assets.find((a:any)=>a.id==='corpus-angelo-coin-02');
let kernel:Awaited<ReturnType<typeof createGeometryKernel>>;
beforeAll(async()=>{kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});});
it('admits only the unchanged coin default while retaining all four measured outcomes',async()=>{
 const report=JSON.parse(readFileSync('library/corpus-audit/editor-screening-cycle20.json','utf8'));
 expect(report.summary).toEqual({sample:4,beforeQualified:0,afterQualified:1,afterLimited:1,afterUnsupported:1,afterTopologyFailed:1});
 expect(report.generatedListCohort.after.results.map((r:any)=>r.status)).toEqual(['limited','unsupported']);
 const source=readFileSync('library/'+raw.original.path);expect(source).toEqual(readFileSync('library/'+raw.corpusSelection.archivedPath));expect(await sha256Hex(source)).toBe(raw.original.sha256);
 expect(raw.modificationNotes).toContain('text center argument is ignored');expect(raw.modificationNotes).toContain('Droid Sans substitute');
 expect(raw.licence.attribution).toContain('Permission is hereby granted');
 const bytes=readFileSync('library/'+raw.derivatives[0].path);expect(await sha256Hex(bytes)).toBe(raw.derivatives[0].sha256);
 const checked=await checkModelLibrarySTL(bytes,{checkedOn:'2026-11-14',toMillimetresZUp:raw.conversion.toMillimetresZUp,maxTriangles:10000,maxExtentMm:200});expect(checked.triangles).toBe(3132);expect(Object.values(checked.checks)).toEqual(['pass','pass','pass','pass']);
 const old=JSON.parse(readFileSync('library/corpus-audit/editor-screening-cycle19.json','utf8'));expect(old.after.results.find((r:any)=>r.name==='ex5').status).toBe('limited');
});
it('inserts the coin offline with matching actual STL, attribution, serialization, sidecar and undo/redo',async()=>{
 const bundle=createBundledModelLibrary(),asset=bundle.catalogue.assets.find(a=>a.id===raw.id)!,session=createCadSession(),before=session.serialize();
 expect(bundle.catalogue.assets).toHaveLength(145);expect(bundle.catalogue.assets.some(a=>a.id==='corpus-scon-ex5')).toBe(false);
 try{
  await insertModelLibrarySource(session,bundle.catalogue,{assetId:asset.id,file:'original'},bundle.localFiles.get(asset.original.path!)!,{evaluate:kernel.evaluate,modificationNotes:'Unchanged authored coin defaults; warned ignored text center.'});
  const result=kernel.evaluate(session.state.document),mesh=exportSTL(result.bodies);expect(result.volume).toBeGreaterThan(0);expect(await sha256Hex(mesh)).toBe(raw.derivatives[0].sha256);
  expect(session.state.document.provenance!.records[0].selectedFile).toEqual(asset.original);
  const saved=session.serialize(),restored=createCadSession(JSON.parse(saved));try{expect(restored.serialize()).toBe(saved);}finally{restored.dispose();}
  const sidecar=await createModelAttributionSidecar(session.state.document,{filename:'coin.stl',format:'stl',bytes:mesh,modificationNotes:'Authored default.'});expect(sidecar.records[0].asset.licence.attribution).toContain('Permission is hereby granted');
  session.undo();expect(session.serialize()).toBe(before);session.redo();expect(session.serialize()).toBe(saved);
 }finally{session.dispose();}
});
