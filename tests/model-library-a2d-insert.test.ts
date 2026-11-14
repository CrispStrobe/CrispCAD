// SPDX-License-Identifier: BSD-3-Clause
import {beforeAll,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createCadSession,createModelAttributionSidecar,sha256Hex} from '@brickwright/cad-core';
import {createGeometryKernel,exportSTL} from '@brickwright/cad-geometry';
import {insertModelLibrarySource} from '../packages/geometry/src/model-library-insert.js';
import {createBundledModelLibrary} from '../apps/standalone/src/model-library-local.js';

const manifest=JSON.parse(readFileSync('library/a2d-editor-manifest.json','utf8'));
let kernel:Awaited<ReturnType<typeof createGeometryKernel>>;
beforeAll(async()=>{kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});});
it.each(manifest.assets)('inserts authored A2D root $id offline with dependency grants, sidecar and history',async(raw:any)=>{
 const bundled=createBundledModelLibrary(),asset=bundled.catalogue.assets.find(a=>a.id===raw.id)!;
 const source=bundled.localFiles.get(asset.original.path!)!,session=createCadSession(),before=session.serialize();
 try{
  expect(bundled.licenceTexts.get(asset.id)).toBe(readFileSync('library/evidence/a2d-MIT-LICENSE.txt','utf8'));
  await insertModelLibrarySource(session,bundled.catalogue,{assetId:asset.id,file:'original'},source,{sourceFiles:bundled.localFiles,evaluate:kernel.evaluate,modificationNotes:'Authored defaults and source units preserved.'});
  const evaluated=kernel.evaluate(session.state.document);expect(evaluated.volume).toBeGreaterThan(0);expect(await sha256Hex(exportSTL(evaluated.bodies))).toBe(raw.derivatives[0].sha256);
  const record=session.state.document.provenance!.records[0];expect(record.selectedFile).toEqual(asset.original);expect(record.asset.sourceBundle).toEqual(asset.sourceBundle);
  const dependency=record.asset.sourceBundle!.dependencies[0];expect(dependency.sourceRevision.commit).toBe(raw.version);expect(dependency.file.sha256).toBe(raw.sourceBundle.dependencies[0].file.sha256);
  expect(dependency.licence.attribution).toContain('Michal');expect(dependency.licence.attribution).toContain('Permission is hereby granted');
  const saved=session.serialize();
  if(raw.id==='corpus-a2d-grill-circle'){
   const node=session.state.document.nodes[session.state.selection[0]];if(node.kind!=='code')throw Error('Expected code');
   expect(node.program.source).toContain('const cadExpression');
   const wider=structuredClone(node.program);wider.parameters.outer_size='84';session.updateCode(node.id,wider);
   expect(kernel.evaluate(session.state.document).bodies[0].bounds.max[0]).toBeCloseTo(42);
   session.undo();expect(session.serialize()).toBe(saved);
   const invalid=structuredClone(node.program);invalid.parameters.spokes='2';const state=session.state;expect(()=>session.updateCode(node.id,invalid)).toThrow('Assertion failed');expect(session.serialize()).toBe(saved);expect(session.state).toEqual(state);
  }
  const restored=createCadSession(JSON.parse(saved));try{expect(restored.serialize()).toBe(saved);}finally{restored.dispose();}
  const sidecar=await createModelAttributionSidecar(session.state.document,{filename:'a2d.stl',format:'stl',bytes:new Uint8Array([1]),modificationNotes:'Test output binding only.'});expect(sidecar.records[0].asset.sourceBundle).toEqual(asset.sourceBundle);
  session.undo();expect(session.serialize()).toBe(before);session.redo();expect(session.serialize()).toBe(saved);
 }finally{session.dispose();}
});
