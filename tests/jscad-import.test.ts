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
it('reports unsupported upstream slice extrusion with a source location',()=>{
 const source=readFileSync('tests/fixtures/code-corpus/jscad/nutsAndBolts.js','utf8');
 expect(()=>importJSCAD(source)).toThrow(/Line .*JSCAD feature “extrusions\.extrudeFromSlices”/);
});
for(const parameters of [{},{numTeeth:12,thickness:7,centerholeradius:0}])it(`qualifies upstream gear extrusion and vec2 arithmetic: ${JSON.stringify(parameters)}`,()=>{
 const source=readFileSync('tests/fixtures/code-corpus/jscad/gear.js','utf8'),result=geometry(source,parameters);
 // Execute only this pinned MIT fixture in the reference test implementation.
 // Submitted source continues to use the bounded AST interpreter exclusively.
 const modeling=createRequire(import.meta.url)('@jscad/modeling'),context={module:{exports:{} as any},require:()=>modeling,parameters};
 runInNewContext(source+"\nmodule.exports.result=main({...Object.fromEntries(getParameterDefinitions().map(p=>[p.name,p.initial])),...parameters});",context,{timeout:3000});
 const expected=context.module.exports.result,expectedVolume=modeling.measurements.measureVolume(expected),expectedBounds=modeling.measurements.measureBoundingBox(expected);
 expect(result.imported.outputs).toHaveLength(1);
 expect(result.volume).toBeGreaterThan(0);
 expect(Math.abs(result.volume-expectedVolume)/expectedVolume).toBeLessThan(1e-7);
 for(let axis=0;axis<3;axis++){
  expect(result.bodies[0].bounds.min[axis]).toBeCloseTo(expectedBounds[0][axis],6);
  expect(result.bodies[0].bounds.max[axis]).toBeCloseTo(expectedBounds[1][axis],6);
 }
});
for(const example of codeExamples)it(`imports our real JSCAD export: ${example.id}`,()=>{
 const p=codeExampleProgram(example.id),s=createCadSession();s.addCode(p);expect(geometry(exportJSCAD(p)).volume).toBeCloseTo(kernel.evaluate(s.state.document).volume,4);
});

it('converts the upstream module-design component through its explicit create entry point',()=>{
 const source=readFileSync('tests/fixtures/code-corpus/jscad/mountPlate.js','utf8'),imported=importJSCAD(source,{}, {entryPoint:'create',arguments:[25]}),s=createCadSession();s.addCode(imported.program);expect(kernel.evaluate(s.state.document).volume).toBeCloseTo(250);
});
it('brings up the upstream involute gear including 2D maths, polygon extrusion and parameters',()=>{
 const source=readFileSync('tests/fixtures/code-corpus/jscad/gear.js','utf8'),result=geometry(source);expect(result.volume).toBeGreaterThan(0);expect(result.imported.parameters.numTeeth).toBe(10);
 const modeling=createRequire(import.meta.url)('@jscad/modeling'),context={module:{exports:{} as any},require:()=>modeling};runInNewContext(source+'\nmodule.exports.result=main(Object.fromEntries(getParameterDefinitions().map(p=>[p.name,p.initial])));',context,{timeout:10000});const expected=modeling.measurements.measureVolume(context.module.exports.result);expect(Math.abs(result.volume-expected)/expected).toBeLessThan(.002);const bounds=modeling.measurements.measureBoundingBox(context.module.exports.result);for(let i=0;i<3;i++){expect(result.bodies[0].bounds.min[i]).toBeCloseTo(bounds[0][i],4);expect(result.bodies[0].bounds.max[i]).toBeCloseTo(bounds[1][i],4);}
 const larger=geometry(source,{numTeeth:20});expect(larger.volume).toBeGreaterThan(result.volume);expect(()=>geometry(source,{numTeeth:21})).toThrow('declared range');expect(geometry(source,{numTeeth:'10'} as any).volume).toBeCloseTo(result.volume,4);
},20000);
it('bounds deeply nested or excessively large ASTs before evaluation and rejects nontext input',()=>{
 const source='module.exports.main=()=>'+ '['.repeat(200)+'1'+']'.repeat(200)+';';try{importJSCAD(source);throw Error('Expected resource failure');}catch(error:any){expect(error.code).toBe('resource-limit');}expect(()=>importJSCAD(null as any)).toThrow('source text');
});
