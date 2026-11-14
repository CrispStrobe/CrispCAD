// SPDX-License-Identifier: BSD-3-Clause
import {beforeAll,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {compileCode,createCadSession,exportOpenSCAD,importOpenSCAD} from '@brickwright/cad-core';
import {createGeometryKernel} from '@brickwright/cad-geometry';
import type {GeometryKernel} from '@brickwright/cad-geometry';

let kernel:GeometryKernel;
beforeAll(async()=>{kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});});
function evaluate(source:string,parameters:Record<string,string>={}){
 const program=importOpenSCAD(source);program.parameters=parameters;
 const session=createCadSession();try{session.addCode(program);return kernel.evaluate(session.state.document);}finally{session.dispose();}
}

it('expands finite ranges with existing descending and fractional endpoint conventions',()=>{
 expect(evaluate('a=[for(i=[0:3])i+1];cube(a[2]);').volume).toBeCloseTo(27);
 expect(evaluate('a=[for(i=[3:1])i];cube(a);').bodies[0].bounds.max).toEqual([1,2,3]);
 expect(evaluate('a=[for(i=[3:-1:1])i];cube(a);').bodies[0].bounds.max).toEqual([3,2,1]);
 expect(evaluate('a=[for(i=[0:.1:.3])i];cube([len(a),1,1]);').volume).toBeCloseTo(4);
 expect(evaluate('a=[for(i=[2:2])i];cube(a[0]);').volume).toBeCloseTo(8);
});

it('keeps coordinates editable when a fixed-length vector contains global parameter expressions',()=>{
 const source='width=2;values=[for(n=[width,width*2])n+1];cube([values[0],values[1],1]);';
 expect(evaluate(source).volume).toBeCloseTo(15);expect(evaluate(source,{width:'3'}).volume).toBeCloseTo(28);
 const program=importOpenSCAD(source);program.parameters.width='3';expect(evaluate(exportOpenSCAD(program)).volume).toBeCloseTo(28);
 const polygon='radius=2;module part(order=4){angles=[for(i=[0:order-1])i*360/order];points=[for(angle=angles)[radius*cos(angle),radius*sin(angle)]];linear_extrude(3)polygon(points);}part();';
 expect(evaluate(polygon).volume).toBeCloseTo(24,5);expect(evaluate(polygon,{radius:'3'}).volume).toBeCloseTo(54,5);
});

it('restores lexical bindings and retains nested typed list values',()=>{
 expect(evaluate('i=9;a=[for(i=[1:2])[for(j=[0:i])i+j]];cube([len(a[0]),len(a[1]),i]);').volume).toBeCloseTo(54);
 expect(evaluate('module part(i=3){a=[for(i=[1:2])i];cube([a[0],a[1],i]);}part();').volume).toBeCloseTo(6);
 expect(evaluate('a=[for(x=["red",undef,[2,3]])x];cube([len(a),is_undef(a[1])?2:1,a[2][1]]);').volume).toBeCloseTo(18);
 expect(()=>importOpenSCAD('a=[for(x=["2"])x];cube(a[0]);')).toThrow();
});

it('does not evaluate an empty comprehension body and accepts the existing 64-item loop boundary',()=>{
 for(const range of ['[]','[3:1:0]','[0:-1:3]'])expect(evaluate(`a=[for(i=${range})unavailable()];cube(len(a)+1);`).volume).toBeCloseTo(1);
 expect(evaluate('a=[for(i=[0:63])i];cube([len(a),1,1]);').volume).toBeCloseTo(64);
 expect(evaluate('empty=[];a=[for(i=empty)unavailable()];cube(len(a)+1);').volume).toBeCloseTo(1);
});

it('rejects symbolic cardinality and invalid ranges without changing a model',()=>{
 const session=createCadSession(),before=structuredClone(session.state.document);
 for(const source of [
  'count=4;a=[for(i=[0:count-1])i];cube(len(a));',
  'count=1;lists=[[1],[1,2]];a=[for(i=lists[count])i];cube(len(a));',
  'a=[for(i=[0:0:3])i];cube(2);',
  'a=[for(i=[0:1/0:3])i];cube(2);',
  'a=[for(i=[0:1e999])i];cube(2);',
  'a=[for(i=[true:3])i];cube(2);',
  'a=[for(i=["0":3])i];cube(2);',
  'a=[for(i=undef)i];cube(2);',
  'a=[for(i=[0:1])fetch("https://example.com")];cube(2);',
  'a=[for(i=[1],j=[2])i+j];cube(2);',
  'a=[for(i=[1])if(i)1];cube(2);',
  'a=[for(i=[])each [1,2]];cube(2);',
  'a=[for(i=[1])for(j=[2])i+j];cube(2);',
  'a=[for(i=0;i<2;i=i+1)i];cube(2);',
 ])expect(()=>session.addCode(importOpenSCAD(source)),source).toThrow();
 expect(session.state.document).toEqual(before);expect(compileCode(importOpenSCAD('cube(2);')).shape.kind).toBe('move');session.dispose();
});

it('retains array, loop, depth and cumulative value-evaluation resource limits',()=>{
 for(const source of [
  'a=[for(i=[0:64])i];cube(2);',
  `a=[for(i=[${Array.from({length:65},(_,i)=>i).join(',')}])i];cube(2);`,
  `a=[for(i=[0])[${Array(257).fill('1').join(',')}]];cube(2);`,
  `a=${'[for(i=[0])'.repeat(34)}1${']'.repeat(34)};cube(2);`,
  'a=[for(i=[0:63])[for(j=[0:63])[for(k=[0:63])k]]];cube(len(a));',
 ]){try{importOpenSCAD(source);throw Error('Expected resource failure');}catch(error:any){expect(error.code,source).toBe('resource-limit');}}
});
