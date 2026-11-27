// SPDX-License-Identifier: BSD-3-Clause
// The read-only inspections of convergence Phase 6.5: multi-material inspection (mass per body,
// material and colour; fused and overlapping materials), surface blends on the exact B-rep
// (radii, chamfer setbacks, G1 evidence, modelled sizes), and STEP evidence (a file as the exact
// kernel reads it; a round trip of model bodies). None of them changes the model.
import {readFileSync} from 'node:fs';
import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {createCadSession,createCommandRunner,formatMaterialsReport,formatStepEvidence,formatSurfaceBlendReport,identityTransform,inspectMaterials,parseMaterialsCommand,parseStepEvidenceCommand,parseSurfaceBlendCommand,readStepHeader,setLocale} from '@brickwright/cad-core';
import type {CadDocument,CadSession,MaterialsHost,SurfaceBlendHost} from '@brickwright/cad-core';
import {createGeometryKernel,inspectSurfaceBlends,materialMeasures} from '@brickwright/cad-geometry';
import type {GeometryKernel} from '@brickwright/cad-geometry';
import {createExactBackend,createInThreadExactHost,exactKernelIdentity} from '@brickwright/cad-exact';
import type {ExactBackend} from '@brickwright/cad-exact';

vi.setConfig({testTimeout:120_000});
let exact:ExactBackend,manifold:GeometryKernel;
beforeAll(async()=>{
 [exact,manifold]=await Promise.all([createExactBackend(),createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')})]);
},120_000);
afterAll(()=>setLocale('en'));
const box=(session:CadSession,size:[number,number,number],at:[number,number,number],name:string,color?:string)=>session.add({kind:'box',size},{name,transform:{...identityTransform(),position:at},...(color?{color}:{})});
const materialsHost=(exactVolumes=false):MaterialsHost=>({async inspect(doc,{bodies,exact:useExact}){
 const {volumes,overlaps}=materialMeasures(manifold,manifold.evaluate(doc).bodies);
 const measured=useExact||exactVolumes?new Map(exact.measure(doc,bodies.length?bodies:undefined).bodies.map(b=>[b.id,b.volume])):new Map<string,number>();
 return inspectMaterials(doc,volumes.map(v=>measured.has(v.id)?{id:v.id,volumeMm3:measured.get(v.id)!,geometry:'exact' as const}:v),{bodies,...(overlaps?{overlaps}:{})});
}});
const blendsHost:SurfaceBlendHost={async inspect(doc,{bodies}){
 const data=exact.drawing(doc);
 return inspectSurfaceBlends({document:doc,exact:{bodies:data.bodies,failures:data.failures},bodies,kernel:'smlib',marks:true});
}};

describe('materials and mass',()=>{
 function model(){
  const session=createCadSession();
  const steel=box(session,[10,10,10],[0,0,5],'Insert','#aa3333');
  const plastic=box(session,[20,20,4],[0,0,2],'Base','#3355aa');
  session.applyPhysicsMaterial('steel',[steel]);session.applyPhysicsMaterial('plastic',[plastic]);
  const a=box(session,[10,10,10],[40,0,5],'Left','#eea52b'),b=box(session,[10,10,10],[45,0,5],'Right','#22aa44');
  session.select([a,b]);session.combine('union');
  return {session,steel,plastic};
 }
 it('reports mass per body, material and colour, with filament per colour',async()=>{
  const {session,steel,plastic}=model(),doc=session.state.document,revision=session.state.revision;
  const report=await materialsHost().inspect(doc,{bodies:[],exact:false});
  const insert=report.bodies.find(b=>b.id===steel)!,base=report.bodies.find(b=>b.id===plastic)!;
  expect(insert).toMatchObject({material:'steel',materialName:'Steel',densityKgM3:7800,color:'#aa3333',geometry:'mesh'});
  expect(insert.volumeMm3).toBeCloseTo(1000,6);expect(insert.massG).toBeCloseTo(7.8,9);
  expect(base.massG).toBeCloseTo(1050*1600*1e-6,9);
  expect(report.byMaterial.map(g=>g.key)).toEqual(['steel','plastic','unassigned@1050']);
  const red=report.byColor.find(g=>g.key==='#aa3333')!;
  expect(red.filamentM).toBeCloseTo(1000/(Math.PI*.875**2)/1000,9);
  expect(report.totalMassG).toBeCloseTo(report.bodies.reduce((s,b)=>s+b.massG,0),12);
  expect(session.state.revision).toBe(revision);
 });
 it('finds fused materials and overlapping bodies of different materials',async()=>{
  const {session,steel,plastic}=model(),report=await materialsHost().inspect(session.state.document,{bodies:[],exact:false});
  const fused=report.findings.filter(f=>f.kind==='fused'),overlap=report.findings.filter(f=>f.kind==='overlap');
  expect(fused).toHaveLength(1);
  expect(fused[0].operands!.map(o=>o.name)).toEqual(['Left','Right']);
  expect(overlap).toHaveLength(1);
  expect(overlap[0].bodies).toEqual([steel,plastic]);
  expect(overlap[0].volumeMm3).toBeCloseTo(10*10*4,4);
  expect(report.overlapsChecked).toBe(true);
  expect(formatMaterialsReport(report)).toMatch(/Findings \(2\)/);
 });
 it('takes exact volumes from the B-rep on request and runs as the materials command',async()=>{
  const session=createCadSession();
  session.add({kind:'cylinder',radius:5,height:10,segments:24},{name:'Pin'});
  const mesh=await materialsHost().inspect(session.state.document,{bodies:[],exact:false});
  const exactReport=await materialsHost().inspect(session.state.document,{bodies:[],exact:true});
  expect(exactReport.bodies[0].geometry).toBe('exact');
  expect(exactReport.bodies[0].volumeMm3).toBeCloseTo(Math.PI*250,6);
  expect(mesh.bodies[0].volumeMm3).toBeLessThan(Math.PI*250);
  const runner=createCommandRunner(session,{materials:materialsHost()});
  const result=await runner.runAsync('materials all --exact');
  expect(result).toMatchObject({invocation:'materials all --exact',edited:false});
  expect(result.output).toMatch(/Pin: No material set/);
  expect(()=>runner.run('materials')).toThrow(/host that provides it/);
  expect(parseMaterialsCommand(session,'').invocation).toBe('materials all');
  expect(()=>parseMaterialsCommand(session,'--nope')).toThrow(/Usage: materials/);
 });
 it('speaks German',async()=>{
  setLocale('de');
  try{
   const {session}=model(),report=await materialsHost().inspect(session.state.document,{bodies:[],exact:false});
   expect(report.bodies.find(b=>b.material==='steel')!.materialName).toBe('Stahl');
   expect(formatMaterialsReport(report)).toMatch(/Nach Material/);
  }finally{setLocale('en');}
 });
});

describe('surface blends',()=>{
 async function filleted(command:string){
  const session=createCadSession(undefined,{kernels:[exactKernelIdentity]});
  box(session,[20,20,20],[0,0,10],'Block');
  const result=await createCommandRunner(session,{exact:createInThreadExactHost()}).runAsync(command);
  expect(result.edited,result.output).toBe(true);
  return session;
 }
 it('lists rounds with their exact radius and G1 evidence, matching the modelled fillet',async()=>{
  const session=await filleted('fillet 2 Block'),doc=session.state.document;
  const report=await blendsHost.inspect(doc,{bodies:[]});
  const body=report.bodies[0];
  expect(body.blends.length).toBeGreaterThanOrEqual(12);
  for(const b of body.blends){
   expect(b.kind).toBe('round');
   expect(b.radiusMm).toBeCloseTo(2,9);
   expect(b.continuity).toBe('G1');
   expect(b.maxTangentDeviationDeg).toBeLessThan(.5);
   expect(b.mark!.triangles.length).toBeGreaterThan(0);
  }
  expect(body.blends.filter(b=>b.surface==='cylinder')).toHaveLength(12);
  expect(body.authored).toEqual([expect.objectContaining({operation:'fillet',sizeMm:2,matched:body.blends.length})]);
  expect(formatSurfaceBlendReport(report)).toMatch(/Modelled fillet .* R2: \d+ matching blends/);
 });
 it('measures chamfer setbacks and angles',async()=>{
  const session=await filleted('chamfer 1.5 Block --face 0,0,1');
  const report=await blendsHost.inspect(session.state.document,{bodies:[]});
  const chamfers=report.bodies[0].blends.filter(b=>b.kind==='chamfer');
  expect(chamfers).toHaveLength(4);
  for(const c of chamfers){expect(c.setbackMm).toBeCloseTo(1.5,9);expect(c.widthMm).toBeCloseTo(1.5*Math.SQRT2,9);expect(c.anglesDeg!.map(a=>Math.round(a))).toEqual([45,45]);expect(c.continuity).toBe('none');}
  expect(report.bodies[0].authored[0]).toMatchObject({operation:'chamfer',matched:4});
 });
 it('lists bodies without an exact B-rep as not inspected; runs as the blends command',async()=>{
  const session=createCadSession();
  const positions=[0,0,0,10,0,0,0,10,0,0,0,10],indices=[0,2,1,0,1,3,0,3,2,1,2,3];
  session.add({kind:'mesh',positions,indices},{name:'Scan'});
  box(session,[5,5,5],[20,0,2.5],'Cube');
  const report=await blendsHost.inspect(session.state.document,{bodies:[]});
  expect(report.failures.map(f=>f.name)).toEqual(['Scan']);
  expect(report.bodies[0]).toMatchObject({name:'Cube',blends:[],faces:6});
  const runner=createCommandRunner(session,{blends:blendsHost});
  const result=await runner.runAsync('blends all');
  expect(result.output).toMatch(/Scan: not inspected/);
  expect(()=>runner.run('blends all')).toThrow(/exact kernel/);
  expect(parseSurfaceBlendCommand(session,'Cube').invocation).toMatch(/^blends [0-9a-f-]{36}$/);
 });
});

describe('STEP evidence',()=>{
 function plate(){
  const session=createCadSession();
  const a=box(session,[40,30,10],[0,0,5],'Plate');
  const hole=session.add({kind:'cylinder',radius:4,height:20,segments:64},{transform:{...identityTransform(),position:[0,0,5]}});
  session.select([a,hole]);session.combine('subtract');
  return session;
 }
 it('summarises a STEP file as the exact kernel reads it',()=>{
  const doc=plate().state.document,step=exact.exportStep(doc).step;
  const {evidence}=exact.stepEvidence({bytes:new TextEncoder().encode(step),file:'plate.step'});
  expect(evidence.file).toMatchObject({name:'plate.step',bytes:new TextEncoder().encode(step).byteLength});
  expect(evidence.file.sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(evidence.file.header.schema.join(' ')).toMatch(/AUTOMOTIVE_DESIGN|CONFIG_CONTROL|AP2/i);
  expect(evidence.bodies).toHaveLength(1);
  const b=evidence.bodies[0];
  expect(b.valid).toBe(true);expect(b.solids).toBe(1);
  expect(b.volumeMm3).toBeCloseTo(40*30*10-Math.PI*16*10,6);
  expect(b.faces.bySurface.plane.count).toBe(6);
  expect(b.faces.bySurface.cylinder.areaMm2).toBeCloseTo(2*Math.PI*4*10,6);
  expect(b.edges.free).toBe(0);
  expect(b.bounds.max[2]).toBeCloseTo(10,9);
  expect(formatStepEvidence(evidence)).toMatch(/1 bodies: .* 7 faces|faces 7/);
 });
 it('checks a round trip of the model bodies, and refuses what is not STEP',async()=>{
  const session=plate(),doc=session.state.document;
  const {evidence}=exact.stepEvidence({doc});
  expect(evidence.roundTrip!.pass).toBe(true);
  expect(evidence.roundTrip!.bodies[0].volumeDeviation).toBeLessThan(1e-9);
  expect(()=>exact.stepEvidence({bytes:new TextEncoder().encode('solid x\nendsolid x\n'),file:'x.stl'})).toThrow(/not a STEP file/);
  // Through the registry: `evidence step` (round trip) with the exact host; files need a host that reads them.
  const runner=createCommandRunner(session,{exact:createInThreadExactHost()});
  const result=await runner.runAsync('evidence step all');
  expect(result).toMatchObject({invocation:'evidence step all',edited:false});
  expect(result.output).toMatch(/Round trip: every body reads back within 0.000001/);
  await expect(runner.runAsync('evidence step --file part.step')).rejects.toThrow(/host that can read files/);
  expect(parseStepEvidenceCommand(session,'step --file "a b.step"')).toMatchObject({file:'a b.step',invocation:'evidence step --file "a b.step"'});
  expect(()=>parseStepEvidenceCommand(session,'stl')).toThrow(/Usage: evidence step/);
 });
 it('reads the header of a STEP file',()=>{
  const header=readStepHeader("ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('A part'),'2;1');\nFILE_NAME('part.step','2026-11-27T12:00:00',('Ann'),('Org'),'Pre 1.0','CAD 9','');\nFILE_SCHEMA(('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF { 1 0 10303 442 1 1 4 }'));\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n");
  expect(header).toEqual({schema:['AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF { 1 0 10303 442 1 1 4 }'],description:'A part',name:'part.step',timestamp:'2026-11-27T12:00:00',preprocessor:'Pre 1.0',originatingSystem:'CAD 9'});
 });
});
