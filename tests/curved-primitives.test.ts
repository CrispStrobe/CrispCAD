// SPDX-License-Identifier: BSD-3-Clause
import {beforeAll,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createCadSession,importJSCAD,importOpenSCAD,compileCode,exportOpenSCAD,exportJSCAD} from '@brickwright/cad-core';
import {createGeometryKernel} from '@brickwright/cad-geometry';
const modeling=createRequire(import.meta.url)('@jscad/modeling');let kernel:Awaited<ReturnType<typeof createGeometryKernel>>;
beforeAll(async()=>{kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});});
const evaluate=(program:any)=>{const s=createCadSession();try{s.addCode(program);return kernel.evaluate(s.state.document);}finally{s.dispose();}};
const native=(source:string)=>({version:1 as const,language:'brickwright-cad-script' as const,parameters:{},source});
for(const [name,opts]of [
 ['torus',{}],['torus',{innerRadius:1.3,outerRadius:5,innerSegments:12,outerSegments:24}],['torus',{innerRadius:1,outerRadius:4,innerSegments:5,outerSegments:19,outerRotation:2.1,startAngle:.4,innerRotation:.3}],
 ['ellipsoid',{radius:[3,2,1],segments:12,center:[2,-3,4]}],['ellipsoid',{radius:[2,4,3],segments:8}],['ellipsoid',{radius:[2,3,4],segments:10}],
 ['roundedCylinder',{}],['roundedCylinder',{radius:4,height:12,roundRadius:1,segments:24,center:[2,3,4]}],['roundedCylinder',{radius:3,height:5,roundRadius:.4,segments:12}],['roundedCylinder',{radius:3,height:5,roundRadius:.4,segments:10}],['roundedCylinder',{radius:3,height:5,roundRadius:0,segments:7}],['roundedCylinder',{radius:3,height:5,roundRadius:.4,segments:7}],
] as const)it(`qualifies ${name} ${JSON.stringify(opts)} against the real MIT runtime`,()=>{
 const source=`const {primitives:{${name}}}=require('@jscad/modeling');module.exports.main=()=>${name}(${JSON.stringify(opts)});`,program=importJSCAD(source).program,g=evaluate(program),expected=modeling.primitives[name](opts),volume=modeling.measurements.measureVolume(expected),bounds=modeling.measurements.measureBoundingBox(expected);
 expect(g.volume).toBeCloseTo(volume,4);for(let i=0;i<3;i++){expect(g.bodies[0].bounds.min[i]).toBeCloseTo(bounds[0][i],5);expect(g.bodies[0].bounds.max[i]).toBeCloseTo(bounds[1][i],5);}
 expect(evaluate(importOpenSCAD(exportOpenSCAD(program))).volume).toBeCloseTo(g.volume,4);expect(evaluate(importJSCAD(exportJSCAD(program)).program)).toBeDefined();
});
it('retains native torus, ellipsoid and rounding parameters without coordinate expansion',()=>{
 for(const source of ['param r:mm=4;return torus(r,1,16,32);','param r:mm=4;return ellipsoid(r,2,3,24);','param r:mm=4;return roundedCylinder(r,12,.5,24);']){const p=native(source),before=evaluate(p).volume;expect(evaluate({...p,parameters:{r:'6'}}).volume).toBeGreaterThan(before);}
});
it('rejects self intersections, invalid rounding and excessive meshes under existing budgets',()=>{
 for(const source of ['return torus(1,2);','return roundedCylinder(3,4,2);','return roundedCylinder(3,9,3);','return ellipsoid(-1,2,3);','return torus(4,1,4096,4096);'])expect(()=>compileCode(native(source))).toThrow();
});
for(const [source,volume]of [
 ['n=3;cube([min([for(i=[1:n])for(j=[2:n])i*j]),1,1]);',2],
 ['n=3;cube([max([for(i=[1:n])for(j=[2:n])if(i!=j)i*j]),1,1]);',6],
 ['n=3;v=min([for(i=[0:n])for(j=[0:i])if(j>i)j]);cube(is_undef(v)?2:1);',8],
 ['n=3;cube([max([for(i=[1:n])each [i,i*2]]),1,1]);',6],
 ['n=3;cube([abs(min([for(i=[1:n])for(j=[1:2])-(i+j)])),1,1]);',5],
]as const)it('retains nested SCAD reductions: '+source,()=>{
 const p=importOpenSCAD(source);if(volume)expect(evaluate(p).volume).toBeCloseTo(volume);else expect(compileCode(p).shape).toBeDefined();
 p.parameters.n='4';expect(compileCode(p).shape).toBeDefined();
});

it('retains empty nested reductions across parameter edits and negative extrema',()=>{
 const p=importOpenSCAD('n=2;v=max([for(i=[0:n])for(j=[0:n])if(i+j>5)i+j]);cube(is_undef(v)?1:v);');expect(evaluate(p).volume).toBeCloseTo(1);p.parameters.n='4';expect(evaluate(p).volume).toBeCloseTo(512);
 expect(evaluate(importOpenSCAD('cube([abs(min([for(i=[-3,-2])for(j=[1:3])i*j])),1,1]);')).volume).toBeCloseTo(9);
 expect(()=>importOpenSCAD('cube(min([for(i=[1:3])for(j=[1:3])[i,j]]));')).toThrow();
 expect(evaluate(native('return union(box(1,1,1),ellipsoid(0,2,3));')).volume).toBeCloseTo(1);
});

it('does not count a module dispatch as another emitted shape while retaining recursion limits',()=>{
 const source=Array.from({length:24},(_,i)=>`module shape${i}(){${i===23?'cube(2)':`shape${i+1}()`};}`).join('\n')+'\nshape0();';expect(evaluate(importOpenSCAD(source)).volume).toBeCloseTo(8);
 for(const source of ['module recur(){recur();}recur();','module recur(n){if(n>0)translate([1,0,0])recur(n-1);else cube(1);}recur(40);'])try{importOpenSCAD(source);throw Error('Expected bounded recursion');}catch(error){expect(error).toMatchObject({code:'resource-limit'});}
});
