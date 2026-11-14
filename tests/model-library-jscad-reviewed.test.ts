// SPDX-License-Identifier: BSD-3-Clause
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {beforeAll,expect,it} from 'vitest';
import {createCadSession,createModelAttributionSidecar,sha256Hex} from '@brickwright/cad-core';
import {createGeometryKernel,exportSTL,checkModelLibrarySTL} from '@brickwright/cad-geometry';
import {insertModelLibrarySource} from '../packages/geometry/src/model-library-insert.js';
import {createBundledModelLibrary} from '../apps/standalone/src/model-library-local.js';
const manifest=JSON.parse(readFileSync('library/jscad-editor-manifest.json','utf8'));
const archived=JSON.parse(readFileSync('tests/fixtures/code-corpus/manifest.json','utf8'));
let kernel:Awaited<ReturnType<typeof createGeometryKernel>>;
beforeAll(async()=>{kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});});
it('admits exactly one upstream JSCAD example and three labelled SCAD transformation fixtures with exact MIT originals',async()=>{
 expect(manifest.assets).toHaveLength(4);expect(manifest.assets.map((a:any)=>a.original.format)).toEqual(['jscad','openscad','openscad','openscad']);
 for(const asset of manifest.assets){const row=archived.models.find((m:any)=>m.path===asset.archiveSelection.upstreamPath);expect(asset.version).toBe(row.revision);expect(asset.original.sha256).toBe(row.sha256);expect(readFileSync('library/'+asset.original.path)).toEqual(readFileSync('tests/fixtures/code-corpus/'+row.file));expect(asset.licence.spdx).toBe('MIT');expect(asset.licence.attribution).toContain('Permission is hereby granted');expect(asset.licence.attribution).toContain('JSCAD Organization');expect(asset.modificationNotes).toContain('without source, argument, entrypoint, frame or fragment overrides');if(asset.original.format==='openscad')expect(asset.title).toContain('fixture');}
});
it.each(manifest.assets)('inserts exact default $id offline with strict STL, native edits, provenance and complete history',async(raw:any)=>{
 const bundle=createBundledModelLibrary(),asset=bundle.catalogue.assets.find(a=>a.id===raw.id)!,session=createCadSession(),before=session.serialize();
 try{expect(bundle.previews.has(asset.original.sha256)).toBe(true);expect(bundle.licenceTexts.get(asset.id)).toBe(readFileSync('library/evidence/jscad-LICENSE.txt','utf8'));
  await insertModelLibrarySource(session,bundle.catalogue,{assetId:asset.id,file:'original'},bundle.localFiles.get(asset.original.path!)!,{sourceFiles:bundle.localFiles,evaluate:kernel.evaluate,modificationNotes:'Exact authored upstream example/fixture default; no source or placement edits.'});
  const geometry=kernel.evaluate(session.state.document),mesh=exportSTL(geometry.bodies);expect(geometry.volume).toBeGreaterThan(0);expect(await sha256Hex(mesh)).toBe(raw.derivatives[0].sha256);
  const screen=await checkModelLibrarySTL(mesh,{checkedOn:'2026-11-14',maxTriangles:10000,maxExtentMm:200,toMillimetresZUp:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]});expect(Object.values(screen.checks)).toEqual(['pass','pass','pass','pass']);expect(screen.triangles).toBe(raw.id.endsWith('basicbooleans')?1532:12);
  const bounds=geometry.bodies[0].bounds;
  if(raw.id.endsWith('translateex1')){expect(geometry.volume).toBeCloseTo(1000,7);expect(bounds).toEqual({min:[5,0,-5],max:[15,10,5]});}
  if(raw.id.endsWith('scaleex1')){expect(geometry.volume).toBeCloseTo(8000,7);expect(bounds).toEqual({min:[-10,-10,-10],max:[10,10,10]});}
  if(raw.id.endsWith('rotateex1')){expect(geometry.volume).toBeCloseTo(1000,7);for(const k of [0,2]){expect(bounds.min[k]).toBeCloseTo(-5*Math.SQRT2,5);expect(bounds.max[k]).toBeCloseTo(5*Math.SQRT2,5);}expect(bounds.min[1]).toBe(-5);expect(bounds.max[1]).toBe(5);}
  const record=session.state.document.provenance!.records[0];expect(record.selectedFile).toEqual(asset.original);expect(record.asset.sourceRevision!.commit).toBe(raw.version);
  const saved=session.serialize(),node=session.state.document.nodes[session.state.selection[0]];if(node.kind!=='code')throw Error('Expected editable code');
  const larger=structuredClone(node.program),marker=larger.source.lastIndexOf('\nreturn ');expect(marker).toBeGreaterThan(0);larger.source=larger.source.slice(0,marker)+`\nreturn scale([2,2,2], ${larger.source.slice(marker+8).trim().replace(/;$/,'')});\n`;session.updateCode(node.id,larger);expect(kernel.evaluate(session.state.document).volume).toBeCloseTo(8*geometry.volume,5);session.undo();expect(session.serialize()).toBe(saved);
  const invalid=structuredClone(node.program);invalid.source='return assertShape(false, box(1,1,1));';const state=session.state;expect(()=>session.updateCode(node.id,invalid)).toThrow('Assertion failed');expect(session.serialize()).toBe(saved);expect(session.state).toEqual(state);
  const restored=createCadSession(JSON.parse(saved));try{expect(restored.serialize()).toBe(saved);expect(await sha256Hex(exportSTL(kernel.evaluate(restored.state.document).bodies))).toBe(raw.derivatives[0].sha256);}finally{restored.dispose();}
  const sidecar=await createModelAttributionSidecar(session.state.document,{filename:'example.stl',format:'stl',bytes:mesh,modificationNotes:'Original example/fixture geometry.'});expect(sidecar.records[0].asset.original).toEqual(asset.original);expect(sidecar.records[0].asset.licence.attribution).toContain('Permission is hereby granted');
  session.undo();expect(session.serialize()).toBe(before);session.redo();expect(session.serialize()).toBe(saved);
 }finally{session.dispose();}
});
it('reproduces only these four already archived examples/fixtures without changing prior collections',()=>{
 expect(execFileSync(process.execPath,['scripts/generate-jscad-editor-library.mjs','--check'],{encoding:'utf8',timeout:15000})).toContain('4 exact authored JSCAD example/fixture roots pass');
});
