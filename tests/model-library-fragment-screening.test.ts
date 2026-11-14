// SPDX-License-Identifier: BSD-3-Clause
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {importOpenSCAD} from '@brickwright/cad-core';

const report=JSON.parse(readFileSync('library/corpus-audit/editor-screening-cycle16.json','utf8'));

it('binds the withheld fragment-default demo to unchanged CC0 source and evidence',()=>{
 for(const record of [{path:report.result.sourcePath,sha256:report.result.sourceSha256,bytes:report.result.sourceBytes},report.licence.evidence]){
  const bytes=readFileSync(record.path);expect(bytes.length).toBe(record.bytes);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(record.sha256);
 }
 expect(report.licence.spdx).toBe('CC0-1.0');expect(report.policy.fragmentOverrides).toBeNull();expect(report.policy.sourceOverrides).toBeNull();
 expect(report.geometryReached).toBe(false);expect(report.stlProduced).toBe(false);
});

it('retains the actual depth refusal without treating conversion progress as admission',()=>{
 try{importOpenSCAD(readFileSync(report.result.sourcePath,'utf8'));throw Error('Expected resource limit');}
 catch(error:any){expect(error.code).toBe('resource-limit');expect(error.detail).toBe('OpenSCAD construction nesting exceeds 32');expect(error.line).toBe(274);}
 expect(report.result.error).toMatchObject({phase:'parse',code:'resource-limit',line:274});
 expect(report.guardDiagnostic).toMatchObject({guard:'constructionDepth',observed:33,maximum:32,constructionVisits:135,valueEvaluations:1157});
 const manifest=JSON.parse(readFileSync('library/editor-corpus-manifest.json','utf8'));
 expect(manifest.assets.some((asset:any)=>asset.corpusSelection.repositoryId==='smooth-prim')).toBe(false);
 expect(manifest.selection.runtimeChecked).toBe(96);
});
