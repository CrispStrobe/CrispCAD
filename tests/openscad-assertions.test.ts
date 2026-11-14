// SPDX-License-Identifier: BSD-3-Clause
import {beforeAll,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {compileCode,createCadSession,exportOpenSCAD,getOpenSCADImportWarnings,importOpenSCAD} from '@brickwright/cad-core';
import {createGeometryKernel} from '@brickwright/cad-geometry';
import type {GeometryKernel} from '@brickwright/cad-geometry';
let kernel:GeometryKernel;
beforeAll(async()=>{kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});});
function evaluate(source:string,parameters:Record<string,string>={}){const p=importOpenSCAD(source);p.parameters=parameters;const s=createCadSession();try{s.addCode(p);return kernel.evaluate(s.state.document);}finally{s.dispose();}}
function rejectsEdit(source:string){const p=importOpenSCAD(source);p.parameters={n:'-1'};expect(()=>compileCode(p)).toThrow(/assertion failed/i);}

it('supports standalone and child assertions in both solid and profile statements',()=>{
 expect(evaluate('assert(true);assert(1)cube(2);').volume).toBeCloseTo(8);
 expect(evaluate('linear_extrude(2){assert(true);assert(true)square(2);}').volume).toBeCloseTo(8);
 for(const source of ['cube(2);assert(false);','assert(false)cube(2);','linear_extrude(2){square(2);assert(false);}','linear_extrude(2)assert(false)square(2);'])expect(()=>importOpenSCAD(source)).toThrow(/assertion failed/i);
});

it('keeps standalone and prefix conditions live without silently dropping failing geometry',()=>{
 for(const source of ['n=2;cube(2);assert(n>0);','n=2;assert(n>0)cube(2);','n=2;linear_extrude(2){assert(n>0);square(2);}','n=2;linear_extrude(2)assert(n>0)square(2);'])rejectsEdit(source);
 const p=importOpenSCAD('n=2;assert(n>0)cube(n);'),session=createCadSession();
 try{const id=session.addCode(p),before=session.serialize();p.parameters={n:'-1'};expect(()=>session.updateCode(id,p)).toThrow(/assertion failed/i);expect(session.serialize()).toBe(before);}finally{session.dispose();}
});

it('retains chained expression assertions through nested numeric coordinate vectors and function calls',()=>{
 const source='n=2;function point(x)=assert(x>0)assert(x<10)[[x,2],3];v=point(n);cube([v[0][0],v[0][1],v[1]]);';
 expect(evaluate(source).volume).toBeCloseTo(12);expect(evaluate(source,{n:'3'}).volume).toBeCloseTo(18);rejectsEdit(source);
 expect(evaluate('n=2;function use(v)=v[0];cube(use(assert(n>0)[2,3]));').volume).toBeCloseTo(8);
 rejectsEdit('n=2;function unused(v)=2;cube(unused(assert(n>0)3));');
 rejectsEdit('n=2;module unused(v){cube(2);}unused(assert(n>0)3);');
});

it('preserves expression assertion checks through structural inspection and zero-sized geometry',()=>{
 for(const source of ['n=2;cube(len(assert(n>0)[1,2]));','n=2;cube(is_list(assert(n>0)[1,2])?2:1);','n=2;cube((assert(n>0)[1,2])==[1]?1:2);','n=2;cube([0,assert(n>0)2,1]);cube(1);'])rejectsEdit(source);
});

it('evaluates assertion guards lazily in symbolic branches',()=>{
 expect(evaluate('n=2;if(n>0)cube(2);else assert(false)cube(1);').volume).toBeCloseTo(8);
 rejectsEdit('n=2;if(n>0)cube(2);else assert(false)cube(1);');
 expect(evaluate('n=2;cube(n>0?assert(true)2:assert(false)3);').volume).toBeCloseTo(8);
 rejectsEdit('n=2;cube(n>0?assert(true)2:assert(false)3);');
 expect(evaluate('if(false)assert(false)unsupported();else cube(2);').volume).toBeCloseTo(8);
});

it('allows constant typed returns and archives literal diagnostic messages without source injection',()=>{
 expect(evaluate('color(assert(true)"red")cube(len(assert(true)[])+2);').volume).toBeCloseTo(8);
 const p=importOpenSCAD('assert(true,"a message");cube(2);');expect(p.source).toContain('a message');
 for(const source of ['n=2;color(assert(n>0)"red")cube(2);','n=2;cube(len(assert(n>0)[]));','assert()cube(2);','cube(assert(false)2);'])expect(()=>importOpenSCAD(source)).toThrow();
});

