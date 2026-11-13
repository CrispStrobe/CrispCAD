// SPDX-License-Identifier: BSD-3-Clause
import {beforeAll,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {importJSCAD,exportJSCAD,codeExamples,codeExampleProgram,createCadSession} from '@brickwright/cad-core';
import {createGeometryKernel} from '@brickwright/cad-geometry';
import type {GeometryKernel} from '@brickwright/cad-geometry';
let kernel:GeometryKernel;beforeAll(async()=>{kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});});
const geometry=(source:string,parameters={})=>{const imported=importJSCAD(source,parameters),s=createCadSession();s.addCode(imported.program);return {...kernel.evaluate(s.state.document),imported};};
it('converts the upstream MIT Basic Booleans file, preserving separate outputs and colour metadata',()=>{
 const source=readFileSync('tests/fixtures/code-corpus/jscad/basicBooleans.js','utf8'),result=geometry(source);expect(result.volume).toBeGreaterThan(0);expect(result.imported.outputs).toHaveLength(5);expect(result.imported.outputs[0].color).toBe('#ff0000');expect(result.imported.outputs[1].color).toBe('#00ff00');expect(result.imported.warnings).toHaveLength(3);
 const modeling=createRequire(import.meta.url)('@jscad/modeling'),context={module:{exports:{} as any},require:()=>modeling};runInNewContext(source+'\nmodule.exports.result=main();',context,{timeout:3000});const expected=modeling.measurements.measureVolume(modeling.booleans.union(...context.module.exports.result));expect(Math.abs(result.volume-expected)/expected).toBeLessThan(.03);
});
it('supports ES imports, helper functions, parameters, radians and bounded geometry loops',()=>{
 const source=`import {primitives, transforms, booleans} from '@jscad/modeling';
 export const getParameterDefinitions=()=>[{name:'width',type:'float',initial:10}];
 function part(w){return primitives.cuboid({size:[w,4,6]});}
 export const main=(params)=>{const pieces=[];for(let i=0;i<3;i++){pieces.push(transforms.translate([i*20,0,0],part(params.width)));}return booleans.union(...pieces);};`;
 expect(geometry(source).volume).toBeCloseTo(720);expect(geometry(source,{width:15}).volume).toBeCloseTo(1080);
 const rotated=geometry("const {primitives:{cuboid},transforms:{rotate,translate}}=require('@jscad/modeling');module.exports.main=()=>translate([10,0,0],rotate([0,0,Math.PI/2],cuboid({size:[2,4,6]})));");expect(rotated.bodies[0].bounds.min[0]).toBeCloseTo(8);expect(rotated.bodies[0].bounds.min[1]).toBeCloseTo(-1);
});
it('refuses host access, external imports, dynamic execution and unbounded programs',()=>{
 for(const source of ["require('fs');",'process.exit();','globalThis.fetch("x");',"eval('1');","new Function('return 1')();","import fs from 'node:fs';",'const main=()=>{while(true){}};module.exports={main};','function f(){return f();}module.exports.main=f;','module.exports.main=()=>{const a=1;a=2;return a;};','module.exports.main=()=>{for(let i=0;i<1000;i++){}return 1;};',"module.exports.main=()=>require('@jscad/modeling').constructor('return 1')();"]){expect(()=>importJSCAD(source),source).toThrow();}
});
it('reports unsupported upstream geometry APIs with source locations',()=>{
 for(const file of ['nutsAndBolts','gear']){const source=readFileSync(`tests/fixtures/code-corpus/jscad/${file}.js`,'utf8');expect(()=>importJSCAD(source)).toThrow(/Line .*JSCAD|Line .*12.*96/);}
});
for(const example of codeExamples)it(`imports our real JSCAD export: ${example.id}`,()=>{
 const p=codeExampleProgram(example.id),s=createCadSession();s.addCode(p);expect(geometry(exportJSCAD(p)).volume).toBeCloseTo(kernel.evaluate(s.state.document).volume,4);
});
