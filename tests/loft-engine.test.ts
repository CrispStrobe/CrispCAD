// SPDX-License-Identifier: BSD-3-Clause
import {beforeAll,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {compileCode,createCadSession,exportJSCAD,exportOpenSCAD,importJSCAD,importOpenSCAD} from '@brickwright/cad-core';
import type {CodeProgram} from '@brickwright/cad-core';
import {createGeometryKernel} from '@brickwright/cad-geometry';
let kernel:Awaited<ReturnType<typeof createGeometryKernel>>;
beforeAll(async()=>{kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});});
const program=(source:string):CodeProgram=>({version:1,language:'brickwright-cad-script',parameters:{},source});
function evaluate(p:CodeProgram){const s=createCadSession();try{s.addCode(p);return kernel.evaluate(s.state.document);}finally{s.dispose();}}
const ring=(z:number,scale=1)=>[[0,0,z],[10*scale,0,z],[10*scale,10*scale,z],[0,10*scale,z]];
const loft=(sections:number[][][])=>program(`return loft(${JSON.stringify(sections)});`);
it('builds a capped loft with matching sections and exact analytic taper volume',()=>{
 const p=loft([ring(0),ring(20,.5)]),g=evaluate(p);expect(g.volume).toBeCloseTo(3500/3,5);expect(g.bodies[0].bounds).toEqual({min:[0,0,0],max:[10,10,20]});
 expect(evaluate(importOpenSCAD(exportOpenSCAD(p))).volume).toBeCloseTo(g.volume,5);expect(evaluate(importJSCAD(exportJSCAD(p)).program).volume).toBeCloseTo(g.volume,5);
});
it('normalizes descending sections and consistently clockwise rings without changing correspondence',()=>{
 const expected=evaluate(loft([ring(0),ring(20,.5)])).volume;
 for(const sections of [[ring(20,.5),ring(0)],[ring(0).reverse(),ring(20,.5).reverse()]])expect(evaluate(loft(sections)).volume).toBeCloseTo(expected,5);
});
it('supports concave sections and several shifted cross sections',()=>{
 const base=[[0,0],[3,0],[3,1],[1,1],[1,3],[0,3]],sections=[0,5,10].map(z=>base.map(([x,y])=>[x+z/10,y,z]));expect(evaluate(loft(sections)).volume).toBeCloseTo(50,5);
});
it('retains loft dimensions and atomic invalid edits through serialization and undo',()=>{
 const p=program('param width: mm = 10;param height: mm = 20;return loft([[[0,0,0],[width,0,0],[width,width,0],[0,width,0]],[[0,0,height],[width,0,height],[width,width,height],[0,width,height]]]);'),s=createCadSession();
 try{const id=s.addCode(p),first=s.serialize();expect(kernel.evaluate(s.state.document).volume).toBeCloseTo(2000);s.updateCode(id,{...p,parameters:{width:'15'}});const second=s.serialize();expect(kernel.evaluate(s.state.document).volume).toBeCloseTo(4500);expect(()=>s.updateCode(id,{...p,parameters:{height:'0'}})).toThrow('Loft');expect(s.serialize()).toBe(second);s.undo();expect(s.serialize()).toBe(first);s.redo();expect(s.serialize()).toBe(second);const restored=createCadSession(JSON.parse(second));try{expect(kernel.evaluate(restored.state.document).volume).toBeCloseTo(4500);}finally{restored.dispose();}}finally{s.dispose();}
});
it('refuses nonplanar, mismatched, crossed, repeated and reversed interior sections',()=>{
 for(const sections of [[ring(0)],[ring(0),ring(0)],[ring(0),ring(10).slice(1)],[ring(0),ring(10).reverse()],[ring(0),ring(10),ring(5)],[ring(0),[[0,0,10],[10,0,11],[10,10,10],[0,10,10]]],[ring(0),[[0,0,10],[10,10,10],[10,0,10],[0,10,10]]],[ring(0),[[0,0,10],[10,0,10],[10,0,10],[0,10,10]]]])expect(()=>compileCode(loft(sections))).toThrow('Loft');
});
const source=`const {extrusions:{extrudeFromSlices,slice},maths:{mat4}}=require('@jscad/modeling');
const options={height:12,count:5};
const make=(options)=>extrudeFromSlices({numberOfSlices:options.count,callback:(progress,index,base)=>{
 const points=[];for(let i=0;i<8;i++){const a=2*Math.PI*i/8;const r=4+Math.cos(a-progress*Math.PI)*.5;points.push([r*Math.cos(a),r*Math.sin(a),0]);}
 return slice.transform(mat4.fromTranslation(mat4.create(),[progress,0,progress*options.height]),slice.fromPoints(points));
}},{});
const main=()=>make({...options,height:15});module.exports={main};`;
it('imports bounded callbacks, safe object spread and transformed slices against real MIT JSCAD',()=>{
 const imported=importJSCAD(source),g=evaluate(imported.program);expect(imported.program.source).toContain('loft(');
 const modeling=createRequire(import.meta.url)('@jscad/modeling'),context={module:{exports:{} as any},require:()=>modeling};runInNewContext(source+';module.exports.solid=main();',context,{timeout:3000});const reference=context.module.exports.solid;
 expect(g.volume).toBeCloseTo(modeling.measurements.measureVolume(reference),4);const bounds=modeling.measurements.measureBoundingBox(reference);for(let i=0;i<3;i++){expect(g.bodies[0].bounds.min[i]).toBeCloseTo(bounds[0][i],5);expect(g.bodies[0].bounds.max[i]).toBeCloseTo(bounds[1][i],5);}
 expect(evaluate(importOpenSCAD(exportOpenSCAD(imported.program))).volume).toBeCloseTo(g.volume,4);expect(evaluate(importJSCAD(exportJSCAD(imported.program)).program).volume).toBeCloseTo(g.volume,4);
});
it('retains callback parameter overrides as independently evaluated snapshots',()=>{
 const parameterized=source.replace('const main=()=>make({...options,height:15});module.exports={main};','const getParameterDefinitions=()=>[{name:"height",type:"float",initial:15}];const main=(p)=>make({...options,height:p.height});module.exports={main,getParameterDefinitions};');
 const a=evaluate(importJSCAD(parameterized).program),b=evaluate(importJSCAD(parameterized,{height:30}).program);expect(b.volume).toBeCloseTo(a.volume*2,4);expect(b.bodies[0].bounds.max[2]).toBe(30);
});
it('supports skipped interior slices and 2D base slices without repairing authored inputs',()=>{
 const p=importJSCAD(`const {extrusions:{extrudeFromSlices,slice},maths:{mat4}}=require('@jscad/modeling');const main=()=>extrudeFromSlices({repair:false,numberOfSlices:3,callback:(p,i,base)=>i===1?null:slice.transform(mat4.fromTranslation(mat4.create(),[0,0,p*10]),base)},slice.fromPoints([[0,0],[2,0],[2,2],[0,2]]));module.exports={main};`);expect(evaluate(p.program).volume).toBeCloseTo(40);
});
it('rejects unsafe spread, malformed callbacks, uncapped meshes and excess callback work',()=>{
 const before=createCadSession();try{const saved=before.serialize();for(const bad of [source.replace('make({...options,height:15})','make({...options,constructor:1})'),source.replace('slice.transform(mat4.fromTranslation','({}).constructor(mat4.fromTranslation'),source.replace('numberOfSlices:options.count','capEnd:false,numberOfSlices:options.count'),source.replace('numberOfSlices:options.count','numberOfSlices:129'),source.replace('return slice.transform','return 3;return slice.transform'),source.replace('for(let i=0;i<8;i++)','for(let i=0;i<65;i++)')])expect(()=>before.addCode(importJSCAD(bad).program)).toThrow();expect(before.serialize()).toBe(saved);}finally{before.dispose();}
});
it('keeps the unchanged upstream full nuts/bolts demo bounded rather than reducing authored resolution',()=>{
 try{importJSCAD(readFileSync('tests/fixtures/code-corpus/jscad/nutsAndBolts.js','utf8'));throw Error('Expected bounded failure');}catch(error){expect(error).toMatchObject({code:'resource-limit'});}
});