it('flattens bounded simple comprehension elements among literal list members and preserves coordinates',()=>{
 const source='w=2;points=[[0,0],for(i=[0:2])[[w,0],[w,w],[0,w]][i]];linear_extrude(2)polygon(points);';
 expect(evaluate(source).volume).toBeCloseTo(8);expect(evaluate(source,{w:'3'}).volume).toBeCloseTo(18);
 expect(evaluate('linear_extrude(1)polygon([[0,0],for(i=[3:-1:1])[[0,2],[2,2],[2,0]][i-1]]);').volume).toBeCloseTo(4);
 expect(()=>importOpenSCAD('v=['+Array(193).fill('0').join(',')+',for(i=[0:63])i];cube(len(v));')).toThrow('array limit');
 expect(()=>importOpenSCAD('v=[0,for(i=[0:255])i];cube(len(v));')).toThrow('array limit');
 expect(evaluate('v=[0,for(i=[0:2])if(i>0)i];cube(len(v));').volume).toBeCloseTo(27);
});

it('exports only a validated snapshot while retained native source still rechecks edits',()=>{
 const p=importOpenSCAD('n=2;assert(n>0)cube(n);');expect(evaluate(exportOpenSCAD(p)).volume).toBeCloseTo(8);p.parameters={n:'-1'};expect(()=>exportOpenSCAD(p)).toThrow(/assertion failed/i);
});


it('preserves conditional typed argument guards without checking an inactive branch',()=>{
 rejectsEdit('n=2;flag=1;function unused(v)=2;cube(unused(assert(n>0)(flag?[1]:[1,2])));');
 const source='n=2;flag=1;function unused(v)=2;cube(unused(flag?assert(n>0)[1]:assert(n<0)[1,2]));';
 expect(evaluate(source).volume).toBeCloseTo(8);expect(()=>evaluate(source,{flag:'0'})).toThrow(/assertion failed/i);
 rejectsEdit('n=2;flag=1;function unused(v)=2;cube(unused(assert(n>0)(flag?1:undef)));');
});


it('retains selected-branch guards after scalar and equal-length vector conditionals',()=>{
 for(const value of ['flag?assert(n>0)[1,2]:[3,4]','flag?[1,2]:assert(n<0)[3,4]']){
  const source='n=2;flag=1;v='+value+';cube(len(v));';
  expect(evaluate(source).volume).toBeCloseTo(8);
  expect(()=>evaluate(source,value.startsWith('flag?assert')?{n:'-1'}:{flag:'0'})).toThrow(/assertion failed/i);
 }
 rejectsEdit('n=2;flag=1;v=flag?assert(n>0)1:2;cube(is_num(v)?2:1);');
 rejectsEdit('n=2;v=+(assert(n>0)1);cube(is_num(v)?2:1);');
 rejectsEdit('n=2;flag=assert(n>0)1;cube(len(flag?[1,2]:[3,4]));');
});


it('checks asserted builtin arguments even when they are omitted or geometry becomes empty',()=>{
 for(const source of ['n=2;sphere(1,center=assert(n>0)true);','n=2;linear_extrude(1,convexity=assert(n>0)3)square(1);','n=2;linear_extrude(1)polygon(points=[[0,0],[1,0]],convexity=assert(n>0)3);cube(1);','n=2;linear_extrude(1)text("",spacing=assert(n>0)1);cube(1);'])rejectsEdit(source);
 rejectsEdit('n=2;children(assert(n>0)0);cube(1);');
 rejectsEdit('n=2;let(unused=assert(n>0)1)cube(1);');
 expect(()=>importOpenSCAD('n=2;echo(assert(n>0)1);cube(1);')).toThrow('assertion inside omitted echo');
 expect(()=>importOpenSCAD('n=2;v=[for(i=[assert(n>0)0])1];cube(len(v));')).toThrow('asserted comprehension input');
 const aliases=Array.from({length:20},(_,i)=>`p${i+1}=[p${i},p${i}];`).join('');
 expect(()=>importOpenSCAD('n=2;module p(){p0=[1];'+aliases+'v=assert(n>0)p20;cube(v[0][0][0][0][0][0][0][0][0][0][0][0][0][0][0][0][0][0][0][0]);}p();')).toThrow('construction limit');
});


it('refuses root selection that could bypass an enclosing assertion guard',()=>{
 for(const source of ['n=2;assert(n>0)!cube(2);','n=2;module p(v){!cube(2);}p(assert(n>0)1);','n=2;translate([assert(n>0)0,0,0])!cube(2);'])expect(()=>importOpenSCAD(source)).toThrow('assertions combined with root modifier');
 expect(evaluate('cube(3);!cube(2);').volume).toBeCloseTo(8);
});

it('ignores text center as a warned unknown argument while keeping its assertion guard',()=>{
 const omitted=evaluate('linear_extrude(2)text("A",size=10);');
 for(const center of ['true','false']){
  const result=evaluate(`linear_extrude(2)text("A",size=10,center=${center});`);
  expect(result.volume).toBeCloseTo(omitted.volume);expect(result.bodies[0].bounds).toEqual(omitted.bodies[0].bounds);
 }
 expect(getOpenSCADImportWarnings(importOpenSCAD('linear_extrude(2)text("A",center=true);')).join(' ')).toContain('are ignored');
 rejectsEdit('n=2;linear_extrude(1)text("A",center=assert(n>0)true);');
 expect(getOpenSCADImportWarnings(importOpenSCAD('linear_extrude(1)text("A",invented=1);')).join(' ')).toContain('invented');
});
