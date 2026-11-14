// SPDX-License-Identifier: BSD-3-Clause
import {beforeAll,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createCadSession,createModelAttributionSidecar,sha256Hex,importOpenSCADBundle} from '@brickwright/cad-core';
import {createGeometryKernel,exportSTL,checkModelLibrarySTL} from '@brickwright/cad-geometry';
import {insertModelLibrarySource} from '../packages/geometry/src/model-library-insert.js';
import {createBundledModelLibrary} from '../apps/standalone/src/model-library-local.js';
const manifest=JSON.parse(readFileSync('library/scon-editor-manifest.json','utf8'));
const read=(p:string)=>readFileSync('library/'+p),notice=read('evidence/scon-MIT-LICENSE.txt').toString();
let kernel:Awaited<ReturnType<typeof createGeometryKernel>>;
beforeAll(async()=>{kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});});
it('admits exactly five unchanged MIT defaults and archives the sixth depth refusal',async()=>{
 expect(manifest.assets.map((a:any)=>a.id)).toEqual(['ex1','ex2','ex3','ex4','tldr'].map(n=>'corpus-scon-'+n));
 expect(manifest.selection).toMatchObject({count:5,runtimeChecked:5,complete:true});
 const report=JSON.parse(read('corpus-audit/editor-screening-cycle19.json').toString());expect(report.summary).toEqual({sample:6,beforeQualified:0,afterQualified:5,limited:1});
 const failure=report.after.results.find((r:any)=>r.name==='ex5');expect(failure.status).toBe('limited');expect(failure.error.message).toContain('construction nesting exceeds 32');
 for(const asset of manifest.assets){
  expect(asset.sourceRevision.commit).toBe('c954e07bf0faf571d8eccc259d47e61938666cef');
  expect(read(asset.original.path)).toEqual(read(asset.corpusSelection.archivedPath));
  const d=asset.sourceBundle.dependencies[0];expect(d.file.sha256).toBe('ee43fabc0729b37a0ab736ac6fa668eef7458b0f2f2b0287e4bf95eba40c4040');
  expect(read(d.file.path)).toEqual(read('corpus/repos/wmacevoy--openscad-scon/scon.scad'));
  for(const grant of [asset.licence,d.licence]){expect(grant.spdx).toBe('MIT');expect(grant.attribution).toContain(notice.replace(/\s+/g,' ').trim());}
  for(const f of [asset.original,d.file,...asset.derivatives,...asset.licence.localEvidence]){const bytes=read(f.path);expect(bytes.length).toBe(f.bytes);expect(await sha256Hex(bytes)).toBe(f.sha256);}
  const checked=await checkModelLibrarySTL(read(asset.derivatives[0].path),{checkedOn:'2026-11-14',toMillimetresZUp:asset.conversion.toMillimetresZUp,maxTriangles:10000,maxExtentMm:200});expect(Object.values(checked.checks)).toEqual(['pass','pass','pass','pass']);expect(checked.quality).toEqual(asset.quality);
 }
 // STL Float32 coordinates round the two scales independently.
 const sphere=manifest.assets[0],small=manifest.assets[4];expect(sphere.measurements.signedVolumeMm3/small.measurements.signedVolumeMm3).toBeCloseTo(1000,4);
 expect(sphere.measurements.boundsMm).toEqual({min:[-9,-8,-7],max:[11,12,13]});
});
it.each(manifest.assets)('inserts $id offline with actual mesh, exact originals, grants, sidecar and undo/redo',async(raw:any)=>{
 const bundle=createBundledModelLibrary(),asset=bundle.catalogue.assets.find(a=>a.id===raw.id)!,session=createCadSession(),before=session.serialize();
 try{
  expect(bundle.licenceTexts.get(asset.id)).toBe(notice);
  const files=[{path:asset.sourceBundle!.rootPath,source:read(asset.original.path!).toString(),sha256:asset.original.sha256},...asset.sourceBundle!.dependencies.map(d=>({path:d.path,source:read(d.file.path!).toString(),sha256:d.file.sha256}))];
  expect((await importOpenSCADBundle({version:1,rootPath:asset.sourceBundle!.rootPath,files})).provenance).toEqual(raw.bundleProvenance);
  await insertModelLibrarySource(session,bundle.catalogue,{assetId:asset.id,file:'original'},bundle.localFiles.get(asset.original.path!)!,{sourceFiles:bundle.localFiles,evaluate:kernel.evaluate,modificationNotes:'Unchanged authored SCON configuration.'});
  const result=kernel.evaluate(session.state.document);expect(result.volume).toBeGreaterThan(0);expect(await sha256Hex(exportSTL(result.bodies))).toBe(raw.derivatives[0].sha256);
  const record=session.state.document.provenance!.records[0];expect(record.selectedFile).toEqual(asset.original);expect(record.asset.sourceBundle).toEqual(asset.sourceBundle);
  const saved=session.serialize(),restored=createCadSession(JSON.parse(saved));try{expect(restored.serialize()).toBe(saved);}finally{restored.dispose();}
  const sidecar=await createModelAttributionSidecar(session.state.document,{filename:'scon.stl',format:'stl',bytes:exportSTL(result.bodies),modificationNotes:'Authored default geometry.'});expect(sidecar.records[0].asset.sourceBundle).toEqual(asset.sourceBundle);
  session.undo();expect(session.serialize()).toBe(before);session.redo();expect(session.serialize()).toBe(saved);
 }finally{session.dispose();}
});
it('reproduces the five admitted defaults under the final compiler without writes',()=>{
 expect(execFileSync(process.execPath,['scripts/generate-scon-editor-library.mjs','--check'],{encoding:'utf8',timeout:30000})).toContain('5 authored SCON roots reproduced');
});
