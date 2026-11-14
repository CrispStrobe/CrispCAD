// SPDX-License-Identifier: BSD-3-Clause
import {beforeAll,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {compileCode,createCadSession,importOpenSCAD,exportOpenSCAD,exportJSCAD,parseDocument} from '@brickwright/cad-core';
import {createGeometryKernel} from '@brickwright/cad-geometry';
import type {CodeProgram} from '@brickwright/cad-core';
let kernel:Awaited<ReturnType<typeof createGeometryKernel>>;
beforeAll(async()=>{kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});});
function evaluate(program:CodeProgram){const s=createCadSession();try{s.addCode(program);return kernel.evaluate(s.state.document);}finally{s.dispose();}}
for(const [size,auto,expected]of [
 ['[10,20,0]','true',[10,20,80/3]],['[10,6,0]','true',[10,6,20]],['[0,6,20]','true',[10,6,20]],['[0,0,0]','true',[2,3,4]],['[10,20,0]','[true,false,true]',[10,20,80/3]],['[10,0,0]','[false,true,false]',[10,15,4]],
] as const)it(`matches largest-factor automatic resize for ${size}, ${auto}`,()=>{
 const p=importOpenSCAD(`resize(${size},auto=${auto})cube([2,3,4]);`),g=evaluate(p);g.bodies[0].bounds.max.forEach((v,i)=>expect(v).toBeCloseTo(expected[i],4));expect(g.volume).toBeCloseTo(expected.reduce((a,b)=>a*b,1),3);const roundtrip=evaluate(importOpenSCAD(exportOpenSCAD(p)));expect(roundtrip.volume).toBeCloseTo(g.volume,5);
});
it('resizes evaluated 2D profiles including boolean cuts, offsets and zero auto targets',()=>{
 for(const [source,volume]of [
  ['linear_extrude(2)resize([10,0],true)square([2,3]);',300],
  ['linear_extrude(2)resize([10,20],true)square([2,3]);',400],
  ['linear_extrude(2)resize([0,0],true)square([2,3]);',12],
  ['linear_extrude(2)resize([10,0,200],true)square([2,3]);',300],
  ['linear_extrude(2)resize([10,20])difference(){square([4,4]);translate([3,0])square([4,4]);}',400],
  ['linear_extrude(2)resize([10,20])offset(delta=1)square([2,3]);',400],
 ]as const){const p=importOpenSCAD(source),g=evaluate(p);expect(g.volume,source).toBeCloseTo(volume,4);expect(evaluate(importOpenSCAD(exportOpenSCAD(p))).volume).toBeCloseTo(volume,4);expect(()=>exportJSCAD(p)).toThrow('profile operation');}
});
it('keeps empty operands empty and numeric auto conditions live',()=>{
 expect(evaluate(importOpenSCAD('union(){resize([1,2,3],true)if(false)cube(1);cube(2);}')).volume).toBeCloseTo(8);
 expect(evaluate(importOpenSCAD('linear_extrude(2)union(){resize([1,2],true)if(false)square(1);square(2);}')).volume).toBeCloseTo(8);
 const p=importOpenSCAD('automatic=0;resize([10,0,0],auto=automatic)cube([2,3,4]);');expect(evaluate(p).volume).toBeCloseTo(120);p.parameters.automatic='2';expect(evaluate(p).volume).toBeCloseTo(120);p.parameters.automatic='true';expect(evaluate(p).volume).toBeCloseTo(3000);expect(evaluate(importOpenSCAD('resize([10,0,0],auto=[1,1,1])cube([2,3,4]);')).volume).toBeCloseTo(3000);const choice=importOpenSCAD('mode=0;resize([10,0,0],auto=mode?true:[false,true,false])cube([2,3,4]);');expect(evaluate(choice).volume).toBeCloseTo(600);choice.parameters.mode='1';expect(evaluate(choice).volume).toBeCloseTo(3000);
});
it('retains parametric profile resize, identity, undo and last-valid state after invalid edits',()=>{
 const p=importOpenSCAD('width=10;linear_extrude(2)resize([width,20],auto=true)square([2,3]);'),s=createCadSession();try{const id=s.addCode(p),before=s.serialize();expect(kernel.evaluate(s.state.document).volume).toBeCloseTo(400);s.updateCode(id,{...p,parameters:{width:'15'}});expect(kernel.evaluate(s.state.document).volume).toBeCloseTo(600);const changed=s.serialize();expect(()=>s.updateCode(id,{...p,parameters:{width:'-1'}})).toThrow();expect(s.serialize()).toBe(changed);expect(parseDocument(changed).roots).toEqual([id]);s.undo();expect(s.serialize()).toBe(before);s.redo();expect(s.serialize()).toBe(changed);}finally{s.dispose();}
 for(const source of ['resize([-1,2,3])cube(1);','linear_extrude(1)resize([-1,2])square(1);','linear_extrude(1)resize([10,20,"bad"])square(1);','linear_extrude(1)resize([10,20,true])square(1);'])expect(()=>compileCode(importOpenSCAD(source))).toThrow();
});
it('uses actual Boolean options rather than numeric truthiness for primitive and extrusion centres',()=>{
 for(const flag of ['0','1','2']){
  const cube=evaluate(importOpenSCAD(`cube([2,3,4],center=${flag});`));expect(cube.bodies[0].bounds.min).toEqual([0,0,0]);
  const cylinder=evaluate(importOpenSCAD(`cylinder(h=4,r=2,center=${flag});`));expect(cylinder.bodies[0].bounds.min[2]).toBeCloseTo(0);
  const profile=evaluate(importOpenSCAD(`linear_extrude(4,center=${flag})square([2,3],center=${flag});`));expect(profile.bodies[0].bounds.min).toEqual([0,0,0]);
 }
 const p=importOpenSCAD('centered=1;cube([2,3,4],center=centered);');expect(evaluate(p).bodies[0].bounds.min).toEqual([0,0,0]);p.parameters.centered='true';expect(evaluate(p).bodies[0].bounds.min).toEqual([-1,-1.5,-2]);
});
it('normalizes explicit slice counts without freezing edits or guessing automatic twisted/tapered slices',()=>{
 const p=importOpenSCAD('slices=0;linear_extrude(4,twist=0,slices=slices)square([2,3]);');expect(evaluate(p).volume).toBeCloseTo(24);p.parameters.slices='2.8';expect(evaluate(p).volume).toBeCloseTo(24);
 for(const slices of [1.8,2.8]){const a=importOpenSCAD(`linear_extrude(4,twist=60,slices=${slices})square([2,3]);`),b=importOpenSCAD(`linear_extrude(4,twist=60,slices=${Math.floor(slices)})square([2,3]);`);expect(evaluate(a).volume).toBeCloseTo(evaluate(b).volume,5);}
 for(const source of ['linear_extrude(4,twist=60,slices=0)square([2,3]);','linear_extrude(4,twist=0,scale=[2,1],slices=0)square([2,3]);'])expect(()=>importOpenSCAD(source)).toThrow();
});
