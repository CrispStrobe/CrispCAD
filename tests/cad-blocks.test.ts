// SPDX-License-Identifier: BSD-3-Clause
import {beforeAll,describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {compileBlocksToCadScript,exportBlocksOpenSCAD,exportBlocksJSCAD,importOpenSCAD,createCadSession,compileCode,CadBlocksError,BLOCK_SHAPES} from '@brickwright/cad-core';
import type {CadBlocksProgram,BlockStmt,BlockExpr,BlockParam,BlockShapeKind} from '@brickwright/cad-core';
import {createGeometryKernel} from '@brickwright/cad-geometry';
import type {GeometryKernel} from '@brickwright/cad-geometry';

// @jscad/modeling is a test-only reference: the generated JSCAD runs on the real library.
const require=createRequire(import.meta.url);
const jscad=require('@jscad/modeling');
let kernel:GeometryKernel;
beforeAll(async()=>{kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});});

const n=(v:number):BlockExpr=>({k:'num',v});
const v=(name:string):BlockExpr=>({k:'var',name});
const o=(op:'+'|'-'|'*'|'/'|'%'|'<'|'>'|'=='|'&&',a:BlockExpr,b:BlockExpr):BlockExpr=>({k:'op',op,a,b});
const shape=(kind:BlockShapeKind,args:Record<string,BlockExpr|number>={},text?:string):BlockStmt=>({k:'shape',shape:kind,args:Object.fromEntries(Object.entries(args).map(([key,val])=>[key,typeof val==='number'?n(val):val])),...(text?{text}:{})});
const box=(w:BlockExpr|number=10,d:BlockExpr|number=10,h:BlockExpr|number=10)=>shape('box',{width:w,depth:d,height:h});
const move=(x:BlockExpr|number,y:BlockExpr|number,z:BlockExpr|number,...body:BlockStmt[]):BlockStmt=>({k:'move',x:typeof x==='number'?n(x):x,y:typeof y==='number'?n(y):y,z:typeof z==='number'?n(z):z,body});
const program=(body:BlockStmt[],params:BlockParam[]=[]):CadBlocksProgram=>({version:1,format:'brickwright-cad-blocks',name:'Test',params,body});

interface Measure {volume:number;size:number[]}
function viaCad(p:CadBlocksProgram):Measure{
 const s=createCadSession();s.addCode(compileBlocksToCadScript(p).program);const r=kernel.evaluate(s.state.document);
 const b=r.bodies[0].bounds;return {volume:r.volume,size:[0,1,2].map(i=>b.max[i]-b.min[i])};
}
function viaScad(p:CadBlocksProgram):Measure{
 const s=createCadSession();s.addCode(importOpenSCAD(exportBlocksOpenSCAD(p)));const r=kernel.evaluate(s.state.document);
 const b=r.bodies[0].bounds;return {volume:r.volume,size:[0,1,2].map(i=>b.max[i]-b.min[i])};
}
function runJscad(source:string,params?:Record<string,number>){
 const module:{exports:{main?:(p?:Record<string,number>)=>unknown;getParameterDefinitions?:()=>unknown[]}}={exports:{}};
 new Function('require','module',source)((id:string)=>{if(id!=='@jscad/modeling')throw new Error(id);return jscad;},module);
 return module.exports;
}
function viaJscad(p:CadBlocksProgram,params?:Record<string,number>):Measure{
 const geometry=runJscad(exportBlocksJSCAD(p)).main!(params);
 const [min,max]=jscad.measurements.measureBoundingBox(geometry);
 return {volume:jscad.measurements.measureVolume(geometry),size:[0,1,2].map(i=>max[i]-min[i])};
}
/** All three targets agree with each other, and with an expected value when given. */
function agree(p:CadBlocksProgram,expected?:Partial<Measure>,tolerance=0.002){
 const all={cad:viaCad(p),scad:viaScad(p),jscad:viaJscad(p)};
 const ref=expected?.volume??all.cad.volume;
 for(const [target,m] of Object.entries(all)){
  expect(Math.abs(m.volume-ref)/ref,`${target} volume ${m.volume} vs ${ref}`).toBeLessThan(tolerance);
  (expected?.size??all.cad.size).forEach((size,i)=>expect(Math.abs(m.size[i]-size),`${target} size ${i}: ${m.size} vs ${expected?.size??all.cad.size}`).toBeLessThan(Math.max(1e-6,size*tolerance)));
 }
 return all;
}

