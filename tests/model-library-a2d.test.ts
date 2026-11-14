// SPDX-License-Identifier: BSD-3-Clause
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {expect,it} from 'vitest';
import {createLocalModelLibraryCatalogue,importOpenSCADBundle} from '@brickwright/cad-core';
import {checkModelLibrarySTL} from '../packages/geometry/src/model-library-quality.js';
const root=new URL('../',import.meta.url);
const read=(path:string)=>readFileSync(new URL(`library/${path}`,root));
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const manifest=JSON.parse(read('a2d-editor-manifest.json').toString());
const expected=[
 ['corpus-a2d-grill-square','c91720016f60ba9d343e4625a3212fe3ab1e5668395aee56fdf0d7452510c99b','9866b1c4ec3312bf5d21218837850531f5600de825638bbb6f7c431417079c94'],
 ['corpus-a2d-point-generators','5f4103ddc2fbab12be80258ef10b75aed85f4b293677322b9191e54005e0c424','0310fc106c49e0d52c1eff029988ad5eda6cde5578fd06c7ecd8192ecabdbf5e'],
];

it('retains only two qualified roots, one exact shared library, and independent pinned MIT grants',()=>{
 expect(manifest.selection).toMatchObject({count:2,runtimeChecked:2,complete:true});
 expect(manifest.assets.map((a:any)=>a.id)).toEqual(expected.map(a=>a[0]));
 const catalogue=createLocalModelLibraryCatalogue(manifest);
 expect(catalogue.assets).toHaveLength(2);
 const notice=read('evidence/a2d-MIT-LICENSE.txt').toString().replace(/\s+/g,' ').trim();
 expect(hash(read('evidence/a2d-MIT-LICENSE.txt'))).toBe('cefd2cb74a87f6cd6a31d7afeb3337f4e32849eaa487101e6006edd6f89f5421');
 for(const[index,asset]of manifest.assets.entries()){
  expect(asset.sourceRevision.commit).toBe('4ad48205fefd841a468b7916521596f09383add9');
  expect(asset.original.sha256).toBe(expected[index][1]);
  expect(asset.derivatives[0].sha256).toBe(expected[index][2]);
  expect(read(asset.original.path)).toEqual(read(asset.corpusSelection.archivedPath));
  expect(asset.licence.attribution).toContain(notice);
  expect(asset.sourceBundle).toMatchObject({format:'brickwright-openscad-bundle',version:1,rootPath:`Samples/${index?'PointGenerators':'GrillSquare'}.scad`});
  expect(asset.original.path).toBe('sources/a2d/'+asset.sourceBundle.rootPath);
  expect(asset.sourceBundle.dependencies).toHaveLength(1);
  const dependency=asset.sourceBundle.dependencies[0];
  expect(dependency.path).toBe('A2D.scad');
  expect(dependency.file.path).toBe('sources/a2d/A2D.scad');
  expect(dependency.file.sha256).toBe('aeed0958f859a675236d186753f54d5ceb45d823dab2b7077f935e82f227b516');
  expect(read(dependency.file.path)).toEqual(read('corpus/repos/ridercz--A2D/A2D.scad'));
  expect(dependency.licence).toMatchObject({spdx:'MIT',scope:'asset',review:'accepted'});
  expect(dependency.licence.attribution).toContain(notice);
  expect(dependency.sourceRevision).toEqual({repositoryUrl:'https://github.com/ridercz/A2D',commit:asset.sourceRevision.commit});
  for(const file of[asset.original,dependency.file,...asset.derivatives,...asset.licence.localEvidence]){
   const bytes=read(file.path);expect(bytes.length).toBe(file.bytes);expect(hash(bytes)).toBe(file.sha256);
  }
 }
});

it('reconstructs in-memory includes from independent originals and preserves their full provenance',async()=>{
 for(const asset of manifest.assets){
  const files=[{path:asset.sourceBundle.rootPath,source:read(asset.original.path).toString('utf8'),sha256:asset.original.sha256},...asset.sourceBundle.dependencies.map((d:any)=>({path:d.path,source:read(d.file.path).toString('utf8'),sha256:d.file.sha256}))];
  const result=await importOpenSCADBundle({version:1,rootPath:asset.sourceBundle.rootPath,files});
  expect(result.provenance).toEqual(asset.bundleProvenance);
  expect(result.provenance.files.map(f=>f.path)).toEqual([asset.sourceBundle.rootPath,'A2D.scad']);
  expect(result.provenance.includes.map(i=>[i.fromPath,i.path])).toEqual([[asset.sourceBundle.rootPath,'A2D.scad']]);
  for(const original of result.provenance.files)expect(hash(Buffer.from(original.source))).toBe(original.sha256);
  expect(asset.modificationNotes).toContain('Includes are expanded only in memory');
  expect(asset.modificationNotes).toContain('default root only');
  expect(asset.modificationNotes).toContain('Archived assertion-message text does not indicate an assertion failure');
 }
});

it('independently screens both unchanged meshes and checks authored dimensions and rounded-plate volume',async()=>{
 for(const asset of manifest.assets){
  const result=await checkModelLibrarySTL(read(asset.derivatives[0].path),{checkedOn:'2026-11-14',toMillimetresZUp:asset.conversion.toMillimetresZUp,maxTriangles:10000,maxExtentMm:200});
  expect(result.quality).toEqual(asset.quality);expect(Object.values(result.checks)).toEqual(['pass','pass','pass','pass']);expect(result.diagnostics).toEqual([]);expect(asset.quality.physics).toBeUndefined();
 }
 expect(manifest.assets[0].measurements.boundsMm).toEqual({min:[0,0,0],max:[150,50,2]});
 const points=manifest.assets[1];
 expect(points.measurements.boundsMm).toEqual({min:[-30,-20,0],max:[30,20,2]});
 // A 60×40 rounded rectangle (r6,32 facets) minus four r1.5 holes (16 facets), height2.
 const area=60*40-4*6**2+32/2*6**2*Math.sin(2*Math.PI/32)-4*16/2*1.5**2*Math.sin(2*Math.PI/16);
 expect(points.measurements.signedVolumeMm3).toBeCloseTo(2*area,3);
});

it('reproduces only the two admitted bundles and meshes without writes or external files',()=>{
 expect(execFileSync(process.execPath,['scripts/generate-a2d-editor-library.mjs','--check'],{cwd:fileURLToPath(root),encoding:'utf8',timeout:30000})).toContain('2 authored A2D roots reproduced');
});
