// SPDX-License-Identifier: BSD-3-Clause
import {beforeAll,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {createCadSession,createLocalModelLibraryCatalogue,createModelAttributionSidecar,sha256Hex,validateModelLibraryCatalogue} from '@brickwright/cad-core';
import {createGeometryKernel} from '@brickwright/cad-geometry';
import {insertModelLibrarySource} from '../packages/geometry/src/model-library-insert.js';

let kernel:Awaited<ReturnType<typeof createGeometryKernel>>;
beforeAll(async()=>{kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});});
async function fixture(){
 const bytes=new TextEncoder().encode('include <../lib.scad>; size=2; part(size);'),dependency=new TextEncoder().encode('module part(size){assert(size>0);cube(size);}');
 const catalogue=createLocalModelLibraryCatalogue(JSON.parse(readFileSync('library/examples-manifest.json','utf8'))),asset=structuredClone(catalogue.assets[0]);
 asset.id='synthetic-source-bundle';asset.title='Synthetic dependency fixture';asset.sourceUrl='https://example.com/root.scad';delete asset.quality;asset.derivatives=[];
 asset.original={path:'sources/bundle/root.scad',format:'openscad',sha256:await sha256Hex(bytes),bytes:bytes.length};
 asset.sourceBundle={format:'brickwright-openscad-bundle',version:1,rootPath:'Samples/root.scad',dependencies:[{path:'lib.scad',file:{path:'sources/bundle/lib.scad',format:'openscad',bytes:dependency.length,sha256:await sha256Hex(dependency)},author:asset.author,sourceUrl:'https://example.com/lib.scad',sourceRevision:{repositoryUrl:'https://github.com/CrispStrobe/brickwright-cad',commit:'1'.repeat(40)},licence:structuredClone(asset.licence)}]};
 return {catalogue:{...catalogue,assets:[asset]},asset,bytes,dependency,sourceFiles:new Map([['sources/bundle/lib.scad',dependency]])};
}

it('validates every include dependency grant, identity and aggregate source budget',async()=>{
 const f=await fixture();expect(validateModelLibraryCatalogue(f.catalogue).valid).toBe(true);
 for(const edit of [
  (a:any)=>a.sourceBundle.dependencies[0].licence.spdx='GPL-3.0',
  (a:any)=>a.sourceBundle.dependencies[0].sourceRevision.commit='main',
  (a:any)=>a.sourceBundle.dependencies[0].path='../lib.scad',
  (a:any)=>a.sourceBundle.dependencies.push(structuredClone(a.sourceBundle.dependencies[0])),
  (a:any)=>a.sourceBundle.dependencies[0].file.bytes=32768,
  (a:any)=>a.sourceBundle.dependencies[0].sourceUrl='http://example.com/lib.scad',
  (a:any)=>a.sourceBundle.extra='unknown',
 ]){const catalogue=structuredClone(f.catalogue);edit(catalogue.assets[0]);expect(validateModelLibraryCatalogue(catalogue).valid).toBe(false);}
});

it('rejects missing or corrupt dependency bytes before evaluation and preserves history and redo',async()=>{
 const f=await fixture(),session=createCadSession();session.add({kind:'box',size:[1,2,3]});session.rename('Redo');session.undo();
 const before=session.serialize(),state=session.state,evaluate=vi.fn(kernel.evaluate);
 try{for(const sourceFiles of [new Map(),new Map([['sources/bundle/lib.scad',new Uint8Array(f.dependency.length).fill(120)]])]){
  await expect(insertModelLibrarySource(session,f.catalogue,{assetId:f.asset.id,file:'original'},f.bytes,{sourceFiles,evaluate,modificationNotes:'Synthetic unchanged source.'})).rejects.toThrow();
  expect(evaluate).not.toHaveBeenCalled();expect(session.serialize()).toBe(before);expect(session.state).toEqual(state);
 }}finally{session.dispose();}
});

it('inserts verified originals offline and retains dependency attribution through edits, export and undo',async()=>{
 const f=await fixture(),session=createCadSession(),before=session.serialize();
 try{
  await insertModelLibrarySource(session,f.catalogue,{assetId:f.asset.id,file:'original'},f.bytes,{sourceFiles:f.sourceFiles,evaluate:kernel.evaluate,modificationNotes:'Synthetic unchanged source.'});
  expect(kernel.evaluate(session.state.document).volume).toBeCloseTo(8);
  const record=session.state.document.provenance!.records[0];expect(record.asset.sourceBundle).toEqual(f.asset.sourceBundle);expect(record.selectedFile).toEqual(f.asset.original);
  const node=session.state.document.nodes[session.state.selection[0]];if(node.kind!=='code')throw Error('Expected code');
  const invalid=structuredClone(node.program);invalid.parameters.size='-1';const saved=session.serialize();expect(()=>session.updateCode(node.id,invalid)).toThrow(/assertion failed/i);expect(session.serialize()).toBe(saved);
  const sidecar=await createModelAttributionSidecar(session.state.document,{filename:'fixture.stl',format:'stl',bytes:new Uint8Array([1]),modificationNotes:'Synthetic output identity only.'});
  expect(sidecar.records[0].asset.sourceBundle).toEqual(f.asset.sourceBundle);expect(createCadSession(JSON.parse(saved)).serialize()).toBe(saved);
  session.undo();expect(session.serialize()).toBe(before);session.redo();expect(session.serialize()).toBe(saved);
 }finally{session.dispose();}
});
