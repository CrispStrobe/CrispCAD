// SPDX-License-Identifier: BSD-3-Clause
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {beforeAll,expect,it,vi} from 'vitest';
import {createCadSession,createModelAttributionSidecar,sha256Hex} from '@brickwright/cad-core';
import {createGeometryKernel,exportSTL,checkModelLibrarySTL} from '@brickwright/cad-geometry';
import {insertModelLibrarySource} from '../packages/geometry/src/model-library-insert.js';
import {createBundledModelLibrary} from '../apps/standalone/src/model-library-local.js';
const manifest=JSON.parse(readFileSync('library/editor-corpus-manifest.json','utf8'));
const raw=manifest.assets.find((a:any)=>a.id==='corpus-angelo-scene-city-street');
let kernel:Awaited<ReturnType<typeof createGeometryKernel>>;
beforeAll(async()=>{kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});});
it('pins the city root, five exact independent dependency grants and all prior96 complete records',()=>{
 expect(createHash('sha256').update(JSON.stringify(manifest.assets.slice(0,96))).digest('hex')).toBe('34fbd5ceb1fc679fa25c1ff4f85a3ac5d2294e8a399a4757bde7854c0eed9854');
 expect(raw.original.sha256).toBe('2b33c97c3eab119a88159929bfe6927510636f0d626ac57ca025995087653743');
 expect(raw.sourceBundle.rootPath).toBe('Projects/Scene_City_Street.scad');expect(raw.sourceBundle.dependencies).toHaveLength(5);
 const corpus=JSON.parse(readFileSync('library/corpus/manifest.json','utf8')).repositories.find((r:any)=>r.id==='AngeloNicoli--OpenSCAD-Snippet');
 for(const d of raw.sourceBundle.dependencies){const record=corpus.files.find((f:any)=>f.path===d.path);expect(d.file.sha256).toBe(record.sha256);expect(d.sourceRevision.commit).toBe(raw.version);expect(d.licence.spdx).toBe('MIT');expect(d.licence.review).toBe('accepted');expect(d.licence.attribution).toContain('Permission is hereby granted');expect(readFileSync('library/'+d.file.path)).toEqual(readFileSync('library/corpus/repos/'+corpus.id+'/'+d.path));}
});
it('inserts the authored default offline with actual strict STL, edits, provenance, serialization and undo/redo',async()=>{
 const bundle=createBundledModelLibrary(),asset=bundle.catalogue.assets.find(a=>a.id===raw.id)!,session=createCadSession(),before=session.serialize();
 try{await insertModelLibrarySource(session,bundle.catalogue,{assetId:asset.id,file:'original'},bundle.localFiles.get(asset.original.path!)!,{sourceFiles:bundle.localFiles,evaluate:kernel.evaluate,modificationNotes:'Exact authored root and five originals; no default edits.'});
  const geometry=kernel.evaluate(session.state.document);expect(geometry.volume).toBeCloseTo(9.927364671286085,8);const mesh=exportSTL(geometry.bodies);expect(await sha256Hex(mesh)).toBe('27c31bed500181d6207e8b020897515bb79cbe264c2387626c00dc79d3e5118f');
  const screening=await checkModelLibrarySTL(mesh,{checkedOn:'2026-11-14',maxTriangles:10000,maxExtentMm:200,toMillimetresZUp:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]});expect(screening.triangles).toBe(842);expect(Object.values(screening.checks)).toEqual(['pass','pass','pass','pass']);
  const record=session.state.document.provenance!.records[0];expect(record.selectedFile).toEqual(asset.original);expect(record.asset.sourceBundle).toEqual(asset.sourceBundle);
  const saved=session.serialize(),node=session.state.document.nodes[session.state.selection[0]];if(node.kind!=='code')throw Error('Expected editable code');
  const larger=structuredClone(node.program),marker=larger.source.lastIndexOf('\nreturn ');expect(marker).toBeGreaterThan(0);larger.source=larger.source.slice(0,marker)+`\nreturn scale([2,2,2], ${larger.source.slice(marker+8).trim().replace(/;$/,'')});\n`;
  session.updateCode(node.id,larger);expect(kernel.evaluate(session.state.document).volume).toBeCloseTo(8*geometry.volume,6);session.undo();expect(session.serialize()).toBe(saved);
  const invalid=structuredClone(node.program);invalid.source='return assertShape(false, box(1,1,1));';const state=session.state;expect(()=>session.updateCode(node.id,invalid)).toThrow('Assertion failed');expect(session.serialize()).toBe(saved);expect(session.state).toEqual(state);
  const restored=createCadSession(JSON.parse(saved));try{expect(restored.serialize()).toBe(saved);}finally{restored.dispose();}
  const sidecar=await createModelAttributionSidecar(session.state.document,{filename:'city.stl',format:'stl',bytes:mesh,modificationNotes:'Authored default export.'});expect(sidecar.records[0].asset.sourceBundle).toEqual(asset.sourceBundle);
  session.undo();expect(session.serialize()).toBe(before);session.redo();expect(session.serialize()).toBe(saved);
 }finally{session.dispose();}
});
it('refuses missing/corrupt dependencies before evaluation without altering project or redo',async()=>{
 const bundle=createBundledModelLibrary(),asset=bundle.catalogue.assets.find(a=>a.id===raw.id)!,session=createCadSession();session.rename('Keep redo');session.undo();const before=session.serialize(),state=session.state,evaluate=vi.fn(kernel.evaluate);
 try{for(const corrupt of [false,true]){const files=new Map(bundle.localFiles),dependency=asset.sourceBundle!.dependencies[0];if(corrupt)files.set(dependency.file.path!,new Uint8Array(dependency.file.bytes));else files.delete(dependency.file.path!);
  await expect(insertModelLibrarySource(session,bundle.catalogue,{assetId:asset.id,file:'original'},bundle.localFiles.get(asset.original.path!)!,{sourceFiles:files,evaluate,modificationNotes:'Original defaults.'})).rejects.toThrow();expect(evaluate).not.toHaveBeenCalled();expect(session.serialize()).toBe(before);expect(session.state).toEqual(state);
 }}finally{session.dispose();}
});
it('reproduces only the new city geometry while reusing hash-verified unchanged96 qualifications',()=>{
 expect(execFileSync(process.execPath,['scripts/generate-corpus-editor-library.mjs','--check','--asset-id',raw.id],{encoding:'utf8',timeout:15000})).toContain('103 selected corpus sources complete');
});
