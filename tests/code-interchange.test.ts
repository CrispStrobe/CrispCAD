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
 for(const source of ['include <foo.scad>;','module part(){cube(1);} part();','for(i=[0:10]) cube(i);','hull(){sphere(1);sphere(2);}','linear_extrude(5) square(2);','cylinder(h=10,r1=4,r2=1);','rotate(45,[1,0,0]) cube(3);','a=10; a=20; cube(a);','sphere($fn=300);','cube(1);height=2;','import("https://example.com/a.stl");','union(){}'])expect(()=>importOpenSCAD(source),source).toThrow();
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
  runInNewContext(exportJSCAD(p)+'\nmodule.exports.solid = main();',context,{timeout:4000});const solid=context.module.exports.solid,volume=modeling.measurements.measureVolume(solid);expect(volume,example.id).toBeGreaterThan(0);expect(Math.abs(volume-expected.volume)/expected.volume,example.id).toBeLessThan(.025);
 }
},20000);
