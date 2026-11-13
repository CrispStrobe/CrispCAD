// SPDX-License-Identifier: BSD-3-Clause
import {beforeAll,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {importOpenSCAD,exportOpenSCAD,exportJSCAD,exportCodeSource,createCadSession,codeExamples,codeExampleProgram,compileCode} from '@brickwright/cad-core';
import {createGeometryKernel} from '@brickwright/cad-geometry';
import type {GeometryKernel} from '@brickwright/cad-geometry';
let kernel:GeometryKernel;beforeAll(async()=>{kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});});
const geometry=(source:string)=>{const s=createCadSession();s.addCode(importOpenSCAD(source));return kernel.evaluate(s.state.document);};
it('preserves OpenSCAD default origins, explicit centres, dimensions, diameters and transform order',()=>{
 expect(geometry('cube([10,20,30]);').bodies[0].bounds).toEqual({min:[0,0,0],max:[10,20,30]});expect(geometry('cube(10, true);').bodies[0].bounds.min).toEqual([-5,-5,-5]);
 expect(geometry('cylinder(h=20,d=10,$fn=48);').bodies[0].bounds.min[2]).toBe(0);expect(geometry('cylinder(20,5,center=true);').bodies[0].bounds.min[2]).toBe(-10);
 const result=geometry('translate([10,0,0]) rotate([0,0,90]) cube([2,4,6],center=true);');expect(result.bodies[0].bounds.min[0]).toBeCloseTo(8);expect(result.bodies[0].bounds.min[1]).toBeCloseTo(-1);
});
it('retains parameter expressions and accepts scalar scale, comments and named vectors',()=>{
 const p=importOpenSCAD('/* source */ width=20; height=width/2; $fn=48; difference(){ translate(v=[0,0,height/2]) cube([width,width,height],true); cylinder(h=50,r=3,center=true); }');expect(compileCode(p).values.height.value).toBe(10);p.parameters.width='30';expect(compileCode(p).values.height.value).toBe(15);expect(geometry('scale(2) cube(10);').volume).toBeCloseTo(8000);
});
it('refuses unsupported geometry and language features rather than approximating or executing them',()=>{
 for(const source of ['include <foo.scad>;','for(i=[0:10]) cube(i);','hull(){sphere(1);sphere(2);}','linear_extrude(height=5,twist=90) square(2);','cylinder(h=10,r1=4,r2=1);','rotate(45,[1,0,0]) cube(3);','a=10; a=20; cube(a);','sphere($fn=300);','cube(1);height=2;','import("https://example.com/a.stl");','union(){}'])expect(()=>importOpenSCAD(source),source).toThrow();
});
it('exports effective overrides as readable native defaults, preserving dependencies and comments',()=>{
 const p=codeExampleProgram('box');p.parameters={width:'40',height:'width / 2'};const text=exportCodeSource(p);expect(text).toContain('\n');const values=compileCode({...p,source:text,parameters:{}}).values;expect(values.width.value).toBe(40);expect(values.height.value).toBe(20);
 const commented={...p,source:'// param width: mm = 1;\nparam width: mm = 30; // comment ;\nparam height: mm = width / 2;\nreturn box(width, 10, height);',parameters:{width:'60'}};expect(compileCode({...commented,source:exportCodeSource(commented),parameters:{}}).values.height.value).toBe(30);
});
for(const example of codeExamples)it(`round-trips OpenSCAD snapshot without losing CSG volume: ${example.id}`,()=>{
 const p=codeExampleProgram(example.id),s=createCadSession();s.addCode(p);const expected=kernel.evaluate(s.state.document);const text=exportOpenSCAD(p),actual=geometry(text);expect(actual.volume).toBeCloseTo(expected.volume,4);expect(exportJSCAD(p)).toContain("require('@jscad/modeling')");expect(p.source.split('\n').length).toBeGreaterThan(1);
});
it('exports all example snapshots to actual JSCAD solids with compatible dimensions and volume',async()=>{
 const {createRequire}=await import('node:module'),{runInNewContext}=await import('node:vm');const require=createRequire(import.meta.url),modeling=require('@jscad/modeling');
 for(const example of codeExamples){const p=codeExampleProgram(example.id),session=createCadSession();session.addCode(p);const expected=kernel.evaluate(session.state.document),context={module:{exports:{} as any},require:(id:string)=>{if(id!=='@jscad/modeling')throw Error('Unexpected package');return modeling;}};
  runInNewContext(exportJSCAD(p)+'\nmodule.exports.solid = main();',context,{timeout:4000});const solid=context.module.exports.solid,volume=modeling.measurements.measureVolume(solid);expect(volume,example.id).toBeGreaterThan(0);expect(Math.abs(volume-expected.volume)/expected.volume,example.id).toBeLessThan(.025);const bounds=modeling.measurements.measureBoundingBox(solid);for(let i=0;i<3;i++){const tolerance=Math.max(.1,(expected.bodies[0].bounds.max[i]-expected.bodies[0].bounds.min[i])*.005);expect(Math.abs(bounds[0][i]-expected.bodies[0].bounds.min[i]),example.id).toBeLessThan(tolerance);expect(Math.abs(bounds[1][i]-expected.bodies[0].bounds.max[i]),example.id).toBeLessThan(tolerance);}
 }
},20000);

