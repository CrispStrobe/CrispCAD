// SPDX-License-Identifier: BSD-3-Clause
import {beforeAll, describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createCadSession, sha256Hex, type ModelLibraryCatalogue} from '@brickwright/cad-core';
import {createGeometryKernel, checkModelLibrarySTL, insertModelLibrarySTL, type GeometryKernel} from '@brickwright/cad-geometry';
const identity = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
const conversion = [25.4,0,0,0, 0,0,25.4,0, 0,-25.4,0,0, 3,4,5,1];
let kernel: GeometryKernel;
beforeAll(async()=>{kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});});
const selection = {assetId:'block',file:{derivative:0}} as const;
async function fixture() {
  const points=[[0,0,0],[1,0,0],[0,1,0],[0,0,1]],faces=[[0,2,1],[0,1,3],[0,3,2],[1,2,3]];
  const bytes=new TextEncoder().encode(`solid test\n${faces.map(face=>`facet normal 0 0 0\nouter loop\n${face.map(id=>`vertex ${points[id].join(' ')}`).join('\n')}\nendloop\nendfacet`).join('\n')}\nendsolid test`);
  const options={toMillimetresZUp:[...conversion], checkedOn:'2026-11-13',modificationNotes:'Applied retained inch/Y-up conversion; no repair.',evaluate:kernel.evaluate};
  const result=await checkModelLibrarySTL(bytes, options);
  const file={url:'https://example.org/mesh.stl',format:'stl',bytes:bytes.length,sha256:await sha256Hex(bytes)};
  const catalogue:ModelLibraryCatalogue={format:'brickwright-model-library',version:1,assets:[{
    id:'block',version:'1',title:'Block',author:'Creator',sourceUrl:'https://example.org/block',
    licence:{spdx:'CC-BY-4.0',scope:'asset',attribution:'Creator, Block, CC-BY-4.0',evidenceUrl:'https://example.org/grant',capturedOn:'2026-11-13',review:'accepted',reviewer:'Curator'},
    original:{...file,format:'cad-script',sha256:'a'.repeat(64)},derivatives:[file],modificationNotes:'Rendered mesh.',
    conversion:{sourceUnits:'mm',unitAssumption:'Original source uses mm; derivative differs.',sourceUpAxis:'Z',toMillimetresZUp:identity},quality:result.quality,
  }]};
  const session=createCadSession();session.add({kind:'box',size:[1,1,1]});session.rename('Before');session.undo();
  return {session,bytes,catalogue,options};
}
describe('atomic headless catalogue insertion',()=>{
  it('inserts transformed geometry and exact provenance in one edit with undo/redo and roundtrip',async()=>{
    const f=await fixture(),before=f.session.serialize(),revision=f.session.state.revision;
    let events=0;f.session.subscribe(()=>events++);
    const result=await insertModelLibrarySTL(f.session,f.catalogue,selection,f.bytes,f.options);
    expect(result.checks.closedPositiveVolume).toBe('pass');expect(events).toBe(1);expect(f.session.state.revision).toBe(revision+1);
    const doc=f.session.state.document,node=doc.nodes[f.session.state.selection[0]];
    expect(node.kind).toBe('mesh');expect(node.physics).toBeUndefined();expect(node.transform.position).toEqual([0,0,0]);
    const body=kernel.evaluate(doc).bodies.find(b=>b.id===node.id)!;
    expect(body.bounds.min).toEqual([3,expect.closeTo(-21.4,4),5]);expect(body.volume).toBeCloseTo(25.4**3/6,2);
    expect(doc.provenance?.records[0]).toMatchObject({asset:f.catalogue.assets[0],selectedFile:f.catalogue.assets[0].derivatives[0],modificationNotes:f.options.modificationNotes});
    const saved=f.session.serialize();expect(createCadSession(JSON.parse(saved)).serialize()).toBe(saved);
    f.session.undo();expect(f.session.serialize()).toBe(before);f.session.redo();expect(f.session.serialize()).toBe(saved);
  });
  it('preserves document, selection, revision, undo and redo for every rejected edit',async()=>{
    for(const failure of ['size','hash','quality','policy','transform','limits','notes','kernel','format','malformed','legacy','coordinate','selected-hash','budget','empty-kernel'] as const){
      const f=await fixture();
      if(failure==='size')f.bytes=f.bytes.slice(1);
      if(failure==='hash')f.bytes[0]^=1;
      if(failure==='quality')f.catalogue.assets[0].quality!.closedPositiveVolume=false;
      if(failure==='policy')delete f.catalogue.assets[0].quality!.screeningPolicy;
      if(failure==='transform')f.options.toMillimetresZUp=[...identity];
      if(failure==='limits')Object.assign(f.options,{maxTriangles:3});
      if(failure==='notes')f.options.modificationNotes='';
      if(failure==='kernel')f.options.evaluate=()=>{throw new Error('Kernel refused');};
      if(failure==='format')f.catalogue.assets[0].derivatives[0].format='step';
      if(failure==='malformed'){f.bytes=new TextEncoder().encode(new TextDecoder().decode(f.bytes)+'\ngarbage');Object.assign(f.catalogue.assets[0].derivatives[0],{bytes:f.bytes.length,sha256:await sha256Hex(f.bytes)});f.catalogue.assets[0].quality!.fileSha256=await sha256Hex(f.bytes);}
      if(failure==='legacy'){const doc=JSON.parse(f.session.serialize());doc.provenance={legacy:true};f.session=createCadSession(doc);}
      if(failure==='selected-hash')f.catalogue.assets[0].quality!.fileSha256='a'.repeat(64);
      if(failure==='budget')f.catalogue.assets[0].quality!.screeningPolicy!.maxAnalysisBytes=1;
      if(failure==='empty-kernel')f.options.evaluate=()=>({bodies:[],volume:0,triangles:0});
      if(failure==='coordinate'){f.options.toMillimetresZUp[12]=1000001;f.catalogue.assets[0].quality!.screeningPolicy!.toMillimetresZUp=[...f.options.toMillimetresZUp];}
      const state=f.session.state,saved=f.session.serialize();
      await expect(insertModelLibrarySTL(f.session,f.catalogue,selection,f.bytes,f.options),failure).rejects.toThrow();
      expect(f.session.state).toEqual(state);expect(f.session.serialize()).toBe(saved);
      f.session.redo();if(state.canRedo)expect(f.session.state.document.title).toBe('Before');
    }
  });
  it('admits an explicit original STL and refuses editable/nonexistent selections',async()=>{
    const f=await fixture();f.catalogue.assets[0].original={...f.catalogue.assets[0].derivatives[0]};
    await expect(insertModelLibrarySTL(f.session,f.catalogue,{assetId:'block',file:'editableSource'},f.bytes,f.options)).rejects.toThrow('Select');
    await expect(insertModelLibrarySTL(f.session,f.catalogue,{assetId:'missing',file:'original'},f.bytes,f.options)).rejects.toThrow('Unknown');
    await insertModelLibrarySTL(f.session,f.catalogue,{assetId:'block',file:'original'},f.bytes,f.options);
    expect(f.session.state.document.provenance!.records[0].selectedFile).toEqual(f.catalogue.assets[0].original);
  });
  it('snapshots bytes, metadata and options across async hashing',async()=>{
    const f=await fixture(),pending=insertModelLibrarySTL(f.session,f.catalogue,selection,f.bytes,f.options);
    f.bytes.fill(0);f.catalogue.assets[0].author='Changed';f.options.toMillimetresZUp.fill(0);f.options.modificationNotes='Changed';
    await pending;expect(f.session.state.document.provenance!.records[0].asset.author).toBe('Creator');
    expect(f.session.state.document.provenance!.records[0].modificationNotes).not.toBe('Changed');
  });
  it('refuses a stale project after an intervening edit or kernel callback edit',async()=>{
    for(const duringKernel of [false,true]){
      const f=await fixture();if(duringKernel)f.options.evaluate=doc=>{f.session.rename('Intervening');return kernel.evaluate(doc);};
      const pending=insertModelLibrarySTL(f.session,f.catalogue,selection,f.bytes,f.options);
      if(!duringKernel)f.session.rename('Intervening');
      await expect(pending).rejects.toThrow('Project changed');expect(f.session.state.document.roots).toHaveLength(1);expect(f.session.state.document.title).toBe('Intervening');
    }
  });
});
