// SPDX-License-Identifier: BSD-3-Clause
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';

const report=JSON.parse(readFileSync('library/corpus-audit/editor-screening-cycle15.json','utf8'));
const manifest=JSON.parse(readFileSync('library/editor-corpus-manifest.json','utf8'));
const notice='Unbound animation time uses $t=0; motion is not retained.';

it('binds the four static-time observations to unchanged originals and fixed screening limits',()=>{
 expect(report.summary).toEqual({screened:4,qualified:3,noPrintableSolid:1,timeouts:0});
 expect(report.policy).toMatchObject({timeoutMs:5000,maxTriangles:10000,maxExtentMm:200});
 expect(report.results).toHaveLength(4);
 for(const result of report.results){
  const bytes=readFileSync(result.sourcePath);
  expect(bytes.length,result.sourcePath).toBe(result.sourceBytes);
  expect(createHash('sha256').update(bytes).digest('hex'),result.sourcePath).toBe(result.sourceSha256);
  expect(result.warnings).toContain(notice);expect(result.runtimeWarnings).toEqual([]);
 }
});

it('admits only the three screened static roots and excludes the non-printable default frame',()=>{
 let accepted=0;
 for(const result of report.results){
  const asset=manifest.assets.find((asset:any)=>'library/'+asset.corpusSelection.archivedPath===result.sourcePath);
  if(result.status==='qualified'){
   accepted++;expect(asset,result.sourcePath).toBeDefined();expect(asset.original.sha256).toBe(result.sourceSha256);
   expect(asset.derivatives[0].sha256).toBe(result.mesh.sha256);
   expect(Object.values(result.screening.checks)).toEqual(['pass','pass','pass','pass']);
   expect(asset.modificationNotes).toContain(notice);expect(asset.quality.physics).toBeUndefined();
  }else{
   expect(result.upstreamPath).toBe('Animation_SCAD/Spawing_Cube.scad');expect(asset).toBeUndefined();
   expect(result.error).toMatchObject({phase:'evaluate',message:'Code produces no printable solid'});
   expect(result.mesh).toBeUndefined();
  }
 }
 expect(accepted).toBe(3);
});
