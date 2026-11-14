// SPDX-License-Identifier: BSD-3-Clause
import {beforeAll,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createCadSession,compileCode,importOpenSCAD,importJSCAD,exportJSCAD} from '@brickwright/cad-core';
import {createGeometryKernel} from '@brickwright/cad-geometry';
import type {CodeProgram} from '@brickwright/cad-core';
let kernel:Awaited<ReturnType<typeof createGeometryKernel>>;
beforeAll(async()=>{kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});});
const native=(source:string,parameters:Record<string,string>={}):CodeProgram=>({version:1,language:'brickwright-cad-script',source,parameters});
function evaluate(p:CodeProgram){const s=createCadSession();try{s.addCode(p);return kernel.evaluate(s.state.document);}finally{s.dispose();}}
it('does not reuse named shapes across different loop environments',()=>{
 const p=native('param step:scalar=1;let part=box(i*step,1,1);return forRange(i,1,3,1,move([10*i,0,0],part));');expect(evaluate(p).volume).toBeCloseTo(6);p.parameters.step='2';expect(evaluate(p).volume).toBeCloseTo(12);
});
it('keys lazy constants by reduction values and retains typed and inferred units',()=>{
 const p=native('param step:scalar=2;const width=i*step;return box(sumRange(i,1,3,1,width),1,1);');expect(evaluate(p).volume).toBeCloseTo(12);p.parameters.step='3';expect(evaluate(p).volume).toBeCloseTo(18);
 expect(evaluate(native('const length=2 cm;param width:mm=length;return box(width,1,1);')).volume).toBeCloseTo(20);expect(()=>compileCode(native('const angle:deg=20;return box(angle,1,1);'))).toThrow('Expected mm');
});
it('keeps vector-valued comprehension variables editable after materialization',()=>{
 const p=importOpenSCAD('offset=10;points=[[1,2],[3,4]];mapped=[for(p=points)p+[offset,20]];cube(mapped[1][0]);');expect(evaluate(p).volume).toBeCloseTo(2197);p.parameters.offset='20';expect(evaluate(p).volume).toBeCloseTo(12167);
});
it('does not conflate different captured functions in memoized calls',()=>{
 const p=importOpenSCAD('function make(x)=function(y)x+y;function apply(f)=f(3);cube([apply(make(2)),apply(make(4)),1]);');expect(evaluate(p).volume).toBeCloseTo(35);
});
it('retains expression assertion messages and default-argument guards on atomic edits',()=>{
 const p=importOpenSCAD('n=2;function size(x)=assert(x>0,str("bad n=",x))x;cube(size(n));'),s=createCadSession();try{const id=s.addCode(p),before=s.serialize();expect(()=>s.updateCode(id,{...p,parameters:{n:'-3.141592653589793'}})).toThrow('bad n=-3.14159');expect(s.serialize()).toBe(before);}finally{s.dispose();}
 const unused=importOpenSCAD('n=2;function f(x=assert(n>0,"invalid default")1)=2;cube(f());');expect(evaluate(unused).volume).toBeCloseTo(8);expect(()=>compileCode({...unused,parameters:{n:'-1'}})).toThrow('invalid default');const selected=importOpenSCAD('n=2;cube(assert(n>0,n==0?"zero":"negative")n);');expect(()=>compileCode({...selected,parameters:{n:'0'}})).toThrow('zero');expect(()=>compileCode({...selected,parameters:{n:'-1'}})).toThrow('negative');
});
it('exports signed scales through supported JSCAD reflections with unchanged bounds',()=>{
 for(const source of ['return scale([-1,1,1],move([4,0,0],box(2,3,4)));','return extrudeProfile(2,scale2d(-2,3,move2d(4,2,rectangle2d(2,3))));']){const original=evaluate(native(source)),roundtrip=evaluate(importJSCAD(exportJSCAD(native(source))).program);expect(roundtrip.volume).toBeCloseTo(original.volume,5);expect(roundtrip.bodies[0].bounds).toEqual(original.bodies[0].bounds);}
 const source="const {primitives:{rectangle},transforms:{mirror},extrusions:{extrudeLinear}}=require('@jscad/modeling');const main=()=>extrudeLinear({height:1},mirror({normal:[1,0,0],origin:[1,0,0]},rectangle({size:[2,3]})));module.exports={main};";const result=evaluate(importJSCAD(source).program);expect(result.volume).toBeCloseTo(6);expect(result.bodies[0].bounds.min[0]).toBeCloseTo(1);expect(result.bodies[0].bounds.max[0]).toBeCloseTo(3);
});
it('distinguishes exhausted scalar parser budgets from malformed source',()=>{
 const expression=Array(260).fill('1').join('+');
 for(const call of [()=>compileCode(native(`return box(${expression},1,1);`))]){try{call();throw Error('expected resource refusal');}catch(e:any){expect(e.code).toBe('resource-limit');}}
 expect(evaluate(importOpenSCAD(`cube(${expression});`)).volume).toBeCloseTo(260**3);
 try{compileCode(native('return box(1+/,1,1);'));throw Error('expected syntax refusal');}catch(e:any){expect(e.code).toBe('invalid-source');}
});