describe('shapes',()=>{
 it('builds exact boxes and boolean groups identically in all three targets',()=>{
  agree(program([box(10,20,30)]),{volume:6000,size:[10,20,30]});
  agree(program([{k:'subtract',body:[box(20,20,20)],cutters:[box(10,10,40)]}]),{volume:8000-2000,size:[20,20,20]});
  agree(program([{k:'intersect',body:[box(20,20,20),move(10,0,0,box(20,20,20))]}]),{volume:4000,size:[10,20,20]});
  agree(program([{k:'mirror',axis:'x',body:[move(5,0,0,box(10,2,2))]}]),{volume:40,size:[10,2,2]});
  agree(program([{k:'scale',x:n(2),y:n(-1),z:n(.5),body:[box(10,10,10)]}]),{volume:1000,size:[20,10,5]});
  agree(program([{k:'rotate',x:n(0),y:n(0),z:n(90),body:[box(10,20,30)]}]),{volume:6000,size:[20,10,30]});
  agree(program([{k:'hull',body:[box(2,2,2),move(10,0,0,box(2,2,2))]}]),{volume:2*2*12,size:[12,2,2]});
 });
 it.each(Object.keys(BLOCK_SHAPES).filter(k=>k!=='text'))('%s agrees across CAD Script, OpenSCAD and JSCAD',kind=>{
  agree(program([shape(kind as BlockShapeKind)]),undefined,0.02);
 });
 it('matches analytic sizes for the centred shape conventions',()=>{
  expect(viaCad(program([shape('pyramid',{width:20,height:10})])).size.map(x=>+x.toFixed(6))).toEqual([20,20,10]);
  expect(viaCad(program([shape('wedge',{width:20,depth:10,height:5})])).volume).toBeCloseTo(500,6);
  expect(viaCad(program([shape('roof',{width:20,depth:10,height:5})])).size.map(x=>+x.toFixed(6))).toEqual([20,10,5]);
  expect(viaCad(program([shape('tube',{radius:10,wall:2,height:10,sides:256})])).volume).toBeCloseTo(Math.PI*(100-64)*10,-1);
  expect(viaCad(program([shape('halfSphere',{radius:10,sides:96})])).size[2]).toBeCloseTo(10,6);
  expect(viaCad(program([shape('star',{points:5,radius:10,inner:4,height:2})])).size[2]).toBeCloseTo(2,9);
 });
 it('keeps text parametric in CAD Script and OpenSCAD and refuses a lossy JSCAD export',()=>{
  const p=program([shape('text',{size:10,height:3},'Hi')]);
  expect(compileBlocksToCadScript(p).source).toContain('text2d("Hi", 10, "sans", "center", "center"');
  expect(exportBlocksOpenSCAD(p)).toContain('text("Hi", size = 10, halign = "center", valign = "center")');
  expect(viaCad(p).size[2]).toBeCloseTo(3,9);
  expect(()=>exportBlocksJSCAD(p)).toThrow(CadBlocksError);
 });
});

