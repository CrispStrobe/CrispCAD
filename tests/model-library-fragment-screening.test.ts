// SPDX-License-Identifier: BSD-3-Clause
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {importOpenSCAD,createCadSession} from '@brickwright/cad-core';
import {createGeometryKernel,exportSTL,checkModelLibrarySTL} from '@brickwright/cad-geometry';

const report=JSON.parse(readFileSync('library/corpus-audit/editor-screening-cycle16.json','utf8'));

it('binds the withheld fragment-default demo to unchanged CC0 source and evidence',()=>{
 for(const record of [{path:report.result.sourcePath,sha256:report.result.sourceSha256,bytes:report.result.sourceBytes},report.licence.evidence]){
  const bytes=readFileSync(record.path);expect(bytes.length).toBe(record.bytes);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(record.sha256);
 }
 expect(report.licence.spdx).toBe('CC0-1.0');expect(report.policy.fragmentOverrides).toBeNull();expect(report.policy.sourceOverrides).toBeNull();
 expect(report.geometryReached).toBe(false);expect(report.stlProduced).toBe(false);
});

it('preserves the historical refusal while binding the explicitly reviewed authored default',async()=>{
 const session=createCadSession();try{session.addCode(importOpenSCAD(readFileSync(report.result.sourcePath,'utf8')));const kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')}),g=kernel.evaluate(session.state.document),screening=await checkModelLibrarySTL(exportSTL(g.bodies),{checkedOn:'2026-11-14',toMillimetresZUp:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],maxTriangles:10000,maxExtentMm:200});expect(g.triangles).toBe(5220);expect(g.volume).toBeCloseTo(31972.73095294236,5);expect(Object.values(screening.checks)).toEqual(['pass','pass','pass','pass']);expect(screening.fileSha256).toBe('4391dafaed2d22f011eb280d2c0124f658326f62babca82324e6da6391640d0d');}finally{session.dispose();}
 expect(report.result.error).toMatchObject({phase:'parse',code:'resource-limit',line:274});
 expect(report.guardDiagnostic).toMatchObject({guard:'constructionDepth',observed:33,maximum:32,constructionVisits:135,valueEvaluations:1157});
 const manifest=JSON.parse(readFileSync('library/editor-corpus-manifest.json','utf8'));
 const admitted=manifest.assets.find((asset:any)=>asset.id==='corpus-smooth-prim-authored-default');
 expect(admitted.original.sha256).toBe(report.result.sourceSha256);expect(admitted.derivatives[0].sha256).toBe('4391dafaed2d22f011eb280d2c0124f658326f62babca82324e6da6391640d0d');expect(admitted.licence.spdx).toBe('CC0-1.0');expect(admitted.quality.closedPositiveVolume).toBe(true);
 expect(manifest.selection.runtimeChecked).toBe(manifest.assets.length);
});
