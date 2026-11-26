// SPDX-License-Identifier: BSD-3-Clause
// The optional exact backend (@brickwright/cad-exact on the lab's @crispcad/exact-kernel):
// document lowering against Manifold and closed forms, explicit unsupported diagnostics,
// STEP export and the registry's `export step` / `measure exact` commands.
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {beforeAll,describe,expect,it} from 'vitest';
import {createCadSession,createCommandRunner,identityTransform} from '@brickwright/cad-core';
import type {CadDocument,ExactCommandHost} from '@brickwright/cad-core';
import {createGeometryKernel} from '@brickwright/cad-geometry';
import {createExactBackend,ExactKernelError,ExactLoweringError,exactKernelIdentity,EXACT_KERNEL_VERSION} from '@brickwright/cad-exact';
import type {ExactBackend} from '@brickwright/cad-exact';

let exact:ExactBackend,manifold:Awaited<ReturnType<typeof createGeometryKernel>>;
beforeAll(async()=>{
 [exact,manifold]=await Promise.all([createExactBackend(),createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')})]);
},120_000);
const host:ExactCommandHost={run:async request=>request.operation==='measure'
 ?{operation:'measure',...exact.measure(request.document,request.bodies)}
 :{operation:'export-step',...exact.exportStep(request.document,request.bodies)}};
const rel=(a:number,b:number)=>Math.abs(a-b)/Math.max(Math.abs(b),1e-12);
const at=(position:[number,number,number])=>({transform:{...identityTransform(),position}});

/** Exact and Manifold agree within the faceting of curved surfaces. */
function agree(doc:CadDocument,volumeTolerance=2e-3,boundsTolerance=.05){
 const mesh=manifold.evaluate(doc),measured=exact.measure(doc);
 for(const body of measured.bodies){
  const reference=mesh.bodies.find(b=>b.id===body.id)!;
  expect(rel(body.volume,reference.volume),body.name).toBeLessThan(volumeTolerance);
  for(let i=0;i<3;i++){
   expect(Math.abs(body.bounds.min[i]-reference.bounds.min[i]),`${body.name} min ${i}`).toBeLessThan(boundsTolerance);
   expect(Math.abs(body.bounds.max[i]-reference.bounds.max[i]),`${body.name} max ${i}`).toBeLessThan(boundsTolerance);
  }
 }
 return measured;
}

describe('document lowering',()=>{
 it('builds primitives exactly, with their transforms',()=>{
  const s=createCadSession();
  s.add({kind:'box',size:[10,20,30]},{transform:{position:[5,0,15],rotation:[0,0,30],scale:[1,2,1]}});
  s.add({kind:'cylinder',radius:4,height:10,segments:48},{transform:{position:[30,0,5],rotation:[90,0,0],scale:[1,1,1]}});
  s.add({kind:'sphere',radius:6,segments:48},at([-30,0,6]));
  const measured=agree(s.state.document,2e-2,.1);
  const [box,cylinder,sphere]=measured.bodies;
  expect(rel(box.volume,12000)).toBeLessThan(1e-12);
  expect(rel(cylinder.volume,Math.PI*16*10)).toBeLessThan(1e-10);
  expect(rel(sphere.volume,4/3*Math.PI*216)).toBeLessThan(1e-10);
  expect(rel(sphere.area,4*Math.PI*36)).toBeLessThan(1e-9);
  expect(cylinder.bounds.min[1]).toBeCloseTo(-5,9);
  expect(measured.kernel).toMatchObject(exactKernelIdentity);
 });
 it('lowers sketch extrusions on every plane, arcs and region holes exactly',()=>{
  const s=createCadSession();
  s.addSketchExtrusion({kind:'rectangle',id:'r',width:20,depth:10},{plane:'XZ',distance:5});
  s.addSketchExtrusion({kind:'circle',id:'c',radius:3,segments:64,center:[2,1]},{plane:'YZ',distance:4,symmetric:true,position:[40,0,0]});
  // A slot: two straight edges and two half circles (bulge 1).
  s.addSketchExtrusion({kind:'outline',id:'o',points:[[0,0],[10,0],[10,4],[0,4]],bulges:[0,1,0,1]},{distance:2,position:[0,40,0]});
  s.addSketchExtrusion({kind:'region',id:'g',loops:[{kind:'outline',id:'plate',points:[[-10,-10],[10,-10],[10,10],[-10,10]]},{kind:'circle',id:'hole',center:[0,0],radius:4,segments:64}]},{distance:3,position:[0,-40,0]});
  const [plate,round,slot,region]=agree(s.state.document,5e-3).bodies;
  expect(rel(plate.volume,1000)).toBeLessThan(1e-12);
  expect(rel(round.volume,Math.PI*9*4)).toBeLessThan(1e-10);
  expect(rel(slot.volume,(40+Math.PI*4)*2)).toBeLessThan(1e-10);
  expect(rel(region.volume,(400-Math.PI*16)*3)).toBeLessThan(1e-10);
 });
 it('lowers revolutions, mirrors, patterns, Booleans and CAD Script',()=>{
  const s=createCadSession();
  s.addSketchRevolution({kind:'rectangle',id:'ring',width:2,depth:4},{name:'Ring',plane:'XZ',angle:360,axisOffset:-5});
  const half=s.addSketchRevolution({kind:'rectangle',id:'arc',width:2,depth:2},{name:'Arc',plane:'XY',angle:-90,axisOffset:-3,position:[0,30,0]});
  const source=s.add({kind:'box',size:[4,4,4]},at([20,0,2]));
  s.mirrorBody(source,{plane:'YZ',offset:5});
  const post=s.add({kind:'cylinder',radius:1,height:6,segments:32},at([0,-20,3]));
  s.patternBody(post,{mode:'circular',axis:'Z',count:6,center:[0,-15],sweep:360});
  const pin=s.add({kind:'cylinder',radius:1,height:6,segments:32},at([0,-40,3]));
  s.patternBody(pin,{mode:'linear',axis:'X',count:3,spacing:5});
  const a=s.add({kind:'box',size:[10,10,10]},at([0,60,5])),b=s.add({kind:'sphere',radius:6,segments:48},at([5,60,5]));
  s.combine('subtract',[a,b]);
  s.addCode({version:1,language:'brickwright-cad-script',parameters:{},source:'return subtract(box(20,20,4), cylinder(3,10,48));'},'Plate',{position:[0,90,0]});
  const measured=agree(s.state.document,2e-2,.1).bodies;
  expect(rel(measured[0].volume,Math.PI*(6*6-4*4)*4)).toBeLessThan(1e-10);
  expect(rel(measured[1].volume,Math.PI*(4*4-2*2)*2/4)).toBeLessThan(1e-10);
  expect(half).toBeTruthy();
 });
 it('fails with a diagnostic naming the body and feature, never with a mesh',()=>{
  const s=createCadSession();
  s.add({kind:'mesh',positions:[0,0,0,10,0,0,0,10,0,0,0,10],indices:[0,2,1,0,1,3,0,3,2,1,2,3]},{name:'Scan'});
  let error:unknown;
  try{exact.exportStep(s.state.document);}catch(caught){error=caught;}
  expect(error).toBeInstanceOf(ExactLoweringError);
  expect((error as ExactLoweringError).diagnostic).toMatchObject({code:'unsupported',feature:'mesh',bodyId:s.state.document.roots[0]});
  expect((error as Error).message).toMatch(/Scan \(mesh\): Imported meshes have no exact B-rep/);
  const code=createCadSession();
  code.addCode({version:1,language:'brickwright-cad-script',parameters:{},source:'return minkowski(box(4,4,4), sphere(1,24));'},'Rounded');
  expect(()=>exact.measure(code.state.document)).toThrow(/Rounded \(code\): minkowski has no exact lowering/);
  expect(exact.kernel.memory().handles).toBe(0);
 });
});

describe('STEP export',()=>{
 it('writes one solid per body and reads back exactly',()=>{
  const s=createCadSession();
  s.add({kind:'box',size:[10,10,10]},at([0,0,5]));s.add({kind:'cylinder',radius:3,height:8,segments:48},at([20,0,4]));
  const result=exact.exportStep(s.state.document);
  expect(result.step).toMatch(/^ISO-10303-21;/);
  expect(result.bodies).toHaveLength(2);
  expect(result.bytes).toBe(new TextEncoder().encode(result.step).byteLength);
  exact.kernel.scope(()=>{
   const back=exact.kernel.importStep(result.step);
   expect(rel(exact.kernel.volume(back),1000+Math.PI*72)).toBeLessThan(1e-9);
   expect(exact.kernel.solidCount(back)).toBe(2);
   return 0;
  });
 });
 it('refuses to merge touching bodies and reference/hole targets',()=>{
  const s=createCadSession();
  const a=s.add({kind:'box',size:[10,10,10]},{name:'Left',...at([0,0,5])}),b=s.add({kind:'box',size:[10,10,10]},{name:'Right',...at([5,0,5])});
  expect(()=>exact.exportStep(s.state.document)).toThrow(/Left and Right touch or overlap/);
  expect(exact.exportStep(s.state.document,[a]).bodies).toEqual([{id:a,name:'Left'}]);
  expect(()=>exact.exportStep(s.state.document,['missing'])).toThrow(ExactKernelError);
  expect(b).toBeTruthy();
 });
});

describe('registry commands',()=>{
 it('measure exact and export step run through runAsync, never through the sync runner',async()=>{
  const s=createCadSession();
  const id=s.add({kind:'box',size:[10,20,30]},{name:'Block',...at([0,0,15])});
  const runner=createCommandRunner(s,{exact:host});
  const measured=await runner.runAsync('measure exact "Block"');
  expect(measured).toMatchObject({command:'measure',invocation:`measure exact ${id}`,edited:false,kernel:{id:'smlib',version:EXACT_KERNEL_VERSION}});
  expect(measured.output).toMatch(/volume 6000 mm³ · area 2200 mm²/);
  const exported=await runner.runAsync('export step all');
  expect(exported.invocation).toBe('export step all');
  expect(exported.file).toMatchObject({name:'Untitled design.step',mime:'model/step'});
  expect(exported.file!.text).toMatch(/^ISO-10303-21;/);
  expect(()=>runner.run('export step')).toThrow(/exact kernel/);
  await expect(runner.runAsync('export')).rejects.toThrow(/Usage: export step/);
  await expect(runner.runAsync('measure')).rejects.toThrow(/Usage: measure exact/);
  await expect(createCommandRunner(s).runAsync('measure exact')).rejects.toThrow(/not available in this host/);
  const script=await runner.runScriptAsync('box 1,1,1\nmeasure exact all');
  expect(script[1].output).toMatch(/volume 1 mm³/);
  expect(s.state.revision).toBeGreaterThan(0);
 });
 it('pins the identity to the installed lab release',()=>{
  const require=createRequire(import.meta.url);
  const pkg=JSON.parse(readFileSync(require.resolve('@crispcad/exact-kernel/package.json'),'utf8'));
  expect(exactKernelIdentity).toEqual({id:'smlib',package:pkg.name,version:pkg.version});
  const manifest=JSON.parse(readFileSync('packages/exact/package.json','utf8')),lock=JSON.parse(readFileSync('package-lock.json','utf8'));
  const spec=manifest.dependencies['@crispcad/exact-kernel'],entry=lock.packages['node_modules/@crispcad/exact-kernel'];
  expect(spec).toBe('https://github.com/CrispStrobe/crispcad-kernel-lab/releases/download/exact-kernel-v0.1.3/crispcad-exact-kernel-0.1.3.tgz');
  expect(entry).toMatchObject({resolved:spec,version:'0.1.3',license:'MIT AND Apache-2.0',integrity:'sha512-h7t8uaGYq6LLtrr1VAT/3zF8zFmwUAfAE5+xUhlB0X76soLgjpq60WXxIMzvIaZJgLFu6tsKnpYq3M5rQHl8ag=='});
  expect(entry.dependencies).toBeUndefined();
 });
});
