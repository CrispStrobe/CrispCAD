// SPDX-License-Identifier: BSD-3-Clause
import {readFileSync} from 'node:fs';
import {beforeAll, expect, it, vi} from 'vitest';
import {createCadSession, createModelAttributionSidecar, parseModelLibraryCatalogue} from '@brickwright/cad-core';
import {createGeometryKernel, insertModelLibrarySource, type GeometryKernel} from '@brickwright/cad-geometry';
import {createBundledModelLibrary} from '../apps/standalone/src/model-library-local.js';
const read=(path:string)=>readFileSync(`library/${path}`);
const corpusManifest=JSON.parse(read('editor-corpus-manifest.json').toString());
const bundledCorpus=createBundledModelLibrary();
let kernel:GeometryKernel;
beforeAll(async()=>{kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});});

it('admits only the supported seed, retains exact original bytes and URL, and exports the full original MIT notice',async()=>{
  const {catalogue,localFiles}=createBundledModelLibrary();
  expect(catalogue.assets).toHaveLength(134);
  expect(catalogue.assets.some(asset=>['jscad-nuts-and-bolts','threads-scad-demo'].includes(asset.id))).toBe(false);
  const asset=catalogue.assets.find(asset=>asset.id==='jscad-involute-gear')!;
  expect(asset.original.url).toContain(`/${asset.sourceRevision!.commit}/`);
  expect(asset.editableSource).toEqual({path:'sources/jscad/gear.js',format:'jscad',sha256:asset.original.sha256,bytes:asset.original.bytes});
  expect(localFiles.get(asset.editableSource!.path!)).toEqual(new Uint8Array(read('sources/jscad/gear.js')));
  const session=createCadSession();session.rename('Redo survives undo');session.undo();
  const before=session.serialize(),revision=session.state.revision;
  await insertModelLibrarySource(session,catalogue,{assetId:asset.id,file:'editableSource'},localFiles.get(asset.editableSource!.path!)!,{evaluate:kernel.evaluate,modificationNotes:'Converted default gear; coordinates preserved.'});
  expect(session.state.revision).toBe(revision+1);
  const node=session.state.document.nodes[session.state.selection[0]];
  expect(node.kind).toBe('code');if(node.kind!=='code')throw new Error('Expected code');
  expect(node.program.parameters).toEqual({});expect(node.program.source).toContain('Converted JSCAD snapshot');
  const result=kernel.evaluate(session.state.document);
  expect(result.volume).toBeGreaterThan(800);expect(result.bodies[0].bounds.min[2]).toBeCloseTo(0);expect(result.bodies[0].bounds.max[2]).toBeCloseTo(5);
  const record=session.state.document.provenance!.records[0];
  expect(record.selectedFile).toEqual(asset.editableSource);expect(record.modificationNotes).toContain('"numTeeth":10');expect(record.modificationNotes).toContain('evaluated snapshot');
  const sidecar=await createModelAttributionSidecar(session.state.document,{filename:'gear.stl',format:'stl',bytes:new Uint8Array([1]),modificationNotes:'Geometry unchanged since snapshot insertion.'});
  expect(sidecar.records[0].asset.licence.attribution).toContain(read('evidence/jscad-LICENSE.txt').toString().replace(/\r?\n/g,' '));
  expect(sidecar.records[0].asset.original).toEqual(asset.original);
  const saved=session.serialize();expect(createCadSession(JSON.parse(saved)).serialize()).toBe(saved);
  session.undo();expect(session.serialize()).toBe(before);session.redo();expect(session.serialize()).toBe(saved);session.dispose();
});

it('bundles exactly ninety-three reviewed corpus entries',()=>{
  expect(corpusManifest.assets).toHaveLength(93);
  expect(bundledCorpus.catalogue.assets).toHaveLength(134);
});

it.each(corpusManifest.assets)('bundles and inserts reviewed corpus source $id with original identity and attribution',async(raw:any)=>{
    const {catalogue,localFiles,previews,licenceTexts}=bundledCorpus;
    const asset=catalogue.assets.find(item=>item.id===raw.id)!;
    expect(asset).toBeDefined();expect(previews.has(asset.original.sha256)).toBe(true);
    const bytes=localFiles.get(asset.original.path!)!;
    expect(bytes).toEqual(new Uint8Array(read(asset.original.path!)));
    expect(licenceTexts.get(asset.id)).toBe(read('evidence/corpus-selection-MIT-LICENSE.txt').toString());
    const session=createCadSession(),before=session.serialize();
    await insertModelLibrarySource(session,catalogue,{assetId:asset.id,file:'original'},bytes,{evaluate:kernel.evaluate,modificationNotes:'Default source geometry; colour omitted by translator; coordinates preserved.'});
    expect(kernel.evaluate(session.state.document).volume).toBeGreaterThan(0);
    const record=session.state.document.provenance!.records[0];
    expect(record.selectedFile).toEqual(asset.original);expect(record.asset.sourceRevision!.commit).toBe(raw.version);
    const sidecar=await createModelAttributionSidecar(session.state.document,{filename:'selected.stl',format:'stl',bytes:new Uint8Array([1]),modificationNotes:'Test output identity only.'});
    expect(sidecar.records[0].asset.licence.attribution).toContain(read('evidence/corpus-selection-MIT-LICENSE.txt').toString().replace(/\s+/g,' ').trim());
    const saved=session.serialize();expect(createCadSession(JSON.parse(saved)).serialize()).toBe(saved);
    session.undo();expect(session.serialize()).toBe(before);session.redo();expect(session.serialize()).toBe(saved);session.dispose();
});

it('refuses unsupported original seeds without evaluating or changing model, selection, history or redo',async()=>{
  const parsed=parseModelLibraryCatalogue(read('seed-catalogue.json').toString());if(!parsed.valid)throw new Error(parsed.errors.join(' '));
  for(const id of ['jscad-nuts-and-bolts','threads-scad-demo']){
    const catalogue=structuredClone(parsed.catalogue),asset=catalogue.assets.find(asset=>asset.id===id)!;
    const path=id==='threads-scad-demo'?'sources/threads-scad/threads.scad':'sources/jscad/nutsAndBolts.js';
    asset.editableSource={path,format:asset.original.format,sha256:asset.original.sha256,bytes:asset.original.bytes};
    const session=createCadSession();session.add({kind:'box',size:[1,2,3]});session.rename('Redo');session.undo();
    const state=session.state,saved=session.serialize(),evaluate=vi.fn(kernel.evaluate);
    await expect(insertModelLibrarySource(session,catalogue,{assetId:id,file:'editableSource'},read(path),{evaluate,modificationNotes:'Attempt supported conversion only.'})).rejects.toThrow();
    expect(evaluate).not.toHaveBeenCalled();expect(session.state).toEqual(state);expect(session.serialize()).toBe(saved);session.redo();expect(session.state.document.title).toBe('Redo');session.dispose();
  }
});
