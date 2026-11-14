// SPDX-License-Identifier: BSD-3-Clause
import {beforeAll,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {createCadSession,importOpenSCAD,importJSCAD,compileCode,evaluateExpression,exportJSCAD,exportOpenSCAD,validateDocument,defaultGenerator,screwVariant,checkGenerator,constrainCubeTransform} from '@brickwright/cad-core';
import {createGeometryKernel} from '@brickwright/cad-geometry';
import {createPresetDocument,shapeCatalog} from '../packages/editor/src/shapes.js';
let kernel:Awaited<ReturnType<typeof createGeometryKernel>>;
beforeAll(async()=>{kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});});
const evaluate=(p:any)=>{const s=createCadSession();try{s.addCode(p);return kernel.evaluate(s.state.document);}finally{s.dispose();}};
it('reduces parametric and filtered SCAD lists without freezing edits or evaluating empty branches',()=>{
 for(const [source,width]of [['n=4;cube([max([for(i=[0:n])i*i]),1,1]);',16],['n=4;cube([min([for(i=[0:n])if(i>1)i*i]),1,1]);',4],['n=4;cube([max([2,for(i=[0:n])i*i,3]),1,1]);',16],['n=4;cube([max([0:n]),1,1]);',4]] as const){const p=importOpenSCAD(source);expect(evaluate(p).volume).toBeCloseTo(width);p.parameters.n='6';expect(evaluate(p).volume).toBeGreaterThanOrEqual(width);}
 expect(evaluate(importOpenSCAD('cube(is_undef(min([]))?2:1);')).volume).toBeCloseTo(8);
 const p=importOpenSCAD('n=3;v=min([for(i=[0:n])if(i>2)i]);cube(is_undef(v)?2:v);');expect(evaluate(p).volume).toBeCloseTo(27);p.parameters.n='1';expect(evaluate(p).volume).toBeCloseTo(8);
});
it('native extrema preserve units, bound scopes, inactive branches and reduction budgets',()=>{
 const refs=new Set<string>(),lookup=(name:string)=>{if(name==='length')return {value:2,length:1,angle:0};throw Error(name);};
 expect(evaluateExpression('maxRange(i,0,4,1,i*length)',lookup,{references:refs})).toEqual({value:8,length:1,angle:0});expect([...refs]).toEqual(['length']);
 expect(evaluateExpression('minRange(i,0,4,1,i>2,i*length)',lookup).value).toBe(6);
 expect(()=>evaluateExpression('minRange(i,0,2,1,false,i)',lookup)).toThrow('no values');expect(()=>evaluateExpression('maxRange(i,0,300,1,i)',lookup)).toThrow('256');
 expect(evaluateExpression('true?2:maxRange(i,0,300,1,i)',lookup).value).toBe(2);
 expect(()=>evaluateExpression('maxRange(i,0,2,1,i?1 mm:1 deg)',lookup)).toThrow('matching');
});
for(const [start,end]of [[[5,3],[2,4]],[[5,3],[0,0]],[[0,0],[4,2]]] as const)it(`matches real JSCAD elliptical taper ${start}/${end} and retains native dimensions`,()=>{
 const src=`const {primitives:{cylinderElliptic}}=require('@jscad/modeling');const main=()=>cylinderElliptic({startRadius:${JSON.stringify(start)},endRadius:${JSON.stringify(end)},height:12,segments:24,center:[4,2,3]});module.exports={main};`,modeling=createRequire(import.meta.url)('@jscad/modeling'),context={module:{exports:{} as any},require:()=>modeling};runInNewContext(src+';module.exports.solid=main();',context,{timeout:4000});const g=evaluate(importJSCAD(src).program),bounds=modeling.measurements.measureBoundingBox(context.module.exports.solid);expect(g.volume).toBeCloseTo(modeling.measurements.measureVolume(context.module.exports.solid),4);for(let i=0;i<3;i++){expect(g.bodies[0].bounds.min[i]).toBeCloseTo(bounds[0][i],5);expect(g.bodies[0].bounds.max[i]).toBeCloseTo(bounds[1][i],5);}
 expect(evaluate(importOpenSCAD(exportOpenSCAD(importJSCAD(src).program))).volume).toBeCloseTo(g.volume,4);
});
it('native elliptic tapers retain parameters and reject line ends or invalid segment counts',()=>{
 const p={version:1 as const,language:'brickwright-cad-script' as const,parameters:{},source:'param radius:mm=5;return ellipticFrustum(radius,3,2,4,12,24);'};const a=evaluate(p).volume;expect(evaluate({...p,parameters:{radius:'8'}}).volume).toBeGreaterThan(a);expect(evaluate(importJSCAD(exportJSCAD(p)).program)).toBeDefined();for(const source of ['return ellipticFrustum(0,3,2,4,12,24);','return ellipticFrustum(5,3,2,4,12,3);'])expect(()=>compileCode({...p,source})).toThrow();
});
for(const operation of ['scaleX(2,','scaleY(3,','scaleZ(4,','mirrorX(','mirrorY(','mirrorZ('])it(`matches real JSCAD ${operation} with nested targets`,()=>{
 const src=`const {primitives:{cuboid},transforms:{scaleX,scaleY,scaleZ,mirrorX,mirrorY,mirrorZ}}=require('@jscad/modeling');const main=()=>${operation}[[cuboid({size:[2,3,4],center:[3,4,5]})]]);module.exports={main};`,modeling=createRequire(import.meta.url)('@jscad/modeling'),context={module:{exports:{} as any},require:()=>modeling};runInNewContext(src+';module.exports.solid=main();',context,{timeout:4000});const g=evaluate(importJSCAD(src).program),bounds=modeling.measurements.measureBoundingBox(context.module.exports.solid);expect(g.volume).toBeCloseTo(modeling.measurements.measureVolume(context.module.exports.solid),4);expect(g.bodies[0].bounds.min).toEqual(bounds[0]);expect(g.bodies[0].bounds.max).toEqual(bounds[1]);
});
it('a Cube is distinct from a Box and retains linked edges through dimensions, transforms, source and history',()=>{
 expect(shapeCatalog.find(p=>p.id==='cube')?.additional).toBe(false);const s=createCadSession(createPresetDocument('cube')),id=s.state.document.roots[0];
 try{const before=s.serialize();s.update(id,{size:[40,30,30]});let n=s.state.document.nodes[id];expect(n.kind==='box'&&n.size).toEqual([40,40,40]);expect(n.generator?.values.edge).toBe(40);s.transform([{id,transform:{position:[1,2,3],rotation:[10,20,30],scale:[1,2,1]}}]);n=s.state.document.nodes[id];expect(n.transform.scale).toEqual([2,2,2]);expect(constrainCubeTransform(n,{...n.transform,scale:[3,4,2]}).scale).toEqual([4,4,4]);const saved=s.serialize();expect(()=>s.update(id,{size:[30,40,50]})).toThrow('linked');expect(s.serialize()).toBe(saved);const doc=structuredClone(s.state.document);(doc.nodes[id] as any).size=[10,20,30];expect(()=>validateDocument(doc)).toThrow('linked');s.undo();s.undo();expect(s.serialize()).toBe(before);s.redo();expect(s.state.document.nodes[id].generator?.values.edge).toBe(40);s.enableModelSource();const source=s.modelSource;expect(source).toContain('cube');const same=s.prepareModelSource(source,{regenerate:r=>createPresetDocument(r.preset,'BW',{recipe:r})});expect(same.document.nodes[id].generator?.preset).toBe('cube');}finally{s.dispose();}
});
it('cube parameter bindings drive all edges and all scale axes without contradictory bindings',()=>{
 const s=createCadSession(createPresetDocument('cube')),id=s.state.document.roots[0];try{s.setParametric({version:1,parameters:{edge:{unit:'mm',expression:'15'}},bindings:[{nodeId:id,property:'width',expression:'edge'}]});expect((s.state.document.nodes[id] as any).size).toEqual([15,15,15]);expect(s.state.document.nodes[id].generator?.values.edge).toBe(15);expect(()=>s.setParametric({version:1,parameters:{},bindings:[{nodeId:id,property:'depth',expression:'10'}]})).toThrow('not available');}finally{s.dispose();}
});
for(const id of ['hex-head-screw','socket-head-screw','countersunk-screw','pan-head-screw'])it(`retains editable ${id} geometry and rejects incompatible profile edits`,()=>{
 const recipe=screwVariant(id)!;expect(recipe.version).toBe(2);checkGenerator(recipe);const doc=createPresetDocument(id),g=kernel.evaluate(doc),root=doc.nodes[doc.roots[0]];expect(g.volume).toBeGreaterThan(1000);expect(root.generator).toEqual(recipe);expect(root.name).not.toMatch(/component/);expect(g.bodies[0].bounds.max[2]).toBeGreaterThan(1);const bad=structuredClone(recipe);bad.threadAngle=80;bad.values.pitch=.5;expect(()=>checkGenerator(bad)).toThrow();
 const s=createCadSession(doc),node=s.state.document.roots[0],before=s.serialize(),changed=structuredClone(recipe);changed.values.length=24;s.replaceGenerated(node,createPresetDocument('screw','BW',{recipe:changed}));expect(kernel.evaluate(s.state.document).volume).toBeGreaterThan(g.volume);s.undo();expect(s.serialize()).toBe(before);s.dispose();
});
it('extrema respect lexical reduction bindings when shared constants also exist outside the loop',()=>{
 const p={version:1 as const,language:'brickwright-cad-script' as const,parameters:{},source:'param i:scalar=100;const shared:scalar=i*2;return box(maxRange(i,1,3,1,shared),shared,1);'};expect(evaluate(p).volume).toBeCloseTo(1200);
});
it('profile mirror/scale aliases and short vectors match actual JSCAD geometry',()=>{
 const modeling=createRequire(import.meta.url)('@jscad/modeling');
 for(const op of ['scaleX(2,','scaleZ(3,','mirrorX(','mirrorZ(','scale([2],','scale([],']){const source=`const {primitives:{rectangle},extrusions:{extrudeLinear},transforms:{scaleX,scaleZ,mirrorX,mirrorZ,scale}}=require('@jscad/modeling');const main=()=>extrudeLinear({height:2},${op}[[rectangle({size:[3,4],center:[2,3]})]]));module.exports={main};`,context={module:{exports:{} as any},require:()=>modeling};runInNewContext(source+';module.exports.solid=main();',context,{timeout:4000});const g=evaluate(importJSCAD(source).program);expect(g.volume,op).toBeCloseTo(modeling.measurements.measureVolume(context.module.exports.solid),5);const bounds=modeling.measurements.measureBoundingBox(context.module.exports.solid);expect(g.bodies[0].bounds.min,op).toEqual(bounds[0]);expect(g.bodies[0].bounds.max,op).toEqual(bounds[1]);}
});
it('legacy screw orientation can be retained when adopting a new head style',()=>{
 const old=createPresetDocument('screw'),recipe=screwVariant('hex-head-screw')!;recipe.orientation='legacy';const updated=createPresetDocument('screw','BW',{recipe}),bounds=kernel.evaluate(updated).bodies[0].bounds;expect(bounds.min[2]).toBeLessThan(0);expect(bounds.max[2]).toBeGreaterThan(recipe.values.length);expect(old.nodes[old.roots[0]].generator?.version).toBe(1);
});
it('does not coerce Boolean or nested-vector extrema into numeric dimensions',()=>{
 for(const source of ['cube(min([true])?2:1);','cube(min([[1,2],[3,4]]));'])expect(()=>importOpenSCAD(source)).toThrow();
 expect(evaluate(importOpenSCAD('n=2;cube([max([3,for(i=[0:n])if(i>5)i]),1,1]);')).volume).toBeCloseTo(3);
});
it('diagnoses valid but unimplemented elliptical line ends as unsupported rather than malformed source',()=>{
 const source="const {primitives:{cylinderElliptic}}=require('@jscad/modeling');const main=()=>cylinderElliptic({startRadius:[0,3],endRadius:[2,4]});module.exports={main};";try{importJSCAD(source);throw Error('Expected refusal');}catch(error){expect(error).toMatchObject({code:'unsupported-feature'});}
 const p={version:1 as const,language:'brickwright-cad-script' as const,parameters:{},source:'return ellipticFrustum(5,3,2,4,12,4096);'};expect(compileCode(p).estimatedFaces).toBeLessThan(20000);expect(()=>compileCode({...p,source:'return repeat(64,[20,0,0],ellipticFrustum(5,3,2,4,12,4096));'})).toThrow('200000');
});
it('does not silently trim malformed cube edit vectors during linked-size normalization',()=>{
 const s=createCadSession(createPresetDocument('cube')),id=s.state.document.roots[0],before=s.serialize();try{expect(()=>s.update(id,{size:[30,30,30,99] as any})).toThrow();expect(()=>s.transform([{id,transform:{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1,2] as any}}])).toThrow();expect(s.serialize()).toBe(before);}finally{s.dispose();}
});
