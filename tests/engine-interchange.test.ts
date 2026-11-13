// SPDX-License-Identifier: BSD-3-Clause
import {beforeAll,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {createCadSession,importOpenSCAD,importJSCAD,exportJSCAD,exportOpenSCAD} from '@brickwright/cad-core';
import {createGeometryKernel} from '@brickwright/cad-geometry';
import type {GeometryKernel} from '@brickwright/cad-geometry';
let kernel:GeometryKernel;beforeAll(async()=>{kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});});
const evaluate=(program:any)=>{const s=createCadSession();s.addCode(program);return kernel.evaluate(s.state.document);};
for(const radii of [[4,2],[4,0],[0,3]])it(`retains tapered-cylinder dimensions and rounds trips SCAD/JSCAD: ${radii}`,()=>{
 const p=importOpenSCAD(`bottom=${radii[0]}; top=${radii[1]}; cylinder(h=9,r1=bottom,r2=top,center=true,$fn=24);`),g=evaluate(p);
 const factor=24*Math.sin(2*Math.PI/24)/2;expect(g.volume).toBeCloseTo(9/3*factor*(radii[0]**2+radii[0]*radii[1]+radii[1]**2),5);expect(g.bodies[0].bounds.min[2]).toBe(-4.5);
 expect(evaluate(importOpenSCAD(exportOpenSCAD(p))).volume).toBeCloseTo(g.volume,5);expect(evaluate(importJSCAD(exportJSCAD(p)).program).volume).toBeCloseTo(g.volume,5);
 const modeling=createRequire(import.meta.url)('@jscad/modeling'),context={module:{exports:{} as any},require:()=>modeling};runInNewContext(exportJSCAD(p)+';module.exports.solid=main();',context,{timeout:3000});expect(modeling.measurements.measureVolume(context.module.exports.solid)).toBeCloseTo(g.volume,5);
 p.parameters.bottom='6';expect(evaluate(p).volume).toBeGreaterThan(g.volume);
});
it('applies hull to one concave/disconnected input rather than treating it as a no-op',()=>{
 const p=importOpenSCAD('hull(){difference(){cube(10,true);cube([20,2,20],true);}}'),g=evaluate(p);expect(g.volume).toBeCloseTo(1000);expect(evaluate(importJSCAD(exportJSCAD(p)).program).volume).toBeCloseTo(1000);
 const context={module:{exports:{} as any},require:()=>createRequire(import.meta.url)('@jscad/modeling')};runInNewContext(exportJSCAD(p)+';module.exports.solid=main();',context,{timeout:3000});expect(context.require().measurements.measureVolume(context.module.exports.solid)).toBeCloseTo(1000);
});
it('retains hull dependencies, multiple operands, positional tapers and diameter origins',()=>{
 const p=importOpenSCAD('distance=10; hull(){cube(2,true);translate([distance,0,0])cube(2,true);}');expect(evaluate(p).volume).toBeCloseTo(48);p.parameters.distance='20';expect(evaluate(p).volume).toBeCloseTo(88);
 expect(evaluate(importOpenSCAD('cylinder(8,4,2,true);')).bodies[0].bounds.min[2]).toBe(-4);
 const d=evaluate(importOpenSCAD('cylinder(h=8,d1=8,d2=4);'));expect(d.bodies[0].bounds).toEqual({min:[-4,-4,0],max:[4,4,8]});
 for(const source of ['cylinder(h=2,r1=0,r2=0);','cylinder(h=2,r1=-1,r2=4);','cylinder(h=2,r1=2,d1=4);'])expect(()=>importOpenSCAD(source)).toThrow();
});