describe('parameters and variables',()=>{
 it('exports parameters as editable CAD Script params, OpenSCAD Customizer variables and JSCAD definitions',()=>{
  const p=program([box(v('width'),v('width'),2)],[{name:'width',value:20,min:5,max:50,step:1}]);
  const cad=compileBlocksToCadScript(p);
  expect(cad.source).toContain('param width: scalar = 20;');
  expect(exportBlocksOpenSCAD(p)).toContain('width = 20; // [5:1:50]');
  const js=runJscad(exportBlocksJSCAD(p));
  expect(js.getParameterDefinitions!()).toEqual([{name:'width',type:'slider',initial:20,min:5,max:50,step:1,caption:'width'}]);
  expect(viaJscad(p,{width:30}).volume).toBeCloseTo(1800,6);
  const program2={...cad.program,parameters:{width:'30'}};
  expect(compileCode(program2).values.width.value).toBe(30);
 });
 it('sanitizes names for all languages and keeps them collision-free',()=>{
  const p=program([{k:'set',name:'Breite (mm)',value:n(4)},{k:'set',name:'cube',value:n(5)},{k:'set',name:'Breite_mm',value:n(6)},
   box(v('Breite (mm)'),v('cube'),v('Breite_mm'))],[{name:'größe',value:3}]);
  const source=compileBlocksToCadScript(p).source;
  expect(source).toContain('param groesse: scalar = 3; // größe');
  expect(source).toContain('const Breite_mm = 4;');expect(source).toContain('const cube_v = 5;');expect(source).toContain('const Breite_mm_2 = 6;');
  agree(p,{volume:120});
 });
 it('turns sequential set/change into named single-assignment formulas',()=>{
  const p=program([{k:'set',name:'x',value:n(2)},{k:'change',name:'x',by:v('w')},box(v('x'),1,1)],[{name:'w',value:3}]);
  const source=compileBlocksToCadScript(p).source;
  expect(source).toContain('const x = 2;');expect(source).toContain('const x_2 = x + w;');
  agree(p,{volume:5});
 });
 it('refuses reading undefined variables, with the block id',()=>{
  const p=program([{k:'shape',shape:'box',id:'blk7',args:{width:v('nope')}}]);
  try{compileBlocksToCadScript(p);throw new Error('expected failure');}catch(error){expect(error).toBeInstanceOf(CadBlocksError);expect((error as CadBlocksError).blockId).toBe('blk7');}
 });
 it('fixes random values at compile time, reproducibly by seed',()=>{
  const p=program([box({k:'random',min:n(1),max:n(10),seed:'a'},1,1)]);
  const first=compileBlocksToCadScript(p).source;expect(compileBlocksToCadScript(p).source).toBe(first);
  const value=Number(/box\((\d+), 1, 1\)/.exec(first)![1]);expect(Number.isInteger(value)&&value>=1&&value<=10).toBe(true);
  expect(()=>compileBlocksToCadScript(program([box({k:'random',min:n(1),max:v('w')},1,1)],[{name:'w',value:3}]))).toThrow(/fixed limits/);
 });
});

