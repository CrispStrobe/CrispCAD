// SPDX-License-Identifier: BSD-3-Clause
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {beforeAll,expect,it} from 'vitest';
import {createCadSession,createModelAttributionSidecar,sha256Hex} from '@brickwright/cad-core';
import {createGeometryKernel,exportSTL,checkModelLibrarySTL} from '@brickwright/cad-geometry';
import {insertModelLibrarySource} from '../packages/geometry/src/model-library-insert.js';
import {createBundledModelLibrary} from '../apps/standalone/src/model-library-local.js';
const manifest=JSON.parse(readFileSync('library/editor-corpus-manifest.json','utf8'));
const raw=manifest.assets.find((a:any)=>a.id==='corpus-angelo-bricks');
let kernel:Awaited<ReturnType<typeof createGeometryKernel>>;
beforeAll(async()=>{kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});});
it('pins Bricks original and snapshot semantics while preserving all prior97 complete Angelo records',()=>{
 expect(createHash('sha256').update(JSON.stringify(manifest.assets.slice(0,97))).digest('hex')).toBe('1c4e1de1ea28475c545bd1d2a1b1bf5a20fbcb3b04dffca40779b2bbbc28d78a');
 expect(raw.original.sha256).toBe('97cd7d74ef9492d8f29bcbccc7cdd972f83818d48cf947e47f0ef62229355545');
 expect(readFileSync('library/'+raw.original.path)).toEqual(readFileSync('library/corpus/repos/AngeloNicoli--OpenSCAD-Snippet/Asset_SCAD/Bricks.scad'));
 expect(raw.licence.spdx).toBe('MIT');expect(raw.licence.attribution).toContain('Permission is hereby granted');expect(raw.modificationNotes).toContain('source-derived');expect(raw.modificationNotes).toContain('not an upstream random-sequence equivalence claim');
});
it('inserts the exact authored snapshot offline, verifies two bounded boxes analytically, and retains export/history identity',async()=>{
 const bundle=createBundledModelLibrary(),asset=bundle.catalogue.assets.find(a=>a.id===raw.id)!,session=createCadSession(),before=session.serialize();
 try{await insertModelLibrarySource(session,bundle.catalogue,{assetId:asset.id,file:'original'},bundle.localFiles.get(asset.original.path!)!,{sourceFiles:bundle.localFiles,evaluate:kernel.evaluate,modificationNotes:'Exact authored source; source-derived random snapshot and omitted appearance disclosed.'});
  const geometry=kernel.evaluate(session.state.document);expect(geometry.volume).toBeCloseTo(264.357610779193,7);
  const points:number[][]=[];for(const body of geometry.bodies)for(let i=0;i<body.positions.length;i+=3)points.push(Array.from(body.positions.slice(i,i+3)));
  const boxes=[points.filter(p=>p[0]<10),points.filter(p=>p[0]>=10)].map(list=>({min:[0,1,2].map(k=>Math.min(...list.map(p=>p[k]))),max:[0,1,2].map(k=>Math.max(...list.map(p=>p[k])))}));
  expect(boxes[0].min).toEqual([0,0,0]);expect(boxes[1].min).toEqual([10,0,0]);let volume=0;
  for(const box of boxes){const size=box.max.map((v,k)=>v-box.min[k]);for(const d of size.slice(0,2)){expect(d).toBeGreaterThanOrEqual(5);expect(d).toBeLessThanOrEqual(10);}expect(size[2]).toBe(3);volume+=size[0]*size[1]*size[2];}
  expect(geometry.volume).toBeCloseTo(volume,4);
  const mesh=exportSTL(geometry.bodies);expect(await sha256Hex(mesh)).toBe('0a405aa894512686e543462e230dee07406b5e81b0b306746f06391c481e0fe7');
  const screen=await checkModelLibrarySTL(mesh,{checkedOn:'2026-11-14',maxTriangles:10000,maxExtentMm:200,toMillimetresZUp:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]});expect(screen.triangles).toBe(24);expect(Object.values(screen.checks)).toEqual(['pass','pass','pass','pass']);
  const node=session.state.document.nodes[session.state.selection[0]];if(node.kind!=='code')throw Error('Expected editable code');expect(node.program.source).toContain('fixed in the imported snapshot');expect(node.program.parameters).toEqual({});
  const saved=session.serialize(),larger=structuredClone(node.program),marker=larger.source.lastIndexOf('\nreturn ');larger.source=larger.source.slice(0,marker)+`\nreturn scale([2,2,2], ${larger.source.slice(marker+8).trim().replace(/;$/,'')});\n`;
  session.updateCode(node.id,larger);expect(kernel.evaluate(session.state.document).volume).toBeCloseTo(8*geometry.volume,5);session.undo();expect(session.serialize()).toBe(saved);
  const invalid=structuredClone(node.program);invalid.source='return assertShape(false, box(1,1,1));';const state=session.state;expect(()=>session.updateCode(node.id,invalid)).toThrow(/assertion failed/i);expect(session.serialize()).toBe(saved);expect(session.state).toEqual(state);
  const restored=createCadSession(JSON.parse(saved));try{expect(restored.serialize()).toBe(saved);expect(await sha256Hex(exportSTL(kernel.evaluate(restored.state.document).bodies))).toBe(raw.derivatives[0].sha256);}finally{restored.dispose();}
  const sidecar=await createModelAttributionSidecar(session.state.document,{filename:'bricks.stl',format:'stl',bytes:mesh,modificationNotes:'Same imported random snapshot.'});expect(sidecar.records[0].asset.original).toEqual(asset.original);expect(sidecar.records[0].asset.modificationNotes).toContain('source-derived');
  session.undo();expect(session.serialize()).toBe(before);session.redo();expect(session.serialize()).toBe(saved);
 }finally{session.dispose();}
});
it('reproduces only Bricks geometry and hash-verifies the unchanged97 earlier source qualifications',()=>{
 expect(execFileSync(process.execPath,['scripts/generate-corpus-editor-library.mjs','--check','--asset-id',raw.id],{encoding:'utf8',timeout:15000})).toContain('99 selected corpus sources complete');
},16000);
