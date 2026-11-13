// SPDX-License-Identifier: BSD-3-Clause
import {readFileSync} from 'node:fs';
import {beforeAll, expect, it, vi} from 'vitest';
import {createCadSession, createLocalModelLibraryCatalogue, createModelAttributionSidecar, fetchModelLibraryFile, validateModelLibraryCatalogue} from '@brickwright/cad-core';
import {createGeometryKernel, insertModelLibrarySource, type GeometryKernel} from '@brickwright/cad-geometry';
const read=(path:string)=>readFileSync(`library/${path}`);
const examples=createLocalModelLibraryCatalogue(JSON.parse(read('examples-manifest.json').toString()));
const fixtures=createLocalModelLibraryCatalogue(JSON.parse(read('fixtures-manifest.json').toString()));
let kernel:GeometryKernel;
beforeAll(async()=>{kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});});
const options=()=>({evaluate:kernel.evaluate,modificationNotes:'Source compiled with default parameters; coordinates preserved.'});

it('inserts all 35 pinned local sources as editable code with provenance, one undoable edit, and attribution',async()=>{
  for(const catalogue of [examples,fixtures])for(const asset of catalogue.assets){
    const session=createCadSession();session.add({kind:'box',size:[1,1,1]});
    const before=session.serialize(),revision=session.state.revision;
    await insertModelLibrarySource(session,catalogue,{assetId:asset.id,file:'original'},read(asset.original.path!),options());
    const saved=session.serialize(),doc=session.state.document,node=doc.nodes[session.state.selection[0]];
    expect(node.kind).toBe('code');expect(node.physics).toBeUndefined();expect(session.state.revision).toBe(revision+1);
    if(node.kind==='code'&&asset.original.format==='cad-script')expect(node.program.source).toBe(read(asset.original.path!).toString());
    expect(doc.provenance!.records[0].selectedFile).toEqual(asset.original);
    const sidecar=await createModelAttributionSidecar(doc,{filename:'model.stl',format:'stl',bytes:new Uint8Array([1]),modificationNotes:'Test caller-supplied output.'});
    expect(sidecar.records[0].asset).toEqual(asset);
    expect(createCadSession(JSON.parse(saved)).serialize()).toBe(saved);
    session.undo();expect(session.serialize()).toBe(before);session.redo();expect(session.serialize()).toBe(saved);session.dispose();
  }
});

it('rejects ambiguous/traversing local identities and never sends local selections to network/cache',async()=>{
  for(const path of ['../secret','sources/../secret.cad','/etc/passwd','sources/a%2fb.cad','sources/a\\b.cad','https://example.org/a.cad']){
    const copy=structuredClone(examples);copy.assets[0].original={...copy.assets[0].original,path};expect(validateModelLibraryCatalogue(copy).valid).toBe(false);
  }
  const copy=structuredClone(examples);Object.assign(copy.assets[0].original,{url:'https://example.org/a.cad'});expect(validateModelLibraryCatalogue(copy).valid).toBe(false);
  const fetch=vi.fn(),read=vi.fn();
  await expect(fetchModelLibraryFile(examples,{assetId:examples.assets[0].id,file:'original'},{fetch,cache:{read,write:vi.fn(),remove:vi.fn()}})).rejects.toThrow('Local');
  expect(fetch).not.toHaveBeenCalled();expect(read).not.toHaveBeenCalled();
});

it('preserves document, selection and redo for tamper, bad code, conversion, empty kernel and invalid notes',async()=>{
  for(const failure of ['tamper','code','conversion','kernel','notes']){
    const catalogue=structuredClone(examples),asset=catalogue.assets[0],session=createCadSession();session.rename('Redo');session.undo();
    let bytes=new Uint8Array(read(asset.original.path!));const opts=options();
    if(failure==='tamper')bytes[0]^=1;
    if(failure==='code'){bytes=new TextEncoder().encode('return box(0,0,0);');const {sha256Hex}=await import('@brickwright/cad-core');asset.original.bytes=bytes.length;asset.original.sha256=await sha256Hex(bytes);}
    if(failure==='conversion')asset.conversion.toMillimetresZUp[12]=1;
    if(failure==='kernel')opts.evaluate=()=>({bodies:[],triangles:0,volume:0});
    if(failure==='notes')opts.modificationNotes='';
    const state=session.state,saved=session.serialize();await expect(insertModelLibrarySource(session,catalogue,{assetId:asset.id,file:'original'},bytes,opts)).rejects.toThrow();expect(session.state).toEqual(state);expect(session.serialize()).toBe(saved);session.redo();expect(session.state.document.title).toBe('Redo');
  }
});

it('rejects cancellation and concurrent edits after awaited evaluation; snapshots mutable bytes and metadata',async()=>{
  for(const action of ['cancel','edit','snapshot'] as const){
    const catalogue=structuredClone(examples),asset=catalogue.assets[0],bytes=new Uint8Array(read(asset.original.path!)),session=createCadSession(),controller=new AbortController();
    let entered!:()=>void,release!:()=>void;const ready=new Promise<void>(r=>{entered=r;});
    const pending=insertModelLibrarySource(session,catalogue,{assetId:asset.id,file:'original'},bytes,{...options(),signal:controller.signal,evaluate:doc=>{const result=kernel.evaluate(doc);entered();return new Promise(resolve=>{release=()=>resolve(result);});}});
    bytes.fill(0);asset.author='Changed';await ready;
    if(action==='cancel')controller.abort();if(action==='edit')session.rename('Changed');const saved=session.serialize();release();
    if(action==='snapshot'){await pending;expect(session.state.document.provenance!.records[0].asset.author).not.toBe('Changed');}
    else{await expect(pending).rejects.toThrow();expect(session.serialize()).toBe(saved);}
  }
});
