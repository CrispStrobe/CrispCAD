// SPDX-License-Identifier: BSD-3-Clause
import {beforeAll,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createCadSession,importJSCAD,compileCode,importOpenSCAD,exportOpenSCAD,exportJSCAD} from '@brickwright/cad-core';
import {createGeometryKernel} from '@brickwright/cad-geometry';
const modeling=createRequire(import.meta.url)('@jscad/modeling');let kernel:Awaited<ReturnType<typeof createGeometryKernel>>;
beforeAll(async()=>{kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});});
const evaluate=(program:any)=>{const s=createCadSession();try{s.addCode(program);return kernel.evaluate(s.state.document);}finally{s.dispose();}};
for(const opts of [
 {startAngle:.3,endAngle:2.3,segments:12},
 {startAngle:0,endAngle:Math.PI/2,segments:12},
 {startAngle:5,endAngle:1,segments:12},
 {startAngle:1,endAngle:1,segments:12},
 {startAngle:7,endAngle:8,segments:12},
 {startAngle:.2,endAngle:2,segments:16,startRadius:[0,0]},
 {startAngle:0,endAngle:3,segments:16,endRadius:[0,0]},
 {startAngle:0,endAngle:Math.PI,segments:16,startRadius:[3,3],endRadius:[2,2]},
])it('matches independently executed JSCAD angular tapers '+JSON.stringify(opts),()=>{
 const options={startRadius:[5,3],endRadius:[2,4],height:8,center:[2,3,4],...opts},expected=modeling.primitives.cylinderElliptic(options),program=importJSCAD(`const {primitives:{cylinderElliptic}}=require('@jscad/modeling');module.exports.main=()=>cylinderElliptic(${JSON.stringify(options)});`).program,g=evaluate(program),bounds=modeling.measurements.measureBoundingBox(expected);
 expect(g.volume).toBeCloseTo(modeling.measurements.measureVolume(expected),4);for(let i=0;i<3;i++){expect(g.bodies[0].bounds.min[i]).toBeCloseTo(bounds[0][i],5);expect(g.bodies[0].bounds.max[i]).toBeCloseTo(bounds[1][i],5);}
 expect(evaluate(importOpenSCAD(exportOpenSCAD(program))).volume).toBeCloseTo(g.volume,4);expect(evaluate(importJSCAD(exportJSCAD(program)).program).volume).toBeCloseTo(g.volume,4);
});
it('retains native radius and angular parameters and refuses zero-side upstream artifacts',()=>{
 const p={version:1 as const,language:'brickwright-cad-script' as const,parameters:{},source:'param radius:mm=5;param end:deg=120;return ellipticFrustum(radius,3,2,4,8,32,15,end);'};const a=evaluate(p).volume;expect(evaluate({...p,parameters:{radius:'7'}}).volume).toBeGreaterThan(a);expect(evaluate({...p,parameters:{end:'180 deg'}}).volume).toBeGreaterThan(a);
 expect(()=>compileCode({...p,source:'return ellipticFrustum(5,3,2,4,8,12,0,1);'})).toThrow('at least one angular segment');
 try{importJSCAD("const {primitives:{cylinderElliptic}}=require('@jscad/modeling');module.exports.main=()=>cylinderElliptic({startRadius:[5,3],endRadius:[2,4],segments:12,endAngle:.1});");throw Error('Expected refusal');}catch(error){expect(error).toMatchObject({code:'unsupported-feature'});}
});

it('preserves tessellation at radian-to-degree segment boundaries',()=>{
 for(const segments of [12,16,24])for(const startAngle of [0,.3,7,23])for(const fraction of [1/6,1/4,1/3,1/2,2/3,3/4,1]){
  const options={startRadius:[5,3],endRadius:[2,4],height:8,segments,startAngle,endAngle:startAngle+fraction*2*Math.PI},expected=modeling.measurements.measureVolume(modeling.primitives.cylinderElliptic(options)),p=importJSCAD(`const {primitives:{cylinderElliptic}}=require('@jscad/modeling');module.exports.main=()=>cylinderElliptic(${JSON.stringify(options)});`).program;expect(evaluate(p).volume,JSON.stringify(options)).toBeCloseTo(expected,4);
 }
});

it('keeps explicit angular resolution validation and resource classification before empty geometry',()=>{
 const p={version:1 as const,language:'brickwright-cad-script' as const,parameters:{},source:'return ellipticFrustum(5,3,2,4,0,12,0,90,0);'};expect(()=>compileCode(p)).toThrow();
 try{compileCode({...p,source:'return ellipticFrustum(5,3,2,4,8,12,0,90,maxRange(i,1,300,1,i));'});throw Error('Expected budget refusal');}catch(error){expect(error).toMatchObject({code:'resource-limit'});}
});
