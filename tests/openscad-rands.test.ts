// SPDX-License-Identifier: BSD-3-Clause
import {readFileSync} from 'node:fs';
import {beforeAll,expect,it} from 'vitest';
import {createCadSession,importOpenSCAD,getOpenSCADImportWarnings,getOpenSCADImportNotices,compileCode} from '@brickwright/cad-core';
import {createGeometryKernel} from '@brickwright/cad-geometry';
let kernel:Awaited<ReturnType<typeof createGeometryKernel>>;
beforeAll(async()=>{kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});});
function evaluate(source:string){const program=importOpenSCAD(source),session=createCadSession();try{session.addCode(program);return kernel.evaluate(session.state.document);}finally{session.dispose();}}
it('retains explicit seeds as repeatable independent sampling streams within authored ranges',()=>{
 const source=(seed:string)=>`a=rands(2,5,3,${seed});cube(a);`;
 const first=evaluate(source('42')),same=evaluate(source('42')),other=evaluate(source('43'));
 expect(first.bodies[0].bounds).toEqual(same.bodies[0].bounds);expect(other.bodies[0].bounds).not.toEqual(first.bodies[0].bounds);
 for(const value of first.bodies[0].bounds.max){expect(value).toBeGreaterThanOrEqual(2);expect(value).toBeLessThanOrEqual(5);}
 expect(evaluate('a=rands(3,3,3,1);cube(a);').volume).toBeCloseTo(27);
 expect(evaluate('cube([len(rands(0,1,64,0)),1,1]);').volume).toBeCloseTo(64);
 expect(evaluate('cube(len(rands(0,1,0,0))+1);').volume).toBeCloseTo(1);
});
it('binds unseeded snapshots reproducibly to source while advancing separate invocation draws',()=>{
 const source='module part(){a=rands(2,5,1)[0];cube([a,a,1]);}part();translate([10,0,0])part();';
 expect(importOpenSCAD(source).source).toBe(importOpenSCAD(source).source);
 const geometry=evaluate(source);expect(geometry.volume).toBeGreaterThan(8);expect(geometry.volume).toBeLessThan(50);
 expect(importOpenSCAD(source+'\n// distinct original').source).not.toBe(importOpenSCAD(source).source);
 const warnings=getOpenSCADImportWarnings(importOpenSCAD(source));expect(warnings.join(' ')).toContain('source-derived');expect(warnings.join(' ')).toContain('fixed in the imported snapshot');
 const explicit=getOpenSCADImportWarnings(importOpenSCAD('cube(rands(2,3,1,2)[0]);')).join(' ');expect(explicit).not.toContain('Unseeded');
});
it('floors constant fractional indices while retaining invalid-index and typed-number guards',()=>{
 expect(evaluate('palette=["red","blue"];color(palette[.75])cube(2);').volume).toBeCloseTo(8);
 expect(evaluate('a=[2,3,4];cube(a[1.9]);').volume).toBeCloseTo(27);
 expect(evaluate('cube(is_undef([1,2][-0.1])?2:1);').volume).toBeCloseTo(8);
 for(const source of ['cube([2,3][true]);','cube([2,3]["0"]);','cube([2,3][-1]);','cube([2,3][2]);'])expect(()=>importOpenSCAD(source)).toThrow();
});
it('fails closed on invalid sampling arguments and bounds unseeded snapshots and work',()=>{
 const session=createCadSession(),before=session.serialize(),state=session.state;
 try{for(const source of ['cube(rands(0,1)[0]);','cube(rands(1,0,1)[0]);','cube(rands(0,1,-1)[0]);','cube(rands(0,1,.5)[0]);','cube(rands(0,1,true)[0]);','cube(rands(0,1,1,"s")[0]);','cube(rands(0,1/0,1)[0]);',])expect(()=>session.addCode(importOpenSCAD(source))).toThrow();
  expect(()=>importOpenSCAD('cube(len(rands(0,1,65)));')).toThrow('Loop exceeds 64');
  expect(()=>importOpenSCAD('a=[for(i=[0:63],j=[0:63])rands(0,1,64,1)];cube(1);')).toThrow();
  expect(session.serialize()).toBe(before);expect(session.state).toEqual(state);
 }finally{session.dispose();}
});
it('does not sample or evaluate missing operations in inactive branches and retains live assertions',()=>{
 expect(evaluate('if(false)cube(rands(fetch(),0,1)[0]);else cube(2);').volume).toBeCloseTo(8);
 const p=importOpenSCAD('size=2;cube(assert(size>0)rands(2,3,1,42)[0]);');p.parameters.size='-1';expect(()=>compileCode(p)).toThrow(/assertion failed/i);
 const guarded=importOpenSCAD('size=2;a=rands(assert(size>0)2,3,1,42);cube(a[0]);');guarded.parameters.size='-1';expect(()=>compileCode(guarded)).toThrow(/assertion failed/i);
 const shadow=importOpenSCAD('function rands(a,b,c)=[3];cube(rands(0,1,1)[0]);');expect(getOpenSCADImportWarnings(shadow)).toEqual([]);
});

it('preserves seeded and dynamic random parameters instead of replacing them with constant snapshots',()=>{const p=importOpenSCAD('seed=1;low=1;cube(rands(low,2,1,seed)[0]);'),a=createCadSession();try{a.addCode(p);const before=kernel.evaluate(a.state.document).volume;p.parameters.seed='2';a.updateCode(a.state.document.roots[0],p);expect(kernel.evaluate(a.state.document).volume).not.toBe(before);expect(p.source).toContain('randomValue');}finally{a.dispose();}});

it('does not memoize direct or transitive functions that consume unseeded snapshot draws',()=>{for(const declarations of ['function sample()=rands(2,3,1)[0];','function inner()=rands(2,3,1)[0];function sample()=inner();']){const g=evaluate(declarations+'cube([sample(),sample(),1]);');expect(g.bodies[0].bounds.max[0]).not.toBe(g.bodies[0].bounds.max[1]);}});

it('retains machine-readable random substitution notices for snapshot calls',()=>{expect(getOpenSCADImportNotices(importOpenSCAD('cube(rands(2,3,1)[0]);')).map(n=>n.id)).toContain('scad.random.sequence');});
