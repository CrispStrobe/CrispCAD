// SPDX-License-Identifier: BSD-3-Clause
import {beforeAll,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createCadSession,createLocalModelLibraryCatalogue,getOpenSCADImportWarnings,importOpenSCAD,sha256Hex} from '@brickwright/cad-core';
import {createGeometryKernel,insertModelLibrarySource} from '@brickwright/cad-geometry';
import type {GeometryKernel} from '@brickwright/cad-geometry';

const notice='Unbound animation time uses $t=0; motion is not retained.';
let kernel:GeometryKernel;
beforeAll(async()=>{kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});});
function evaluate(source:string){
 const program=importOpenSCAD(source),session=createCadSession();
 try{session.addCode(program);return {program,result:kernel.evaluate(session.state.document)};}finally{session.dispose();}
}
const animation='rotate([0,0,$t*360])cube([2,1,1]);';

it('discloses actual unbound time reads and retains the authored zero-frame geometry',()=>{
 const {program,result}=evaluate(animation);
 expect(result.volume).toBeCloseTo(2);expect(result.bodies[0].bounds).toEqual({min:[0,0,0],max:[2,1,1]});
 expect(getOpenSCADImportWarnings(program)).toContain(notice);
 expect(getOpenSCADImportWarnings(importOpenSCAD('cube([1+$t,1+$t,1]);')).filter(w=>w===notice)).toHaveLength(1);
});

it('honours global, lexical, module and transform overrides without falsely claiming zero time',()=>{
 const quarterTurn=[
  '$t=.25;'+animation,
  'module part(){$t=.25;'+animation+'}part();',
  'module part(){'+animation+'}part($t=.25);',
  'module inner(){'+animation+'}module outer($t=.25){inner();}outer();',
  'module part(){'+animation+'}translate([0,0,0],$t=.25)part();',
 ];
 for(const source of quarterTurn){const {program,result}=evaluate(source);expect(getOpenSCADImportWarnings(program),source).not.toContain(notice);[-1,0,0].forEach((n,i)=>expect(result.bodies[0].bounds.min[i],source).toBeCloseTo(n,10));[0,2,1].forEach((n,i)=>expect(result.bodies[0].bounds.max[i],source).toBeCloseTo(n,10));}
 expect(getOpenSCADImportWarnings(importOpenSCAD('$t=undef;if(is_undef($t))cube(2);'))).not.toContain(notice);
});

it('does not warn for unread definitions, dead branches, strings or comments',()=>{
 for(const source of [
  'module unused(){'+animation+'}cube(2);',
  'function unused()=$t;cube(2);',
  'if(false){'+animation+'}else cube(2);',
  'cube(false?$t:2);',
  '// $t is only a comment\ncube(2);',
  'echo("$t is only text");cube(2);',
 ])expect(getOpenSCADImportWarnings(importOpenSCAD(source)),source).not.toContain(notice);
});

it('describes only the unbound portion of a mixed-time source',()=>{
 const {program,result}=evaluate('module part(){'+animation+'}part();translate([5,0,0])part($t=.25);');
 expect(result.volume).toBeCloseTo(4);expect(getOpenSCADImportWarnings(program).filter(w=>w===notice)).toHaveLength(1);
 [5,2,1].forEach((n,i)=>expect(result.bodies[0].bounds.max[i]).toBeCloseTo(n,10));
 expect(program.source).not.toContain('$t = 0;');
});

it('keeps the fallback notice scoped to its source provenance through insertion',async()=>{
 const base=createLocalModelLibraryCatalogue(JSON.parse(readFileSync('library/examples-manifest.json','utf8'))),session=createCadSession();
 try{for(const [i,source] of [animation,'$t=.25;'+animation].entries()){
  const bytes=new TextEncoder().encode(source),asset=structuredClone(base.assets[0]),digest=await sha256Hex(bytes);
  asset.id=`animation-context-fixture-${i}`;asset.title='Synthetic animation-context test';asset.sourceUrl='https://example.com/animation-context-test.scad';delete asset.sourceRevision;delete asset.quality;asset.derivatives=[];
  asset.original={path:`sources/animation-context-fixture-${i}.scad`,format:'openscad',bytes:bytes.length,sha256:digest};
  const previous=structuredClone(session.state.document.provenance?.records??[]);
  await insertModelLibrarySource(session,{...base,assets:[asset]},{assetId:asset.id,file:'original'},bytes,{evaluate:kernel.evaluate,modificationNotes:'Synthetic test source imported without placement or source changes.'});
  const records=session.state.document.provenance!.records,record=records.find(r=>r.selectedFile.sha256===digest)!;
  expect(record.selectedFile).toEqual(asset.original);expect(record.modificationNotes.includes(notice)).toBe(i===0);
  for(const prior of previous)expect(records.find(r=>r.id===prior.id)).toEqual(prior);
 }}finally{session.dispose();}
});
