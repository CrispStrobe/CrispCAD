// SPDX-License-Identifier: BSD-3-Clause
// STEP import as exact bodies (document version 45): export → import round trips (volume, area
// and box agree with the exported bodies), exact work on imported bodies (STEP export, measures,
// fillet, chamfer, shell), the Manifold display without the kernel, persistence (save/load,
// history archive, model source, Undo), the commands (terminal registry, MCP, CLI) and the
// refusals, which import nothing.
import {execFile} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {createCadSession,createCommandRunner,createDocument,EXACT_BODY_DOCUMENT_VERSION,generateModelSource,identityTransform,parseDocument,runStepImport,serializeDocument,setLocale,validateDocument} from '@brickwright/cad-core';
import type {CadDocument,ExactCommandHost} from '@brickwright/cad-core';
import {createGeometryKernel} from '@brickwright/cad-geometry';
import {appendPortableRevision,readPortableHistory} from '@brickwright/cad-history';
import {createExactBackend,EXACT_LIMITS_TABLET,exactKernelIdentity,runExactRequest} from '@brickwright/cad-exact';
import type {ExactBackend} from '@brickwright/cad-exact';
import {createCodeHost} from '../apps/mcp/host.mjs';

let exact:ExactBackend,manifold:Awaited<ReturnType<typeof createGeometryKernel>>;
beforeAll(async()=>{
 [exact,manifold]=await Promise.all([createExactBackend(),createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')})]);
},120_000);
afterAll(()=>setLocale('en'));
const host:ExactCommandHost={run:async request=>runExactRequest(exact,request)};
const tablet:ExactCommandHost={run:async request=>runExactRequest(exact,request,0,{limits:EXACT_LIMITS_TABLET})};
const kernels=[exactKernelIdentity];
const rel=(a:number,b:number)=>Math.abs(a-b)/Math.abs(b);
const encode=(text:string)=>new TextEncoder().encode(text);

/** A design with three exact bodies apart from each other: a filleted box, a drilled plate
 * (sketch extrusion with a hole) and a placed, rotated cylinder. */
async function sourceDesign(){
 const session=createCadSession(undefined,{kernels}),runner=createCommandRunner(session,{exact:host});
 session.add({kind:'box',size:[20,30,10]},{name:'Block',transform:{...identityTransform(),position:[0,0,5]}});
 await runner.runAsync('fillet 2 Block');
 session.addSketchExtrusion({kind:'region',id:'plate',loops:[{kind:'outline',id:'outline',points:[[40,0],[80,0],[80,25],[40,25]]},{kind:'circle',id:'hole',center:[60,12.5],radius:5,segments:64}]},{distance:6});
 session.add({kind:'cylinder',radius:6,height:18,segments:48},{name:'Pin',transform:{position:[-40,10,9],rotation:[30,0,15],scale:[1,1,1]}});
 return session;
}
/** Import `text` into a fresh session through the shared command path. */
async function imported(text:string|Uint8Array,name='part.step',use=host){
 const session=createCadSession(undefined,{kernels});
 const done=await runStepImport(session,use,{name,bytes:typeof text==='string'?encode(text):text});
 return {session,done};
}
const box=(text:string)=>`ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\n${text}ENDSEC;\nEND-ISO-10303-21;\n`;

describe('round trip: export → import → the same exact bodies',()=>{
 it('agrees with the exported bodies in volume, area and box, and its display with Manifold',async()=>{
  const source=await sourceDesign(),doc=source.state.document;
  const before=exact.measure(doc).bodies;
  expect(before).toHaveLength(3);
  const {step}=exact.exportStep(doc);
  const {session,done}=await imported(step,'design.step');
  const after=session.state.document;
  expect(after.version).toBe(EXACT_BODY_DOCUMENT_VERSION);
  expect(done.ids).toHaveLength(3);
  expect(after.roots.map(id=>after.nodes[id].kind)).toEqual(['exact-body','exact-body','exact-body']);
  const measured=exact.measure(after).bodies;
  // STEP holds one solid per body in body order.
  for(let i=0;i<3;i++){
   const a=before[i],b=measured[i];
   expect(rel(b.volume,a.volume),a.name).toBeLessThan(1e-9);
   expect(rel(b.area,a.area),a.name).toBeLessThan(1e-9);
   for(let j=0;j<3;j++){expect(Math.abs(b.bounds.min[j]-a.bounds.min[j])).toBeLessThan(1e-6);expect(Math.abs(b.bounds.max[j]-a.bounds.max[j])).toBeLessThan(1e-6);}
   // The stored measures are the kernel's at import.
   const node=after.nodes[done.ids[i]];
   if(node.kind!=='exact-body')throw new Error('not an exact body');
   expect(rel(node.measures.volume,a.volume)).toBeLessThan(1e-9);
   expect(node.origin).toMatchObject({file:'design.step',bytes:encode(step).byteLength,body:i+1,bodies:3});
   expect(node.origin!.sha256).toMatch(/^[0-9a-f]{64}$/);
  }
  // Without the exact kernel, Manifold builds the stored display: inside its 0.01 mm chord.
  const shown=manifold.evaluate(after).bodies;
  for(let i=0;i<3;i++)expect(rel(shown[i].volume,before[i].volume),before[i].name).toBeLessThan(2e-3);
  // Exported again, the imported bodies give the same STEP solids back.
  const again=(await imported(exact.exportStep(after).step,'again.step')).session.state.document;
  exact.measure(again).bodies.forEach((b,i)=>expect(rel(b.volume,before[i].volume)).toBeLessThan(1e-9));
 },300_000);
 it('reads files other writers wrote (OpenCASCADE 7.6, two Adafruit bodies, MIT)',async()=>{
  const battery=readFileSync('library/sources/adafruit-electronics/830 Battery Holder 4xAA.step');
  const {session,done}=await imported(battery,'830 Battery Holder 4xAA.step');
  const doc=session.state.document;
  expect(done.ids.map(id=>doc.nodes[id].name)).toEqual(['Body1','Body2']);
  expect(doc.nodes[done.ids[0]].color).toMatch(/^#[0-9a-f]{6}$/);
  const bodies=exact.measure(doc).bodies;
  expect(bodies.every(b=>b.volume>0&&b.solids===1)).toBe(true);
  expect(rel(bodies[0].volume+bodies[1].volume,19964.766)).toBeLessThan(1e-6);
 },300_000);
});

describe('exact work on an imported body',()=>{
 const [A,B,C]=[20,30,10];
 let doc:CadDocument;
 beforeAll(async()=>{
  const source=createCadSession(undefined,{kernels});source.add({kind:'box',size:[A,B,C]},{name:'Block'});
  doc=(await imported(exact.exportStep(source.state.document).step,'block.step')).session.state.document;
 },120_000);
 it('fillets, chamfers and shells it exactly (closed forms at 1e-8)',async()=>{
  const r=2,[x,y,z]=[A-2*r,B-2*r,C-2*r];
  const cases:[string,number][]=[
   [`fillet ${r} part`,x*y*z+2*r*(x*y+y*z+x*z)+Math.PI*r*r*(x+y+z)+4/3*Math.PI*r**3],
   ['chamfer 2 part --face +z',A*B*C-4*(A+B)+4/3*8],
   ['shell 2 part --open +z',A*B*C-(A-4)*(B-4)*(C-2)],
  ];
  for(const [command,expected] of cases){
   const session=createCadSession(doc,{kernels}),runner=createCommandRunner(session,{exact:host});
   const result=await runner.runAsync(command);
   expect(result.kernel).toMatchObject({package:exactKernelIdentity.package,version:exactKernelIdentity.version});
   const measured=exact.measure(session.state.document).bodies[0];
   expect(rel(measured.volume,expected),command).toBeLessThan(1e-8);
   // The display without the kernel follows it.
   expect(rel(manifold.evaluate(session.state.document).bodies[0].volume,expected),command).toBeLessThan(2e-3);
   session.dispose();
  }
 },300_000);
 it('moves with its transform for exact export and measures',async()=>{
  const session=createCadSession(doc,{kernels}),[id]=session.state.document.roots;
  session.update(id,{transform:{position:[100,0,0],rotation:[0,0,90],scale:[1,1,1]}});
  const measured=exact.measure(session.state.document).bodies[0];
  expect(measured.bounds.min).toEqual([expect.closeTo(100-B/2,6),expect.closeTo(-A/2,6),expect.closeTo(-C/2,6)]);
  expect(()=>session.update(id,{brep:{format:'step',text:'ISO-10303-21;'}} as never)).toThrow(/keeps its B-rep/);
  session.dispose();
 });
});

describe('persistence and old documents',()=>{
 let doc:CadDocument;
 beforeAll(async()=>{
  const source=createCadSession(undefined,{kernels});source.add({kind:'cylinder',radius:5,height:12,segments:48},{name:'Rod'});
  doc=(await imported(exact.exportStep(source.state.document).step,'rod.step')).session.state.document;
 },120_000);
 it('saves, loads, round-trips model source and the history archive with shared content',async()=>{
  const text=serializeDocument(doc),loaded=parseDocument(text);
  expect(loaded).toEqual(doc);
  // Display buffers are written on one line each, like exact features'.
  expect(text.split('\n').length).toBeLessThan(80);
  const session=createCadSession(loaded,{kernels}),[id]=loaded.roots;
  expect(session.modelSource).toMatch(new RegExp(`exactBody\\("${id}", \\{[\\s\\S]*?\\}, asset\\("${id}"\\)\\)`));
  expect(session.modelSource).not.toMatch(/ISO-10303-21/);
  expect(session.modelSource).toContain('name: "part"');
  session.applyModelSource(session.modelSource.replace('name: "part"','name: "Rod renamed"'));
  expect(session.state.document.nodes[id]).toMatchObject({name:'Rod renamed',brep:doc.nodes[id].kind==='exact-body'?doc.nodes[id].brep:undefined});
  const first=await appendPortableRevision(undefined,loaded,'Import STEP');
  const moved=structuredClone(loaded);moved.nodes[id].transform.position=[5,5,5];
  const second=await appendPortableRevision(first,moved,'Move');
  const history=await readPortableHistory(second),archive=JSON.parse(new TextDecoder().decode(second));
  // The B-rep and the display are stored once for both revisions.
  expect(archive.objects.filter((o:{kind:string})=>o.kind==='brep')).toHaveLength(1);
  expect(archive.objects.filter((o:{kind:string})=>o.kind==='mesh')).toHaveLength(1);
  expect(history.readDocument(history.revisions[0].id)).toEqual(validateDocument(loaded));
  expect(history.readDocument(history.revisions[1].id).nodes[id].transform.position).toEqual([5,5,5]);
  session.dispose();
 });
 it('opens without the kernel: Manifold displays it, and Undo removes the import',async()=>{
  expect(manifold.evaluate(doc).bodies[0].volume).toBeGreaterThan(0.99*Math.PI*25*12);
  const session=createCadSession(undefined,{kernels});
  await runStepImport(session,host,{name:'rod.step',bytes:encode(exact.exportStep(doc).step)});
  expect(session.state.document.version).toBe(45);
  session.undo();
  expect(session.state.document.roots).toEqual([]);
  expect(session.state.document.version).toBeLessThan(45);
  session.dispose();
 });
 it('keeps documents without exact bodies at their version, and refuses exact bodies below 45',()=>{
  const plain=createCadSession();plain.add({kind:'box',size:[1,1,1]});
  expect(plain.state.document.version).toBeLessThan(45);
  const older={...structuredClone(doc),version:44};
  expect(()=>validateDocument(older)).toThrow(/exact body/);
  const tampered=structuredClone(doc),node=tampered.nodes[tampered.roots[0]];
  if(node.kind==='exact-body')node.brep.text='solid';
  expect(()=>validateDocument(tampered)).toThrow(/exact body/);
  plain.dispose();
 });
 it('needs the exact kernel to commit an import',()=>{
  const session=createCadSession(undefined,{kernels}),node=doc.nodes[doc.roots[0]];
  if(node.kind!=='exact-body')throw new Error('not an exact body');
  expect(()=>session.addExactBodies([{name:'x',body:node}])).toThrow(/only be committed by the exact kernel/);
  session.dispose();
 });
});

describe('refusals: nothing is imported, the model is unchanged',()=>{
 const step=()=>{const s=createCadSession();s.add({kind:'box',size:[10,20,30]});return exact.exportStep(s.state.document).step;};
 async function refused(text:string|Uint8Array,pattern:RegExp,name='bad.step',use=host){
  const session=createCadSession(undefined,{kernels}),before=session.state.revision;
  await expect(runStepImport(session,use,{name,bytes:typeof text==='string'?encode(text):text})).rejects.toThrow(pattern);
  expect(session.state.revision).toBe(before);
  expect(session.state.document.roots).toEqual([]);
  session.dispose();
 }
 it('refuses what is not a readable STEP solid',async()=>{
  const good=step();
  await refused('solid cube\nendsolid cube\n',/not a STEP file/);
  await refused(box('#1=FOO(;\n'),/malformed/);
  await refused(good.slice(0,good.length>>1),/incomplete/);
  await refused(box(''),/holds no solid/);
  await refused(good.replace(/=PLANE\(/,'=FOO_SURFACE('),/cannot be read exactly, so nothing was imported: .*FOO_SURFACE/);
  await refused(good.replace(/MANIFOLD_SOLID_BREP\('([^']*)',(#\d+)\)/,"SHELL_BASED_SURFACE_MODEL('$1',($2))").replace('CLOSED_SHELL','OPEN_SHELL').replace('ADVANCED_BREP_SHAPE_REPRESENTATION','MANIFOLD_SURFACE_SHAPE_REPRESENTATION'),/open surface \(a sheet\)/);
  await refused(good.replace(/CLOSED_SHELL\('',\(#\d+,/,"CLOSED_SHELL('',("),/not a valid closed solid, even after repair/);
  await refused(new Uint8Array(),/empty/);
  await refused(good,/accepts \.step and \.stp/,'part.stl');
 },300_000);
 it('refuses a file over the tablet limit before the kernel reads it',async()=>{
  const padded=step().replace('DATA;','DATA;\n/*'+' '.repeat(4*1048576)+'*/');
  await refused(padded,/this device imports STEP files of up to 4 MiB/,'big.step',tablet);
 });
 it('says so in German',async()=>{
  setLocale('de');
  try{await refused(box(''),/Die STEP-Datei enthält keinen Volumenkörper/);}
  finally{setLocale('en');}
 });
});

describe('commands: registry, MCP and CLI',()=>{
 let dir:string;
 beforeAll(()=>{dir=mkdtempSync(join(tmpdir(),'crispcad-step-import-'));});
 afterAll(()=>rmSync(dir,{recursive:true,force:true}));
 const text=()=>{const s=createCadSession();s.add({kind:'box',size:[8,8,8]},{name:'Cube'});return exact.exportStep(s.state.document).step;};
 it('runs import step <file> where the host reads files, and refuses it elsewhere',async()=>{
  const session=createCadSession(undefined,{kernels});
  const files=createCommandRunner(session,{exact:host,readFile:async path=>({name:path,bytes:encode(text())})});
  const result=await files.runAsync('import step cube.step');
  expect(result).toMatchObject({command:'import',invocation:'import step cube.step',edited:true});
  expect(result.output).toMatch(/^Imported 1 exact bodies from cube\.step/);
  expect(exact.measure(session.state.document).bodies[0].volume).toBeCloseTo(512,9);
  await expect(createCommandRunner(session,{exact:host}).runAsync('import step cube.step')).rejects.toThrow(/needs a host that can read files/);
  expect(()=>createCommandRunner(session).run('import step cube.step')).toThrow(/uses the exact kernel/);
  await expect(files.runAsync('import stl cube.stl')).rejects.toThrow(/Usage: import step/);
  session.dispose();
 },120_000);
 it('imports over MCP (cad_import_step) as one saved step, and the CLI import verb',async()=>{
  const project=join(dir,'mcp.bcad'),mcp=await createCodeHost({project});
  try{
   const {revision}=await mcp.call('cad_get_model');
   const base64=Buffer.from(text()).toString('base64');
   const preview=await mcp.call('cad_import_step',{name:'cube.step',base64,expectedRevision:revision,preview:true});
   expect(preview.committed).toBe(false);
   const done=await mcp.call('cad_import_step',{name:'cube.step',base64,expectedRevision:revision});
   expect(done).toMatchObject({committed:true,objects:[{kind:'exact-body',name:'part'}]});
   const measured=await mcp.call('cad_measure_exact',{});
   expect(measured.bodies[0].volume).toBeCloseTo(512,9);
   await expect(mcp.call('cad_import_step',{name:'bad.step',base64:Buffer.from(box('')).toString('base64'),expectedRevision:done.revision})).rejects.toThrow(/holds no solid/);
   expect((await mcp.call('cad_get_model')).revision).toBe(done.revision);
  }finally{await mcp.dispose();}
  const file=join(dir,'cube.step'),cli=join(dir,'cli.bcad');writeFileSync(file,text());
  const {stdout}=await promisify(execFile)(process.execPath,['apps/cli/crispcad.mjs','import',cli,file],{timeout:120_000});
  expect(JSON.parse(stdout)).toMatchObject({committed:true,objects:[{kind:'exact-body'}]});
 },300_000);
});

describe('display limits',()=>{
 it('stores no more than a mesh node may hold',async()=>{
  const {session}=await imported(exact.exportStep((()=>{const s=createCadSession();s.add({kind:'sphere',radius:30,segments:48});return s.state.document;})()).step,'ball.step');
  const node=session.state.document.nodes[session.state.document.roots[0]];
  if(node.kind!=='exact-body')throw new Error('not an exact body');
  expect(node.display.positions.length).toBeLessThanOrEqual(750000);
  expect(node.display.indices.length%3).toBe(0);
  expect(createDocument().version).toBeLessThan(45);
 },120_000);
});
