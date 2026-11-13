// SPDX-License-Identifier: BSD-3-Clause
import {afterEach, beforeAll, expect, it, vi} from 'vitest';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {unzipSync} from 'fflate';
import {createCadSession, serializeDocument} from '@brickwright/cad-core';
import type {ModelLibraryAsset} from '@brickwright/cad-core';
import {createGeometryKernel, exportSTL, export3MF} from '@brickwright/cad-geometry';
import type {GeometryKernel} from '@brickwright/cad-geometry';
import {prepareMeshExport} from '../packages/editor/src/export-policy.js';
import {download} from '../apps/standalone/src/files.js';
let kernel: GeometryKernel;
beforeAll(async()=>{kernel=await createGeometryKernel({wasmBinary:await readFile('node_modules/manifold-3d/manifold.wasm')});});
afterEach(()=>vi.unstubAllGlobals());
const hash=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
async function project(){
  const catalogue=JSON.parse(await readFile('library/seed-catalogue.json','utf8'));
  const asset=catalogue.assets[0] as ModelLibraryAsset;
  const session=createCadSession();
  const base=session.add({kind:'box',size:[10,10,10]}),tool=session.add({kind:'box',size:[2,2,2]});
  session.attachProvenance([tool],{id:'source',asset,selectedFile:asset.original,modificationNotes:'Inserted at declared scale.'});
  const root=session.combine('subtract',[base,tool]);
  const reference=session.add({kind:'box',size:[100,1,1]});session.update(reference,{reference:true});
  return {session,root,tool};
}
it('packages operand attribution and exact printable STL from one snapshot, preserving live document and history',async()=>{
  const {session,root,tool}=await project(),snapshot=session.state.document,before=serializeDocument(snapshot),revision=session.state.revision;
  const file=await prepareMeshExport(snapshot,'stl',async doc=>kernel.evaluate(doc),()=>{},'Subtracted the source tool; no other source changes.');
  expect(file.mime).toBe('application/zip');expect(file.name).toMatch(/\.stl\.zip$/);
  const entries=unzipSync(file.bytes),name=file.name.slice(0,-4);
  expect(Object.keys(entries)).toEqual([name,`${name}.attribution.json`]);
  expect(entries[name]).toEqual(exportSTL(kernel.evaluate(snapshot).bodies));
  const sidecar=JSON.parse(new TextDecoder().decode(entries[`${name}.attribution.json`]));
  expect(sidecar.rootIds).toEqual([root]);
  expect(sidecar.nodes.find((node:any)=>node.id===tool).provenanceIds).toEqual(['source']);
  expect(sidecar.output).toMatchObject({filename:name,bytes:entries[name].length,sha256:hash(entries[name]),modificationNotes:'Subtracted the source tool; no other source changes.'});
  expect(sidecar.project.sha256).toBe(hash(before));
  expect(serializeDocument(session.state.document)).toBe(before);expect(session.state.revision).toBe(revision);
});
it('requires explicit valid notes and refuses attributed 3MF before evaluating or delivering',async()=>{
  const {session}=await project(),evaluate=vi.fn();
  for(const notes of [undefined,'','  ','a\nb','x'.repeat(4097)])await expect(prepareMeshExport(session.state.document,'stl',evaluate,()=>{},notes)).rejects.toThrow('changes');
  await expect(prepareMeshExport(session.state.document,'3mf',evaluate,()=>{},'Unchanged.')).rejects.toThrow('3MF');
  expect(evaluate).not.toHaveBeenCalled();
});
it('refuses canceled, disposed or edited exports after asynchronous evaluation, and cancellation during hashing',async()=>{
  for(const reason of ['Export canceled','Editor was disposed','The model changed']){
    const {session}=await project();let invalid=false;
    const check=()=>{if(invalid)throw Error(reason);};
    await expect(prepareMeshExport(session.state.document,'stl',async doc=>{const result=kernel.evaluate(doc);session.rename('Concurrent edit');invalid=true;return result;},check,'Unchanged.')).rejects.toThrow(reason);
  }
  const {session}=await project();let checks=0;
  await expect(prepareMeshExport(session.state.document,'stl',async doc=>kernel.evaluate(doc),()=>{if(++checks===3)throw Error('Export canceled');},'Unchanged.')).rejects.toThrow('Export canceled');
});
it('plain and reference-only exports remain single STL/3MF files',async()=>{
  const {session,root}=await project();session.update(root,{reference:true});session.add({kind:'box',size:[3,4,5]});
  for(const format of ['stl','3mf'] as const){
    const document=session.state.document,file=await prepareMeshExport(document,format,async doc=>kernel.evaluate(doc),()=>{});
    expect(file.mime).toBe(format==='stl'?'model/stl':'model/3mf');
    // ZIP containers carry timestamps; inspect contents for 3MF.
    const expected=(format==='stl'?exportSTL:export3MF)(kernel.evaluate(document).bodies);
    expect(format==='stl'?file.bytes:unzipSync(file.bytes)).toEqual(format==='stl'?expected:unzipSync(expected));
  }
});
it('native host saves the ZIP once and propagates canceled saves without falling back to a lone STL',async()=>{
  const {session}=await project(),file=await prepareMeshExport(session.state.document,'stl',async doc=>kernel.evaluate(doc),()=>{},'Unchanged since insertion.');
  const save=vi.fn().mockResolvedValue({saved:false});
  vi.stubGlobal('window',{brickwrightDesktop:true,webkit:{messageHandlers:{cadSave:{postMessage:save}}}});
  await expect(download(file)).rejects.toThrow('Save canceled');expect(save).toHaveBeenCalledTimes(1);
  const sent=save.mock.calls[0][0];expect(sent.name).toBe(file.name);
  expect(new Uint8Array(Buffer.from(sent.data,'base64'))).toEqual(file.bytes);
  save.mockResolvedValue({saved:true});await download(file);expect(save).toHaveBeenCalledTimes(2);
});