describe('control flow',()=>{
 const row=(count:BlockExpr):BlockStmt[]=>[{k:'set',name:'x',value:n(0)},{k:'repeat',count,body:[move(v('x'),0,0,box(5,5,5)),{k:'change',name:'x',by:n(10)}]}];
 it('turns a TinkerCAD-style accumulator loop into a closed formula',()=>{
  const p=program(row(v('n')),[{name:'n',value:4}]);
  const source=compileBlocksToCadScript(p).source;
  expect(source).toContain('forRange(k, 0, round(n) - 1, 1,');expect(source).toContain('const x_2 = x + k * 10;');
  agree(p,{volume:4*125,size:[35,5,5]});
  expect(viaJscad(p,{n:2}).size[0]).toBeCloseTo(15,9);
  agree(program(row(n(0)).concat([box(1,1,1)])),{volume:1});
 });
 it('uses the value after a loop and through nested loops',()=>{
  const p=program([{k:'set',name:'x',value:n(0)},
   {k:'repeat',count:n(3),body:[{k:'repeat',count:n(2),body:[{k:'change',name:'x',by:n(1)}]}]},box(v('x'),1,1)]);
  agree(p,{volume:6});
 });
 it('counts with an inclusive, directed range and its counter',()=>{
  const p=program([{k:'for',var:'i',from:n(1),to:n(4),body:[move(o('*',v('i'),n(10)),0,0,box(2,2,2))]}]);
  agree(p,{volume:32,size:[32,2,2]});
  agree(program([{k:'for',var:'i',from:n(4),to:n(1),step:n(-1),body:[move(o('*',v('i'),n(10)),0,0,box(2,2,2))]}]),{volume:32,size:[32,2,2]});
  agree(program([{k:'for',var:'i',from:n(0),to:n(1),step:n(.25),body:[move(o('*',v('i'),n(40)),0,0,box(2,2,2))]}]),{volume:40,size:[42,2,2]});
 });
 it('selects branches with if/else and merges variables set in both',()=>{
  const p=(flag:number)=>program([{k:'if',cond:o('>',v('f'),n(0)),then:[box(10,1,1),{k:'set',name:'w',value:n(4)}],else:[box(1,1,1),{k:'set',name:'w',value:n(2)}]},
   move(20,0,0,box(v('w'),1,1))],[{name:'f',value:flag}]);
  agree(p(1),{volume:14});agree(p(0),{volume:3});
  expect(compileBlocksToCadScript(p(1)).source).toContain('const w_3 = f > 0 ? w : w_2;');
 });
 it('evaluates conditions per loop iteration',()=>{
  const p=program([{k:'for',var:'i',from:n(0),to:n(5),body:[{k:'if',cond:o('==',o('%',v('i'),n(2)),n(0)),then:[move(o('*',v('i'),n(4)),0,0,box(2,2,2))]}]}]);
  agree(p,{volume:24});
 });
 it('refuses loop variables that cannot become formulas instead of guessing',()=>{
  const conditional=program([{k:'set',name:'x',value:n(0)},{k:'repeat',count:n(3),body:[{k:'if',cond:o('>',v('x'),n(1)),then:[{k:'change',name:'x',by:n(1)}]}]}]);
  expect(()=>compileBlocksToCadScript(conditional)).toThrow(/cannot become a formula/);
  const carried=program([{k:'set',name:'x',value:n(1)},{k:'repeat',count:n(3),body:[box(v('x'),1,1),{k:'set',name:'x',value:o('*',v('x'),n(2))}]}]);
  expect(()=>compileBlocksToCadScript(carried)).toThrow(/cannot become a formula/);
  const afterLoop=program([{k:'repeat',count:n(3),body:[{k:'set',name:'y',value:n(2)}]},box(v('y'),1,1)]);
  expect(()=>compileBlocksToCadScript(afterLoop)).toThrow(/set inside a loop/);
  const counter=program([{k:'for',var:'i',from:n(0),to:n(2),body:[{k:'change',name:'i',by:n(1)}]}]);
  expect(()=>compileBlocksToCadScript(counter)).toThrow(/loop counter/);
  const variant=program([{k:'set',name:'x',value:n(0)},{k:'for',var:'i',from:n(0),to:n(2),body:[{k:'change',name:'x',by:v('i')}]}]);
  expect(()=>compileBlocksToCadScript(variant)).toThrow(/cannot become a formula/);
 });
 it('allows iteration-local variables that are set before use',()=>{
  const p=program([{k:'for',var:'i',from:n(1),to:n(3),body:[{k:'set',name:'s',value:o('*',v('i'),n(2))},move(o('*',v('i'),n(20)),0,0,box(v('s'),1,1))]}]);
  agree(p,{volume:2+4+6});
 });
});

describe('validation',()=>{
 it('refuses malformed or oversized programs',()=>{
  for(const bad of [null,{},{version:2,format:'brickwright-cad-blocks',params:[],body:[]},
   {version:1,format:'brickwright-cad-blocks',params:[],body:[{k:'eval'}]},
   {version:1,format:'brickwright-cad-blocks',params:[],body:[{k:'shape',shape:'constructor'}]},
   {version:1,format:'brickwright-cad-blocks',params:[],body:[{k:'shape',shape:'box',args:{colour:{k:'num',v:1}}}]},
   {version:1,format:'brickwright-cad-blocks',params:[],body:[{k:'shape',shape:'box',args:{width:{k:'num',v:Infinity}}}]},
   {version:1,format:'brickwright-cad-blocks',params:[{name:'a',value:1},{name:'a',value:2}],body:[]},
   {version:1,format:'brickwright-cad-blocks',params:[],body:Array.from({length:5000},()=>({k:'comment',text:''}))}])
   expect(()=>compileBlocksToCadScript(bad as CadBlocksProgram)).toThrow(CadBlocksError);
  expect(()=>compileBlocksToCadScript(program([shape('star',{points:v('p')})],[{name:'p',value:5}]))).toThrow(/whole number/);
  expect(()=>compileBlocksToCadScript(program([{k:'for',var:'i',from:n(0),to:n(3),step:n(0),body:[]}]))).toThrow(/zero/);
 });
 it('produces an empty-but-valid OpenSCAD and JSCAD file for an empty program',()=>{
  expect(exportBlocksOpenSCAD(program([]))).toContain('generated from blocks');
  expect(jscad.geometries.geom3.toPolygons(runJscad(exportBlocksJSCAD(program([]))).main!())).toEqual([]);
 });
});