it('converts planar polygon, square and circle extrusions with explicit centering',()=>{
 expect(geometry('linear_extrude(height=5) polygon(points=[[0,0],[20,0],[20,10],[0,10]]);').volume).toBeCloseTo(1000);expect(geometry('linear_extrude(height=5,center=true) square([20,10],center=true);').bodies[0].bounds).toEqual({min:[-10,-5,-2.5],max:[10,5,2.5]});expect(geometry('linear_extrude(10) circle(d=12,$fn=6);').volume).toBeGreaterThan(0);
 for(const source of ['linear_extrude(5) square([-2,3]);','linear_extrude(5) circle(r=-2);','linear_extrude(5) polygon([[0,0],[1,1],[0,1],[1,0]]);'])expect(()=>geometry(source)).toThrow();
});

it('expands reusable modules symbolically, hoists definitions, and preserves parameter overrides',()=>{
 const p=importOpenSCAD('width=8; part(width); module part(size=4){ translate([size/2,0,0]) cube([size,2,3],center=true); }');
 expect(compileCode(p).values.width.value).toBe(8);p.parameters.width='12';
 const session=createCadSession();session.addCode(p);const result=kernel.evaluate(session.state.document);
 expect(result.volume).toBeCloseTo(72);expect(result.bodies[0].bounds).toEqual({min:[0,-1,-1.5],max:[12,1,1.5]});
 expect(geometry('module a(s=3){b(s);} module b(t){cube(t);} a();').volume).toBeCloseTo(27);
});
it('keeps module lexical globals separate from caller arguments and evaluates defaults in the definition scope',()=>{
 expect(geometry('size=2; module inner(){cube(size);} module outer(size=9){inner();} outer();').volume).toBeCloseTo(8);
 expect(geometry('size=2; module part(size=9,height=size){cube([size,height,1]);} part();').volume).toBeCloseTo(18);
 expect(geometry('size=2; module part(size=9,height=size){cube([size,height,1]);} part(height=4);').volume).toBeCloseTo(36);
});
it('accepts symbolic vectors, indexing, boolean flags and module vector defaults',()=>{
 const p=importOpenSCAD('width=10; size=[width,width/2,3]; centered=true; module part(v=size){cube(v,centered);} part();');
 p.parameters.width='20';const session=createCadSession();session.addCode(p);const result=kernel.evaluate(session.state.document);
 expect(result.volume).toBeCloseTo(600);expect(result.bodies[0].bounds.min).toEqual([-10,-5,-1.5]);
 expect(geometry('v=[[2,3,4],[5,6,7]]; module part(s){cube([s[0],s[1]+1,s[2]]);} part(v[0]);').volume).toBeCloseTo(32);
});
it('supports degree math and keeps expressions live through source interchange',()=>{
 const p=importOpenSCAD('angle=30; side=sin(angle)*10; cube([side,max(2,3),sqrt(16)]);');
 expect(compileCode(p).values.side.value).toBeCloseTo(5);p.parameters.angle='90';expect(compileCode(p).values.side.value).toBeCloseTo(10);
 expect(geometry('cube([abs(round(-2.5)),pow(2,3),cos(0)*2]);').volume).toBeCloseTo(48);
 expect(geometry('cube([2*PI,1,1]);').volume).toBeCloseTo(2*Math.PI);
 expect(geometry('width=PI; PI=4; cube([width,1,1]);').volume).toBeCloseTo(4);
});
it('bounds module recursion and refuses child modules, bad arguments and unsupported scope semantics',()=>{
 for(const source of [
  'module a(){a();} a();',
  'module a(s){cube(s);} a();',
  'module a(s=2){cube(s);} a(2,s=3);',
  'module a(s=2){cube(s);} a(other=3);',
  'module a(){cube(1);} a() cube(3);',
  'module a(){module b(){cube(1);} b();} a();',
  'v=[1,2,3]; cube(v[5]);',
  'cube(sqrt(-1));',
  'cube(random(1));',
 ])expect(()=>importOpenSCAD(source),source).toThrow();
});

