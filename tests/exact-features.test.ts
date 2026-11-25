// SPDX-License-Identifier: BSD-3-Clause
// Exact fillet, chamfer and shell (document version 41): closed forms on the exact kernel, the
// Manifold display mesh, persistence (save/load, Undo/Redo, history archive, model source),
// stale detection and recompute, kernel-aware replay, collision preparation and old projects.
import {readFileSync,readdirSync} from 'node:fs';
import {beforeAll,describe,expect,it} from 'vitest';
import {createCadSession,createCommandJournal,createCommandRunner,exactFeatureKey,FeatureEvaluationError,generateModelSource,identityTransform,parseDocument,recomputeExactFeatures,serializeDocument,staleExactFeatures,STALE_EXACT_CODE,validateDocument} from '@brickwright/cad-core';
import type {ExactCommandHost,ExactFeatureSettings,SessionCommandRecord} from '@brickwright/cad-core';
import {createGeometryKernel} from '@brickwright/cad-geometry';
import {prepareCollision} from '@brickwright/cad-physics';
import {appendPortableRevision,readPortableHistory} from '@brickwright/cad-history';
import {createExactBackend,exactKernelIdentity} from '@brickwright/cad-exact';
import type {ExactBackend} from '@brickwright/cad-exact';

let exact:ExactBackend,manifold:Awaited<ReturnType<typeof createGeometryKernel>>;
beforeAll(async()=>{
 [exact,manifold]=await Promise.all([createExactBackend(),createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')})]);
},120_000);
const host:ExactCommandHost={run:async request=>request.operation==='measure'?{operation:'measure',...exact.measure(request.document,request.bodies)}
 :request.operation==='feature-display'?{operation:'feature-display',...exact.featureDisplays(request.document,request.bodies)}
 :{operation:'export-step',...exact.exportStep(request.document,request.bodies)}};
const kernels=[exactKernelIdentity];
const rel=(a:number,b:number)=>Math.abs(a-b)/Math.abs(b);
const [A,B,C]=[20,30,10];
/** Closed forms for an A×B×C box. */
const filletAll=(r:number,a=A,b=B,c=C)=>{const [x,y,z]=[a-2*r,b-2*r,c-2*r];return x*y*z+2*r*(x*y+y*z+x*z)+Math.PI*r*r*(x+y+z)+4/3*Math.PI*r**3;};
const chamferTop=(d:number)=>A*B*C-d*d*(A+B)+4/3*d**3;
const shellOpenTop=(w:number,c=C)=>A*B*c-(A-2*w)*(B-2*w)*(c-w);
const top={faceNormal:[0,0,1] as [number,number,number],outermost:true as const};

function boxSession(size:[number,number,number]=[A,B,C]){
 const session=createCadSession(undefined,{kernels}),box=session.add({kind:'box',size},{name:'Block',transform:{...identityTransform(),position:[0,0,5]}});
 return {session,box};
}
async function withFeature(settings:ExactFeatureSettings,size?:[number,number,number]){
 const {session,box}=boxSession(size),runner=createCommandRunner(session,{exact:host});
 const options=settings.operation==='shell'?' --open +z':settings.edges==='all'?'':' --face +z';
 const result=await runner.runAsync(`${settings.operation} ${settings.size} Block${options}`);
 const id=session.state.document.roots[0];
 return {session,box,id,result};
}

describe('acceptance: closed forms on the exact kernel (1e-8 relative)',()=>{
 it('all-edge box fillet, top-face chamfer and open-top shell',async()=>{
  for(const [settings,expected] of [
   [{operation:'fillet',size:2,edges:'all'},filletAll(2)],
   [{operation:'chamfer',size:2,edges:top},chamferTop(2)],
   [{operation:'shell',size:2,openFaces:[top]},shellOpenTop(2)],
  ] as const){
   const {session,id}=await withFeature(settings as ExactFeatureSettings);
   const measured=exact.measure(session.state.document).bodies[0];
   expect(measured.id).toBe(id);
   expect(rel(measured.volume,expected),settings.operation).toBeLessThan(1e-8);
   // The body keeps its source placement: the box was centred at z = 5.
   expect(measured.bounds.min[2]).toBeCloseTo(0,9);expect(measured.bounds.max[2]).toBeCloseTo(10,9);
   // STEP is the exact B-rep of the operation, never the display mesh.
   const step=exact.exportStep(session.state.document).step;
   expect(step).toMatch(/^ISO-10303-21;/);
   if(settings.operation==='fillet')expect(step).toMatch(/CYLINDRICAL_SURFACE|TOROIDAL_SURFACE|SPHERICAL_SURFACE/);
  }
 },120_000);
 it('the Manifold display volume is within the tessellation tolerance of the exact volume',async()=>{
  const cases:[ExactFeatureSettings,number,number][]=[
   [{operation:'fillet',size:2,edges:'all'},filletAll(2),2e-3],
   [{operation:'chamfer',size:2,edges:top},chamferTop(2),1e-6],
   [{operation:'shell',size:2,openFaces:[top]},shellOpenTop(2),1e-6],
  ];
  for(const [settings,expected,tolerance] of cases){
   const {session,id}=await withFeature(settings);
   const body=manifold.evaluate(session.state.document).bodies.find(b=>b.id===id)!;
   expect(rel(body.volume,expected),settings.operation).toBeLessThan(tolerance);
   // A curved face deviates by at most the 0.01 mm chordal tolerance, so the mesh is inside.
   if(settings.operation==='fillet'){expect(body.volume).toBeLessThan(expected);expect(expected-body.volume).toBeLessThan(.01*2*(A*B+B*C+A*C));}
   expect(body.bounds.min[2]).toBeCloseTo(0,4);expect(body.bounds.max[2]).toBeCloseTo(10,4);
  }
 },120_000);
});

describe('document model',()=>{
 it('writes version 41 only when an exact feature is added, and validates selectors and the display',async()=>{
  const {session}=boxSession();
  const before=session.state.document.version;
  expect(before).toBeLessThan(41);
  const {session:filleted,id}=await withFeature({operation:'fillet',size:1,edges:'all'});
  const doc=filleted.state.document,node=doc.nodes[id];
  expect(doc.version).toBe(41);
  expect(node).toMatchObject({kind:'exact-feature',featureVersion:1,operation:'fillet',size:1,edges:'all',name:'Fillet of Block'});
  expect(node.kind==='exact-feature'&&node.display?.sourceKey).toBe(exactFeatureKey(doc,id));
  const bad=(edit:(d:any)=>void)=>{const d=structuredClone(doc) as any;edit(d);return ()=>validateDocument(d);};
  expect(bad(d=>{d.version=40;})).toThrow(/bad exact feature/);
  expect(bad(d=>{d.nodes[id].source='missing';})).toThrow();
  expect(bad(d=>{d.nodes[id].edges={faceNormal:[0,0,0]};})).toThrow(/non-zero outward normal/);
  expect(bad(d=>{d.nodes[id].edges={faceNormal:[0,0,1],extra:1};})).toThrow(/non-zero outward normal/);
  expect(bad(d=>{d.nodes[id].openFaces=[top];})).toThrow(/Only a shell has open faces/);
  expect(bad(d=>{d.nodes[id].operation='shell';})).toThrow(/no edge selection/);
  expect(bad(d=>{d.nodes[id].operation='offset';})).toThrow(/fillet, chamfer or shell/);
  expect(bad(d=>{d.nodes[id].size=0;})).toThrow(/between 0.01 and 10000/);
  expect(bad(d=>{d.nodes[id].display.indices[0]=1e7;})).toThrow(/bad exact feature/);
  expect(bad(d=>{d.nodes[id].display.positions.push(1);})).toThrow(/bad exact feature/);
  expect(bad(d=>{d.nodes[id].display.sourceKey='x';})).toThrow(/bad exact feature/);
  expect(bad(d=>{d.nodes[id].display.extra=1;})).toThrow(/bad exact feature/);
  // A node without a display is valid but stale.
  const missing=structuredClone(doc) as any;delete missing.nodes[id].display;
  expect(staleExactFeatures(validateDocument(missing))).toEqual([id]);
  // Shell selectors: one to six distinct normals.
  const shell=structuredClone(doc) as any;Object.assign(shell.nodes[id],{operation:'shell',openFaces:[top,{faceNormal:[0,0,2]}]});delete shell.nodes[id].edges;delete shell.nodes[id].display;
  expect(()=>validateDocument(shell)).toThrow(/different normal/);
 },120_000);
 it('refuses display meshes outside withKernel or for another model',async()=>{
  const {session,box}=boxSession();
  const candidate=createCadSession(session.state.document,{kernels});
  const [id]=candidate.addExactFeatures([{source:box,settings:{operation:'fillet',size:1,edges:'all'}}]);
  const {features:[feature]}=exact.featureDisplays(candidate.state.document,[id]);
  expect(()=>session.addExactFeatures([{source:box,id,settings:{operation:'fillet',size:1,edges:'all'},display:feature.display}])).toThrow(/only be committed by the exact kernel/);
  expect(()=>session.withKernel(exactKernelIdentity,()=>session.addExactFeatures([{source:box,id,settings:{operation:'fillet',size:1.5,edges:'all'},display:feature.display}]))).toThrow(/model changed while the exact kernel was running/);
  session.withKernel(exactKernelIdentity,()=>session.addExactFeatures([{source:box,id,settings:{operation:'fillet',size:1,edges:'all'},display:feature.display}]));
  expect(staleExactFeatures(session.state.document)).toEqual([]);
 },120_000);
 it('writes display buffers compactly and leaves documents without exact features byte-identical',async()=>{
  const {session}=await withFeature({operation:'fillet',size:2,edges:'all'});
  const doc=session.state.document,text=serializeDocument(doc);
  expect(parseDocument(text)).toEqual(doc);
  // Every coordinate of an indented buffer would take its own line; compact buffers take one.
  expect(text.split('\n').length).toBeLessThan(400);
  const pretty=JSON.stringify(validateDocument(doc),null,2);
  expect(text.length).toBeLessThan(pretty.length*0.6);
  const {session:plain}=boxSession();
  expect(serializeDocument(plain.state.document)).toBe(JSON.stringify(validateDocument(plain.state.document),null,2));
 },120_000);
 it('round-trips through save/load, Undo/Redo, the history archive and model source',async()=>{
  const {session,id}=await withFeature({operation:'chamfer',size:2,edges:top});
  const doc=session.state.document;
  const loaded=parseDocument(serializeDocument(doc));
  expect(loaded).toEqual(doc);
  expect(manifold.evaluate(loaded).bodies[0].volume).toBeCloseTo(chamferTop(2),3);
  session.undo();
  expect(session.state.document.nodes[id]).toBeUndefined();
  expect(session.state.document.version).toBeLessThan(41);
  session.redo();
  expect(session.state.document).toBe(doc);
  // History archive: an old revision without the feature and the new one both restore.
  const old=createCadSession(doc);old.undo();
  const plain=validateDocument({...doc,version:40,nodes:Object.fromEntries(Object.entries(doc.nodes).filter(([key])=>key!==id)),roots:[(doc.nodes[id] as any).source]});
  let archive=await appendPortableRevision(undefined,plain,'Before');
  archive=await appendPortableRevision(archive,doc,'Chamfer body');
  const moved=createCadSession(doc,{kernels});moved.transform([{id,transform:{...identityTransform(),position:[5,0,0]}}]);
  archive=await appendPortableRevision(archive,moved.state.document,'Move');
  const history=await readPortableHistory(archive);
  expect(history.revisions.map(r=>r.label)).toEqual(['Before','Chamfer body','Move']);
  expect(history.readDocument(history.revisions[0].id)).toEqual(plain);
  expect(history.readDocument(history.revisions[1].id)).toEqual(doc);
  expect(history.readDocument(history.revisions[2].id)).toEqual(moved.state.document);
  // The display mesh is one shared content object for both revisions.
  const objects=JSON.parse(new TextDecoder().decode(archive)).objects as {kind:string}[];
  expect(objects.filter(o=>o.kind==='mesh').length).toBe(1);
  // Moving the feature keeps its display valid.
  expect(staleExactFeatures(moved.state.document)).toEqual([]);
  // Model source references the display like a mesh asset and keeps it.
  const source=generateModelSource(doc);
  expect(source).toMatch(/exactFeature\("[^"]+", \{/);
  expect(source).toContain(`asset(${JSON.stringify(id)})`);
  expect(source).not.toContain('sourceKey');
  const edited=createCadSession(doc,{kernels});
  expect(edited.applyModelSource(source.replace('"name": "Chamfer of Block"','"name": "Bevelled"').replace('name: "Chamfer of Block"','name: "Bevelled"'))).toBe(true);
  expect(edited.state.document.nodes[id]).toMatchObject({name:'Bevelled',display:(doc.nodes[id] as any).display});
  expect(staleExactFeatures(edited.state.document)).toEqual([]);
 },120_000);
});

describe('stale detection and recompute',()=>{
 it('refuses a stale display, recomputes it on the exact kernel and keeps it across renames, moves and duplicates',async()=>{
  const {session,box,id}=await withFeature({operation:'fillet',size:2,edges:'all'});
  session.update(id,{name:'Rounded'});
  session.transform([{id,transform:{...identityTransform(),position:[0,40,0]}}]);
  session.duplicate([id]);
  expect(staleExactFeatures(session.state.document)).toEqual([]);
  session.undo();
  // An upstream edit: the source box gets taller.
  session.update(box,{size:[A,B,14]} as never);
  expect(staleExactFeatures(session.state.document)).toEqual([id]);
  let error:unknown;
  try{manifold.evaluate(session.state.document);}catch(caught){error=caught;}
  expect(error).toBeInstanceOf(FeatureEvaluationError);
  expect((error as FeatureEvaluationError).code).toBe(STALE_EXACT_CODE);
  expect((error as FeatureEvaluationError).diagnostic.id).toBe(id);
  expect((error as Error).message).toMatch(/Rounded: the exact fillet is out of date after an upstream change\. Recompute it with the exact kernel/);
  const records:SessionCommandRecord[]=[];session.subscribeCommands(record=>records.push(record));
  const done=await recomputeExactFeatures(session,host,staleExactFeatures(session.state.document));
  expect(done.edited).toBe(true);
  expect(session.state.label).toBe('Recompute exact features');
  expect(records.at(-1)!.command.kind==='apply'&&records.at(-1)!.command.context?.kernel).toEqual(exactKernelIdentity);
  const body=manifold.evaluate(session.state.document).bodies.find(b=>b.id===id)!;
  expect(rel(body.volume,filletAll(2,A,B,14))).toBeLessThan(2e-3);
  expect(rel(exact.measure(session.state.document,[id]).bodies[0].volume,filletAll(2,A,B,14))).toBeLessThan(1e-8);
  expect((await recomputeExactFeatures(session,host,staleExactFeatures(session.state.document))).edited).toBe(false);
  // Parameter-driven sizes go stale when the parameter changes.
  session.setParametric({version:1,parameters:{r:{expression:'2 mm',unit:'mm'},other:{expression:'7 mm',unit:'mm'}},bindings:[]});
  session.editExactFeature(id,{operation:'fillet',size:'r',edges:'all'});
  await recomputeExactFeatures(session,host,staleExactFeatures(session.state.document));
  expect(staleExactFeatures(session.state.document)).toEqual([]);
  session.setParametric({version:1,parameters:{r:{expression:'2 mm',unit:'mm'},other:{expression:'8 mm',unit:'mm'}},bindings:[]});
  expect(staleExactFeatures(session.state.document)).toEqual([]);
  session.setParametric({version:1,parameters:{r:{expression:'1.5 mm',unit:'mm'},other:{expression:'8 mm',unit:'mm'}},bindings:[]});
  expect(staleExactFeatures(session.state.document)).toEqual([id]);
 },180_000);
 it('replays the recorded command only on the same kernel version',async()=>{
  const {session,box}=boxSession(),empty=createCadSession(session.state.document).state.document;
  const records:SessionCommandRecord[]=[];session.subscribeCommands(record=>records.push(record));
  await createCommandRunner(session,{exact:host}).runAsync('shell 2 Block --open top');
  const recorded=records.find(record=>record.command.kind==='apply')!;
  expect(recorded.command.kind==='apply'&&recorded.command.context?.kernel).toEqual(exactKernelIdentity);
  const same=createCadSession(empty,{kernels});
  expect(same.executeCommand(recorded.text)).toBe(true);
  expect(same.state.document).toEqual(session.state.document);
  expect(rel(manifold.evaluate(same.state.document).volume,shellOpenTop(2))).toBeLessThan(1e-6);
  const newer=createCadSession(empty,{kernels:[{...exactKernelIdentity,version:'0.2.0'}]});
  expect(()=>newer.executeCommand(recorded.text)).toThrow('Recorded command is stale: it was built with @crispcad/exact-kernel 0.1.2, but this host has 0.2.0');
  expect(newer.state.revision).toBe(0);
  expect(()=>createCadSession(empty).executeCommand(recorded.text)).toThrow(/which this host does not provide/);
  expect(box).toBeTruthy();
 },120_000);
});

describe('commands',()=>{
 it('fillet, chamfer, shell and recompute exact in the shared registry; the sync runner refuses them',async()=>{
  const {session}=boxSession(),journal=createCommandJournal(session),runner=createCommandRunner(session,{exact:host,journal});
  expect(()=>runner.run('fillet 1 all')).toThrow(/uses the exact kernel/);
  await expect(createCommandRunner(session).runAsync('fillet 1 all')).rejects.toThrow(/not available in this host/);
  runner.run('select none');
  await expect(runner.runAsync('fillet 1')).rejects.toThrow(/Select a top-level body/);
  await expect(runner.runAsync('shell 1 all')).rejects.toThrow(/Usage: shell/);
  await expect(runner.runAsync('fillet 1 all --open top')).rejects.toThrow(/Usage: fillet/);
  await expect(runner.runAsync('chamfer 1 all --face 0,0,0')).rejects.toThrow(/non-zero outward normal/);
  const fillet=await runner.runAsync('fillet 0.5 all --face top');
  expect(fillet).toMatchObject({command:'fillet',edited:true,invocation:expect.stringMatching(/^fillet 0\.5 [\w-]+ --face \+z$/),kernel:{id:'smlib'}});
  expect(fillet.output).toMatch(/Exact fillet \(smlib · @crispcad\/exact-kernel 0\.1\.2\):\nFillet of Block \([\w-]+\): exact volume [\d.]+ mm³ · display \d+ triangles/);
  // Too large a fillet fails in the kernel with a diagnostic and changes nothing.
  const revision=session.state.revision;
  await expect(runner.runAsync('fillet 50 all')).rejects.toThrow();
  expect(session.state.revision).toBe(revision);
  expect((await runner.runAsync('recompute exact')).output).toBe('Every exact feature is up to date.');
  await expect(runner.runAsync('recompute')).rejects.toThrow(/Usage: recompute exact/);
  expect(journal.export('replay')).toContain(`"kernel":${JSON.stringify(exactKernelIdentity)}`);
  expect(journal.export('cadscript')).toMatch(/@replay \d+ non-portable: fillet 0\.5 /);
  journal.dispose();
 },120_000);
});

describe('physics, older projects',()=>{
 it('prepares collision hulls from the display mesh',async()=>{
  const {session,id}=await withFeature({operation:'shell',size:2,openFaces:[top]});
  const body=manifold.evaluate(session.state.document).bodies.find(b=>b.id===id)!;
  const prepared=await prepareCollision(body,manifold);
  expect(prepared.hulls.length).toBeGreaterThan(1); // an open box is not convex
  expect(prepared.certificate.relativeError).toBeLessThan(.02);
 },120_000);
 it('loads every shipped project unchanged and keeps plain edits below version 41',()=>{
  const files=['examples/scout-tt-rover/scout-tt-rover.bcad','examples/scout-tt-rover/lite/tt-rover.bcad','examples/scout-tt-rover/scout-tt-print-layout.bcad'];
  for(const file of files){
   const text=readFileSync(file,'utf8'),doc=parseDocument(text),raw=JSON.parse(text);
   expect(doc.version,file).toBe(raw.version);
   expect(doc.version,file).toBeLessThanOrEqual(40);
   const session=createCadSession(doc);session.add({kind:'box',size:[1,1,1]});
   expect(session.state.document.version,file).toBe(doc.version);
  }
  for(const file of readdirSync('examples').filter(name=>name.endsWith('.bcad'))){
   const bytes=readFileSync(`examples/${file}`);
   if(JSON.parse(bytes.toString('utf8')).format!=='brickwright-cad')continue;
   expect(parseDocument(bytes.toString('utf8')).version,file).toBeLessThan(41);
  }
 });
 it('restores every revision of a shipped history archive, and appends a version 41 revision after them',async()=>{
  const bytes=new Uint8Array(readFileSync('examples/coded-three-bore-plate.bcad')),history=await readPortableHistory(bytes);
  const old=history.revisions.map(revision=>history.readDocument(revision.id));
  expect(old.length).toBeGreaterThan(0);
  for(const doc of old)expect(doc.version).toBeLessThan(41);
  const head=history.readDocument(history.project.headId),session=createCadSession(head,{kernels});
  const runner=createCommandRunner(session,{exact:host});
  await runner.runAsync(`chamfer 0.5 ${JSON.stringify(head.nodes[head.roots[0]].name)}`);
  expect(session.state.document.version).toBe(41);
  const next=await readPortableHistory(await appendPortableRevision(bytes,session.state.document,'Chamfer body'));
  expect(next.revisions.length).toBe(history.revisions.length+1);
  history.revisions.forEach((revision,i)=>expect(next.readDocument(revision.id)).toEqual(old[i]));
  expect(next.readDocument(next.project.headId)).toEqual(session.state.document);
 },120_000);
});