it('recomputes range/list instances and branch choices from retained scalar parameters',()=>{
 const p=importOpenSCAD('count=3; centered=true; for(i=[0:count-1]) translate([i*10,0,0]) if(i%2==0) cube(2,centered); else sphere(1,$fn=24);');
 const first=evaluate(p);p.parameters.count='5';expect(evaluate(p).volume).toBeGreaterThan(first.volume);expect(evaluate(p).bodies[0].bounds.max[0]).toBeCloseTo(41);
 p.parameters.centered='false';expect(evaluate(p).bodies[0].bounds.max[0]).toBeCloseTo(42);
 const list=importOpenSCAD('spacing=10; for(p=[0,spacing,spacing*2]) translate([p,0,0]) cube(2);');expect(evaluate(list).volume).toBeCloseTo(24);list.parameters.spacing='20';expect(evaluate(list).bodies[0].bounds.max[0]).toBe(42);
 expect(evaluate(importOpenSCAD('for(p=[[0,0,0],[10,0,0]]) translate(p) cube(2);')).volume).toBeCloseTo(16);
});
it('supports lazy expression domains, no-else empty branches, local loop bindings and nested scopes',()=>{
 expect(evaluate(importOpenSCAD('side=2; cube([side>0?side:sqrt(-1),2,2]);')).volume).toBeCloseTo(8);
 expect(evaluate(importOpenSCAD('union(){if(false) cube(9); for(i=[1:1:0]) cube(4); cube(2);}')).volume).toBeCloseTo(8);
 expect(evaluate(importOpenSCAD('for(i=[0:1]) for(j=[0:1]) translate([i*10,j*10,0]){side=2; cube(side);}')).volume).toBeCloseTo(32);
 expect(evaluate(importOpenSCAD('if(true==1)cube(10);else cube(2);')).volume).toBeCloseTo(8);
 expect(evaluate(importOpenSCAD('function positive(x)=x>0?x:2; cube(positive(-1));')).volume).toBeCloseTo(8);
 expect(evaluate(importOpenSCAD('for(i=[3:-1:1]) translate([i*10,0,0]) cube(2);')).volume).toBeCloseTo(24);
 expect(evaluate(importOpenSCAD('for(i=[3:1]) translate([i*10,0,0]) cube(2);')).volume).toBeCloseTo(24);
 expect(evaluate(importOpenSCAD('flag=true; linear_extrude(3,flag) square([2,4],flag);')).bodies[0].bounds).toEqual({min:[-1,-2,-1.5],max:[1,2,1.5]});
});
it('bounds nested runtime expansion and refuses invalid loop steps instead of freezing defaults',()=>{
 for(const source of ['for(i=[0:0:4]) cube(2);','for(i=[0:100])cube(2);','for(i=[0:63])for(j=[0:63])cube(2);'])expect(()=>importOpenSCAD(source),source).toThrow();
 const p=importOpenSCAD('n=3; for(i=[0:n-1]) translate([i*4,0,0]) cube(2);');p.parameters.n='100';expect(()=>evaluate(p)).toThrow('64');
});

it('round-trips empty branches through actual JSCAD without inventing geometry',()=>{
 const p=importOpenSCAD('union(){for(i=[1:1:0]) cube(4); if(false)cube(5); cube(2);}'),text=exportJSCAD(p);
 expect(evaluate(importJSCAD(text).program).volume).toBeCloseTo(8);expect(evaluate(importOpenSCAD(exportOpenSCAD(p))).volume).toBeCloseTo(8);
 const modeling=createRequire(import.meta.url)('@jscad/modeling'),context={module:{exports:{} as any},require:()=>modeling};runInNewContext(text+';module.exports.solid=main();',context,{timeout:3000});expect(modeling.measurements.measureVolume(context.module.exports.solid)).toBeCloseTo(8);
});
it('accepts finer tessellation within the global mesh budget and reports limits distinctly',()=>{
 expect(evaluate(importOpenSCAD('sphere(3,$fn=128);')).volume).toBeGreaterThan(100);
 expect(evaluate(importOpenSCAD('cylinder(h=5,r1=4,r2=2,$fn=512);')).volume).toBeGreaterThan(140);
 try{importOpenSCAD('sphere(3,$fn=512);');throw Error('Expected budget failure');}catch(error:any){expect(error.code).toBe('resource-limit');}
 for(const source of ['cube(true);','cylinder(h=2,r=false);'])expect(()=>importOpenSCAD(source),source).toThrow('numeric');
});