it('bounds native loft section counts and source expansion without widening polyhedron limits',()=>{expect(()=>compileCode(loft(Array.from({length:129},(_,i)=>ring(i))))).toThrow('Loft exceeds');expect(()=>compileCode(program('return loft([]);'))).toThrow('Loft');});

it('rejects inside-out JSCAD slice shells instead of repairing their orientation silently',()=>{
 const modeling=createRequire(import.meta.url)('@jscad/modeling');
 for(const clockwise of [false,true])for(const descending of [false,true]){
  const ring=[[0,0],[4,0],[4,4],[0,4]];if(clockwise)ring.reverse();
  const src=`const {extrusions:{extrudeFromSlices,slice}}=require('@jscad/modeling');const main=()=>extrudeFromSlices({numberOfSlices:3,callback:p=>slice.fromPoints(${JSON.stringify(ring)}.map(a=>[a[0],a[1],${descending?'10-p*10':'p*10'}]))},{});module.exports={main};`,context={module:{exports:{} as any},require:()=>modeling};
  runInNewContext(src+';module.exports.solid=main();',context,{timeout:3000});const reference=modeling.measurements.measureVolume(context.module.exports.solid);
  if(reference<0)expect(()=>importJSCAD(src)).toThrow('inside-out slice loft');else expect(evaluate(importJSCAD(src).program).volume).toBeCloseTo(reference,5);
 }
});
