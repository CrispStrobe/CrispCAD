// SPDX-License-Identifier: BSD-3-Clause
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';

const report=JSON.parse(readFileSync('library/corpus-audit/editor-screening-cycle13.json','utf8'));
const manifest=JSON.parse(readFileSync('library/editor-corpus-manifest.json','utf8'));
const latest=new Map<string,any>();
for(const phase of report.phases)for(const result of phase.results)latest.set(result.sourcePath,result);

it('binds every bounded screening observation to byte-identical archived source',()=>{
 expect(report.policy).toMatchObject({timeoutMs:5000,maxTriangles:10000,maxExtentMm:200});
 expect(latest.size).toBe(17);
 for(const phase of report.phases)for(const result of phase.results){
  const bytes=readFileSync(result.sourcePath);
  expect(bytes.length,result.sourcePath).toBe(result.sourceBytes);
  expect(createHash('sha256').update(bytes).digest('hex'),result.sourcePath).toBe(result.sourceSha256);
 }
});

it('admits only the twelve passing candidates and keeps topology and language failures separate',()=>{
 expect(report.summary).toEqual({distinctCandidates:17,qualified:12,topologyFailed:3,unsupported:2});
 const failed:string[]=[],unsupported:string[]=[];let qualified=0;
 for(const [path,result] of latest){
  const asset=manifest.assets.find((asset:any)=>'library/'+asset.corpusSelection.archivedPath===path);
  if(result.status==='qualified'){
   qualified++;expect(asset,path).toBeDefined();expect(asset.original.sha256).toBe(result.sourceSha256);
   expect(asset.derivatives[0].sha256).toBe(result.mesh.sha256);
   expect(Object.values(result.screening.checks)).toEqual(['pass','pass','pass','pass']);
  }else{
   expect(asset,path).toBeUndefined();
   if(result.status==='screen-failed'){failed.push(path.split('/').pop()!);expect(result.screening.checks.closedPositiveVolume).toBe('fail');}
   else{unsupported.push(path.split('/').pop()!);expect(result.error.code).toBe('unsupported-feature');}
  }
 }
 expect(qualified).toBe(12);
 expect(failed.sort()).toEqual(['Display_Seven_Segments.scad','Grid_01.scad','Hexagon_socket_screw_keys.scad']);
 expect(unsupported.sort()).toEqual(['Mech_Piece_03.scad','Mech_Piece_04.scad']);
});