describe('localization',()=>{
 it('reports block diagnostics in German with the user value intact',async()=>{
  const {setLocale}=await import('@brickwright/cad-core');
  setLocale('de');
  try{expect(()=>compileBlocksToCadScript(program([box(v('Höhe'),1,1)]))).toThrow('Variable Höhe wird verwendet, bevor sie gesetzt wurde.');}
  finally{setLocale('en');}
 });
});

describe('MCP',()=>{
 it('compiles block programs through cad_compile_blocks without touching the model',async()=>{
  const {createCodeHost}=await import('../apps/mcp/host.mjs');
  const host=await createCodeHost({});
  try{
   const p=program([box(v('w'),5,5)],[{name:'w',value:8}]);
   const cad=await host.call('cad_compile_blocks',{program:JSON.stringify(p),outputFormat:'cadcode'});
   expect(cad.source).toContain('param w: scalar = 8;');expect(cad.parameters.w).toBeDefined();
   expect((await host.call('cad_compile_blocks',{program:JSON.stringify(p),outputFormat:'openscad'})).source).toContain('cube([w, 5, 5], center = true);');
   await expect(host.call('cad_compile_blocks',{program:'{nope',outputFormat:'jscad'})).rejects.toThrow(/not valid JSON/);
   expect((await host.call('cad_get_model')).objects).toHaveLength(0);
  }finally{await host.dispose();}
 });
});

describe('holes',()=>{
 const cyl=(r=2,h=40):BlockStmt=>shape('cylinder',{radius:r,height:h,sides:64});
 it('cuts every solid of the model like TinkerCAD holes, through moves',()=>{
  const withHole=program([box(20,20,4),move(5,0,0,{k:'hole',body:[box(4,4,10)]})]);
  agree(withHole,{volume:1600-64,size:[20,20,4]});
 });
 it('repeats holes through loops and keeps solids from the same loop',()=>{
  const p=program([{k:'set',name:'x',value:n(-15)},box(40,10,4),
   {k:'repeat',count:v('n'),body:[move(v('x'),0,0,{k:'hole',body:[box(2,2,10)]},move(0,0,4,box(2,2,4))),{k:'change',name:'x',by:n(10)}]}],[{name:'n',value:4}]);
  // The 10 mm holes also trim 3 mm off each peg: holes cut every solid of their group.
  agree(p,{volume:1600-4*16+4*(16-12),size:[40,10,8]});
  const source=compileBlocksToCadScript(p).source;
  expect(source.match(/forRange/g)).toHaveLength(2);expect(source.match(/const x_2 =/g)).toHaveLength(1);
 });
 it('stops at group boundaries and applies to intersect and hull results',()=>{
  // The group's hole cuts only the group; the later box stays whole.
  const grouped=program([{k:'group',body:[box(10,10,10),{k:'hole',body:[box(4,4,20)]}]},move(20,0,0,box(10,10,10))]);
  agree(grouped,{volume:1000-160+1000});
  const hulled=program([{k:'hull',body:[box(2,2,2),move(10,0,0,box(2,2,2)),{k:'hole',body:[move(5,0,0,box(2,4,4))]}]}]);
  agree(hulled,{volume:48-8});
 });
 it('selects holes inside if/else per branch',()=>{
  const p=(flag:number)=>program([box(10,10,2),{k:'if',cond:o('>',v('f'),n(0)),then:[{k:'hole',body:[cyl(2)]}],else:[move(0,0,2,box(2,2,2))]}],[{name:'f',value:flag}]);
  expect(viaCad(p(1)).volume).toBeLessThan(200);agree(p(1));agree(p(0),{volume:208});
 });
});
