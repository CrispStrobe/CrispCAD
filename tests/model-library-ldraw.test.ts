// SPDX-License-Identifier: BSD-3-Clause
import {beforeAll,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createCadSession,createLocalModelLibraryCatalogue,createModelAttributionSidecar,sha256Hex,validateModelLibraryCatalogue} from '@brickwright/cad-core';
import {createGeometryKernel,exportSTL,insertModelLibrarySTL,checkModelLibrarySTL} from '@brickwright/cad-geometry';
import {convertLDrawBundle} from '../scripts/lib/ldraw-model.mjs';
const raw=JSON.parse(readFileSync('library/ldraw-editor-manifest.json','utf8'));
const asset=raw.assets[0],catalogue=createLocalModelLibraryCatalogue(raw),identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
let kernel:Awaited<ReturnType<typeof createGeometryKernel>>;
beforeAll(async()=>{kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});});
it('retains one authored part and its complete exact per-file CC-BY-4.0 source closure',async()=>{
 expect(raw.assets).toHaveLength(1);expect(raw.selection.fixtures).toBe(0);expect(asset.sourceBundle.dependencies).toHaveLength(1);
 for(const f of [asset.original,...asset.sourceBundle.dependencies.map((d:any)=>d.file),...asset.derivatives,...asset.licence.localEvidence]){const bytes=readFileSync('library/'+f.path);expect(bytes.length).toBe(f.bytes);expect(await sha256Hex(bytes)).toBe(f.sha256);}
 expect(asset.original.sha256).toBe('a5b599ccc9e7979c4cc2bc72e2b4705eb1f5954c6a82d2761ce22063a3ea4e17');expect(asset.licence.spdx).toBe('CC-BY-4.0');expect(asset.licence.attribution).toContain('Tore Eriksson');expect(asset.licence.attribution).toContain('James Jessiman');expect(asset.conversion.sourceUnits).toBe('ldu');expect(asset.conversion.sourceUpAxis).toBe('-Y');
 for(const edit of [(a:any)=>a.sourceBundle.dependencies[0].licence.spdx='CC-BY-2.0',(a:any)=>a.sourceBundle.dependencies[0].file.bytes=32768,(a:any)=>a.sourceBundle.dependencies[0].path='../box5.dat',(a:any)=>a.sourceBundle.dependencies[0].file.format='openscad',(a:any)=>a.sourceBundle.format='unknown']){const value=structuredClone(catalogue);edit(value.assets[0]);expect(validateModelLibraryCatalogue(value).valid).toBe(false);}
});
it('converts reflected and inverted authored faces without repair and reproduces the screened mesh',async()=>{
 const files=[{path:asset.sourceBundle.rootPath,bytes:readFileSync('library/'+asset.original.path)},...asset.sourceBundle.dependencies.map((d:any)=>({path:d.path,bytes:readFileSync('library/'+d.file.path)}))];
 const result=convertLDrawBundle({rootPath:asset.sourceBundle.rootPath,files});expect(result.metrics).toMatchObject({originalBytes:1905,expandedBytes:2868,instances:3,points:16,faces:14});
 const session=createCadSession();try{session.addCode(result.program);const geometry=kernel.evaluate(session.state.document),mesh=exportSTL(geometry.bodies);expect(geometry.volume).toBeCloseTo(2195.456,3);expect(await sha256Hex(mesh)).toBe(asset.derivatives[0].sha256);const screen=await checkModelLibrarySTL(mesh,{checkedOn:'2026-11-15',toMillimetresZUp:identity,maxTriangles:10000,maxExtentMm:200});expect(screen.triangles).toBe(28);expect(Object.values(screen.checks)).toEqual(['pass','pass','pass','pass']);}finally{session.dispose();}
 for(const change of [(f:any[])=>f.pop(),(f:any[])=>f[0].bytes=Buffer.from(f[0].bytes.toString().replace('0 BFC CERTIFY CCW','0 BFC NOCERTIFY')),(f:any[])=>f[0].bytes=Buffer.from(f[0].bytes.toString().replace('1 16 0 8 0','1 16 NaN 8 0'))]){const copy=files.map(f=>({...f,bytes:Buffer.from(f.bytes)}));change(copy);expect(()=>convertLDrawBundle({rootPath:asset.sourceBundle.rootPath,files:copy})).toThrow();}
});
it('inserts exact STL offline with full provenance/history and refuses mismatched bytes before evaluation',async()=>{
 const bytes=readFileSync('library/'+asset.derivatives[0].path),selection={assetId:asset.id,file:{derivative:0}} as const,options={evaluate:kernel.evaluate,toMillimetresZUp:identity,checkedOn:'2026-11-15',modificationNotes:'Exact authored LDraw tile; nominal unit/axis conversion, no manual edits.'};
 const session=createCadSession();session.rename('Retained redo');session.undo();const before=session.serialize(),state=session.state;let evaluations=0;
 const corrupt=Buffer.from(bytes);corrupt[100]^=1;
 await expect(insertModelLibrarySTL(session,catalogue,selection,corrupt,{...options,evaluate:doc=>{evaluations++;return kernel.evaluate(doc);}})).rejects.toThrow('SHA-256 mismatch');expect(evaluations).toBe(0);expect(session.serialize()).toBe(before);expect(session.state).toEqual(state);
 await insertModelLibrarySTL(session,catalogue,selection,bytes,options);const saved=session.serialize(),geometry=kernel.evaluate(session.state.document);expect(geometry.volume).toBeCloseTo(2195.456,3);expect(session.state.document.provenance!.records[0].asset.sourceBundle!.format).toBe('brickwright-ldraw-bundle');
 const restored=createCadSession(JSON.parse(saved));try{expect(restored.serialize()).toBe(saved);expect(kernel.evaluate(restored.state.document).volume).toBeCloseTo(geometry.volume,5);}finally{restored.dispose();}
 const sidecar=await createModelAttributionSidecar(session.state.document,{filename:'tile.stl',format:'stl',bytes:exportSTL(geometry.bodies),modificationNotes:'Exact retained tile.'});expect(sidecar.records[0].asset.licence.spdx).toBe('CC-BY-4.0');expect(sidecar.records[0].asset.sourceBundle!.dependencies[0].author).toBe('James Jessiman');
 session.undo();expect(session.serialize()).toBe(before);session.redo();expect(session.serialize()).toBe(saved);session.dispose();
});
