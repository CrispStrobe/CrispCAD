// SPDX-License-Identifier: BSD-3-Clause
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {beforeAll,expect,it} from 'vitest';
import {createCadSession} from '../packages/core/src/index.js';
import {importOpenSCADBundle} from '../packages/core/src/openscad-bundle.js';
import {createGeometryKernel,exportSTL,checkModelLibrarySTL} from '../packages/geometry/src/index.js';
const file=(path:string,source:string)=>({path,source,sha256:createHash('sha256').update(source).digest('hex')});
const load=(source:string,libraries:Record<string,string>)=>importOpenSCADBundle({version:1,rootPath:'root.scad',files:[file('root.scad',source),...Object.entries(libraries).map(([p,s])=>file(p,s))]});
let kernel:Awaited<ReturnType<typeof createGeometryKernel>>;
beforeAll(async()=>{kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});});
async function volume(source:string,libraries:Record<string,string>){const result=await load(source,libraries),session=createCadSession();try{session.addCode(result.program);return kernel.evaluate(session.state.document).volume;}finally{session.dispose();}}
it('exports definitions without running library roots or exposing its variables as parameters',async()=>{
 const result=await load('use <lib.scad> part();',{'lib.scad':'size=3;unused=assert(false) 99;module part(){cube(size);} assert(false);sphere(100);'});
 expect(result.program.parameters).toEqual({});expect(result.provenance.includes[0]).toMatchObject({kind:'use',path:'lib.scad'});
 expect(await volume('use <lib.scad> part();',{'lib.scad':'size=3;module part(){cube(size);}sphere(100);'})).toBeCloseTo(27);
});
it('keeps lexical globals, helper functions and sibling modules isolated from caller and other libraries',async()=>{
 expect(await volume('size=99;use <a.scad> use <b.scad> a();b();',{
  'a.scad':'size=2;function f()=size;module helper(){cube(f());}module a(){helper();}',
  'b.scad':'size=3;function f()=size;module helper(){translate([10,0,0])cube(f());}module b(){helper();}'
 })).toBeCloseTo(35);
 expect(await volume('size=9;use <a.scad> a();',{'a.scad':'module a(){assert(is_undef(size));cube(1);}'})).toBeCloseTo(1);
});
it('hoists forward definitions and lazily resolves the last library assignments and defaults',async()=>{
 expect(await volume('a();use <a.scad>',{'a.scad':'module a(n=f()){cube(n);}size=1;function f()=size;size=3;'})).toBeCloseTo(27);
});
it('nested use stays in the local file while include exports textual declarations',async()=>{
 const libs={'a.scad':'use <sub/b.scad> include <c.scad> module a(){b();}', 'sub/b.scad':'module b(){cube(2);}sphere(99);','c.scad':'module c(){translate([10,0,0])cube(1);}'};
 expect(await volume('use <a.scad> a();c();',libs)).toBeCloseTo(9);
 await expect(load('use <a.scad> b();',libs)).rejects.toMatchObject({code:'unsupported-feature'});
});
it('preserves caller children scope and dynamic specials inside a used module',async()=>{
 expect(await volume('size=3;module helper(){cube(size);}use <a.scad> a($width=2){helper();}',{'a.scad':'size=99;module a(){assert($width==2);children();}'})).toBeCloseTo(27);
});
it('retains live guards, source diagnostics, dependency cycles and fixed construction limits',async()=>{
 await expect(load('use <a.scad> a();',{'a.scad':'module a(){assert(false);cube(1);}'})).rejects.toThrow('Assertion failed');
 await expect(load('use <a.scad> a();',{'a.scad':'module a(){not_supported();}'})).rejects.toMatchObject({path:'a.scad'});
 await expect(load('use <a.scad>',{'a.scad':'use <root.scad>'})).rejects.toThrow('Cyclic include dependency');
 await expect(load('use <a.scad> a();',{'a.scad':'module a(){a();}'})).rejects.toMatchObject({code:'resource-limit'});
 await expect(load('use <a.scad> a();',{'a.scad':'module a(){for(i=[0:65])cube(1);}'})).rejects.toMatchObject({code:'resource-limit'});
});
it.each(['module a(){use <a.scad> cube(1);}a();','{use <a.scad> cube(1);}','translate([0,0,0]) use <a.scad> cube(1);','if(true) use <a.scad> cube(1);'])('refuses use outside file scope: %s',async source=>{
 await expect(load(source,{'a.scad':'module x(){cube(1);}'})).rejects.toMatchObject({code:'unsupported-feature'});
});
it('refuses nested use even when its target is empty or reached through an include',async()=>{
 await expect(load('module a(){use <a.scad> cube(1);}a();',{'a.scad':'// empty'})).rejects.toMatchObject({code:'unsupported-feature'});
 await expect(load('module a(){include <a.scad>}a();',{'a.scad':'use <empty.scad> cube(1);','empty.scad':'// empty'})).rejects.toMatchObject({code:'unsupported-feature'});
});
it('measures exact authored Scene_House geometry and editor history while refusing strict STL admission',async()=>{
 const base='library/corpus/repos/AngeloNicoli--OpenSCAD-Snippet/';
 const paths=['Scene_House.scad',...['Wall_01','Wall_02','Wall_03','Grid_01'].map(n=>'Asset_SCAD/'+n+'.scad')];
 const files=paths.map(p=>file(p,readFileSync(base+p,'utf8'))),result=await importOpenSCADBundle({version:1,rootPath:paths[0],files});
 const session=createCadSession(),before=session.serialize();
 try{session.addCode(result.program,'Authored Scene House');const evaluated=kernel.evaluate(session.state.document);
  expect(evaluated.volume).toBeCloseTo(26.810686449);const mesh=exportSTL(evaluated.bodies);
  expect(createHash('sha256').update(mesh).digest('hex')).toBe('1221cb3d30e00e3a6c54874550ccd38a31c7ab1ebad8fd124e1310d4c503c6c6');
  const screen=await checkModelLibrarySTL(mesh,{checkedOn:'2026-11-14',maxTriangles:10000,maxExtentMm:200,toMillimetresZUp:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]});
  expect(screen.triangles).toBe(2284);expect(screen.checks).toEqual({parseable:'pass',closedPositiveVolume:'fail',withinSizeLimits:'pass',withinTriangleLimits:'pass'});
  const saved=session.serialize(),restored=createCadSession(JSON.parse(saved));try{expect(restored.serialize()).toBe(saved);}finally{restored.dispose();}
  session.undo();expect(session.serialize()).toBe(before);session.redo();expect(session.serialize()).toBe(saved);
 }finally{session.dispose();}
});
