// SPDX-License-Identifier: BSD-3-Clause
import {beforeAll,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createCadSession,sha256Hex} from '@brickwright/cad-core';
import {createGeometryKernel,exportSTL} from '@brickwright/cad-geometry';
import {insertModelLibrarySource} from '../packages/geometry/src/model-library-insert.js';
import {createBundledModelLibrary} from '../apps/standalone/src/model-library-local.js';
let kernel:Awaited<ReturnType<typeof createGeometryKernel>>;
beforeAll(async()=>{kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});});
it.each(['shaft-01','shaft-02-with-keyway'])('inserts unchanged %s offline with positive mesh, provenance and reversible history',async slug=>{
 const bundle=createBundledModelLibrary(),asset=bundle.catalogue.assets.find(a=>a.id==='corpus-angelo-'+slug)!;
 const manifest=JSON.parse(readFileSync('library/editor-corpus-manifest.json','utf8')),raw=manifest.assets.find((a:any)=>a.id===asset.id);
 const session=createCadSession(),before=session.serialize();
 try{
  await insertModelLibrarySource(session,bundle.catalogue,{assetId:asset.id,file:'original'},bundle.localFiles.get(asset.original.path!)!,{evaluate:kernel.evaluate,modificationNotes:'Unchanged authored shaft default.'});
  const evaluated=kernel.evaluate(session.state.document);
  expect(await sha256Hex(exportSTL(evaluated.bodies))).toBe(raw.derivatives[0].sha256);
  expect(evaluated.volume).toBeGreaterThan(0);
  if(slug==='shaft-01'){
   // Authored radial polygon: r15 for35mm, r15→20 for15mm, r20 for50mm.
   // Each circular slice is the source-default regular48-gon.
   const expected=48/2*Math.sin(2*Math.PI/48)*(15**2*35+(15**2+15*20+20**2)/3*15+20**2*50);
   expect(evaluated.volume).toBeCloseTo(expected,3);
  }
  const record=session.state.document.provenance!.records[0];expect(record.selectedFile).toEqual(asset.original);expect(record.asset.licence.attribution).toContain('Permission is hereby granted');
  const saved=session.serialize(),restored=createCadSession(JSON.parse(saved));try{expect(restored.serialize()).toBe(saved);}finally{restored.dispose();}
  session.undo();expect(session.serialize()).toBe(before);session.redo();expect(session.serialize()).toBe(saved);
 }finally{session.dispose();}
});