it('caps symbolic argument expansion before recursive expressions can exhaust memory',()=>{
 try{importOpenSCAD('module a(x){a(x+x);} a(1);');throw Error('Expected resource failure');}catch(error:any){expect(error.code).toBe('resource-limit');}
 expect(geometry('module b(){cylinder(2,1);} module a($fn=6){b();} a();').volume).toBeCloseTo(3*Math.sqrt(3));
});
it('inlines user scalar/vector functions symbolically, with hoisted definitions and lexical defaults',()=>{
 const p=importOpenSCAD('width=5; dimensions=size(width); cube(dimensions); function twice(x)=x*2; function size(w=width)=[w,twice(w),3];');
 p.parameters.width='7';const session=createCadSession();session.addCode(p);expect(kernel.evaluate(session.state.document).volume).toBeCloseTo(294);
 expect(geometry('global=2; function size(x=global)=x; module part(global=9){cube(size());} part();').volume).toBeCloseTo(8);
 expect(geometry('function size(x=3,y=4)=[x,y,2]; cube(size(y=5));').volume).toBeCloseTo(30);
 expect(geometry('function size()=[2,3,4]; cube(size()[1]);').volume).toBeCloseTo(27);
 expect(geometry('function profile(w)=[[0,0],[w,0],[w,w],[0,w]]; linear_extrude(3) polygon(profile(4));').volume).toBeCloseTo(48);
 expect(geometry('module part(){cylinder(2,1);} part($fn=6);').volume).toBeCloseTo(3*Math.sqrt(3));
});
it('bounds user-function recursion and diagnoses unsupported conditionals without executing them',()=>{
 for(const source of ['function f(x)=f(x+x); cube(f(1));','function f(x)=x; cube('+'f('.repeat(33)+'1'+')'.repeat(33)+');']){
  try{importOpenSCAD(source);throw Error('Expected resource failure');}catch(error:any){expect(error.code).toBe('resource-limit');}
 }
 for(const source of ['function f(x)=x>0?x:1; cube(f(2));','function f(x)=x; cube(f());','function f(x)=x; cube(f(1,x=2));','function f(x)=x; cube(f(y=1));'])expect(()=>importOpenSCAD(source),source).toThrow();
});

it('retains local declarative dependencies, lexical shadowing and last assignments across module instances',()=>{
 const p=importOpenSCAD('width=4; module part(n){cube(size); size=[w,w,1]; w=n*width; w=n*width+1;} part(2); translate([20,0,0]) part(3);');
 p.parameters.width='5';const session=createCadSession();session.addCode(p);expect(kernel.evaluate(session.state.document).volume).toBeCloseTo(121+256);
 expect(geometry('width=2; module part(width=3){cube(width); translate([10,0,0]){width=4; cube(width);} translate([20,0,0]) cube(width);} part();').volume).toBeCloseTo(27+64+27);
 expect(geometry('module part(){difference(){size=6; cube(size); translate([2,2,-1]) cube([2,2,8]);}} part();').volume).toBeCloseTo(216-24);
 expect(geometry('module part(){cylinder(2,1); $fn=6;} part();').volume).toBeCloseTo(3*Math.sqrt(3));
});
it('refuses cyclic local bindings and bounds deep local dependency chains',()=>{
 for(const source of ['module a(){x=x+1; cube(x);} a();','module a(){x=y; y=x; cube(x);} a();','module a(){v=[v]; cube(v);} a();'])expect(()=>importOpenSCAD(source),source).toThrow('dependency cycle');
 const definitions=Array.from({length:34},(_,i)=>`v${i}=${i===33?'1':`v${i+1}`};`).join('');
 try{importOpenSCAD(`module a(){${definitions} cube(v0);} a();`);throw Error('Expected resource failure');}catch(error:any){expect(error.code).toBe('resource-limit');}
});

it('keeps captured local bindings independent of later inner shadowing and refuses anonymous assignment scopes',()=>{
 expect(geometry('module a(width=3){size=width; translate([10,0,0]){width=8; cube(size);}} a();').volume).toBeCloseTo(27);
 expect(()=>importOpenSCAD('module a(){ {size=4;} cube(size);} a();')).toThrow('anonymous blocks');
});

it('expands nested scalar calls once per use and retains their arithmetic context',()=>{
 let expression='1';for(let i=0;i<8;i++)expression=`f(${expression})+1`;
 expect(geometry(`function f(x)=x; cube(${expression});`).volume).toBeCloseTo(729);
});
