// SPDX-License-Identifier: BSD-3-Clause
import {beforeAll,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {createCadSession,importOpenSCAD,importJSCAD,exportJSCAD,exportOpenSCAD,compileCode} from '@brickwright/cad-core';
import {createGeometryKernel} from '@brickwright/cad-geometry';
let kernel:any;beforeAll(async()=>{kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});});
const evaluate=(program:any)=>{const session=createCadSession();session.addCode(program);return kernel.evaluate(session.state.document);};
const modeling=createRequire(import.meta.url)('@jscad/modeling');
function oracle(source:string){const context={module:{exports:{} as any},require:()=>modeling};runInNewContext(source+';module.exports.solid=module.exports.main();',context,{timeout:5000});return {volume:modeling.measurements.measureVolume(context.module.exports.solid),bounds:modeling.measurements.measureBoundingBox(context.module.exports.solid)};}
for(const input of [
 'linear_extrude(height=5) difference(){square([20,10],center=true);circle(r=2,$fn=32);}',
 'linear_extrude(5) hull(){translate([-5,0])circle(2,$fn=16);translate([5,0])square([2,4],center=true);}',
 'linear_extrude(5) intersection(){square([20,10],true);translate([8,0])circle(7,$fn=32);}',
 'linear_extrude(height=10,twist=90,slices=128) translate([5,0]) square([2,1],true);',
 'rotate_extrude($fn=48) translate([5,0]) square([3,10]);',
 'rotate_extrude(angle=180,$fn=48) translate([5,0]) square([3,10]);',
 'linear_extrude(3) polygon(points=[[0,0],[20,0],[20,20],[0,20],[5,5],[15,5],[15,15],[5,15]],paths=[[0,1,2,3],[4,5,6,7]]);'
])it('preserves profile operations through SCAD/native/JSCAD: '+input.slice(0,55),()=>{
 const program=importOpenSCAD(input),g=evaluate(program);expect(g.volume).toBeGreaterThan(0);expect(evaluate(importOpenSCAD(exportOpenSCAD(program))).volume).toBeCloseTo(g.volume,4);const js=exportJSCAD(program),expected=oracle(js),reimported=evaluate(importJSCAD(js).program);expect(Math.abs(expected.volume-g.volume)/g.volume).toBeLessThan(input.includes('twist=')?0.011:0.00002);if(input.includes('twist=')){expect(Math.abs(g.volume-20)/20).toBeLessThan(0.006);expect(Math.abs(expected.volume-20)/20).toBeLessThan(0.006);expect(importJSCAD(js).warnings.join(' ')).toContain('native tessellation');}expect(reimported.volume).toBeCloseTo(g.volume,4);for(let i=0;i<3;i++){expect(g.bodies[0].bounds.min[i]).toBeCloseTo(expected.bounds[0][i],4);expect(g.bodies[0].bounds.max[i]).toBeCloseTo(expected.bounds[1][i],4);}
});
it('retains profile dimensions, taper and twist parameters with the documented SCAD handedness',()=>{
 const p=importOpenSCAD('width=20; top=0.5; linear_extrude(height=10,scale=top) square([width,10]);');expect(evaluate(p).volume).toBeCloseTo(2000*1.75/3,3);p.parameters.width='40';expect(evaluate(p).volume).toBeCloseTo(4000*1.75/3,3);expect(evaluate(importOpenSCAD(exportOpenSCAD(p))).volume).toBeCloseTo(evaluate(p).volume,4);expect(()=>exportJSCAD(p)).toThrow('slice extrusion');
 const twist=evaluate(importOpenSCAD('linear_extrude(height=10,twist=90,slices=4)translate([5,0])square([2,1],true);')).bodies[0],top=[];for(let i=0;i<twist.positions.length;i+=3)if(Math.abs(twist.positions[i+2]-10)<1e-5)top.push([twist.positions[i],twist.positions[i+1]]);expect(top.length).toBeGreaterThan(0);expect(top.every(p=>p[1]<-3.9)).toBe(true);
});
it('keeps profile budgets, units and invalid geometry explicit',()=>{
 for(const source of ['return extrudeProfile(5, polygon2d([[0,0],[1,1],[0,1],[1,0]]));','return extrudeProfile(5,circle2d(2,4096),90,256);','return extrudeProfile(5,circle2d(2),0,0);','return extrudeProfile(5,rectangle2d(10,10),0,2,-1);'])expect(()=>compileCode({version:1,language:'brickwright-cad-script',source,parameters:{}})).toThrow();
 expect(evaluate(importOpenSCAD('rotate_extrude($fn=64)translate([-5,0])square([1,2]);')).volume).toBeCloseTo(9*64*Math.sin(2*Math.PI/64),4);expect(()=>evaluate(importOpenSCAD('rotate_extrude()translate([-1,0])square([2,2]);'))).toThrow('one side');
 expect(evaluate(importOpenSCAD('linear_extrude(2)union(){square([2,3]);circle(0);}')).volume).toBeCloseTo(12);
});
it('exposes coarse twist triangulation differences rather than claiming identical meshes',()=>{
 const program=importOpenSCAD('linear_extrude(height=10,twist=90,slices=8)translate([5,0])square([2,1],true);'),native=evaluate(program),js=exportJSCAD(program),reference=oracle(js);
 expect(native.volume).toBeCloseTo(18.246149,5);expect(reference.volume).toBeCloseTo(21.497655,5);expect(program.source).toContain('native kernel tessellation');expect(importJSCAD(js).warnings.join(' ')).toContain('coarse slice counts');
});
it('keeps a zero-angle revolution empty when exporting a larger construction to JSCAD',()=>{
 const program={version:1 as const,language:'brickwright-cad-script' as const,parameters:{},source:'return union(box(2,3,4),revolve(move2d(5,0,rectangle2d(2,3)),0,48));'};
 expect(evaluate(program).volume).toBeCloseTo(24);expect(oracle(exportJSCAD(program)).volume).toBeCloseTo(24);
});
