// SPDX-License-Identifier: BSD-3-Clause
// Fillet and chamfer of individual edges (document version 44): stable edge references, their
// resolution against the exact B-rep at recompute (also after upstream edits), stale references,
// the `edges` command and `fillet … edges …`, replay, paste/duplicate, limits and old documents.
import {beforeAll,describe,expect,it} from 'vitest';
import {checkEdgeReferences,generateModelSource,createCadSession,createCommandRunner,edgeReferences,EXACT_EDGE_REFERENCE_DOCUMENT_VERSION,ExactEdgeReferenceError,exactFeatureKey,formatEdgeReference,identityTransform,mapEdgeReferenceIds,parseEdgeReference,recomputeExactFeatures,resolveEdgeReferences,serializeDocument,staleExactFeatures,STALE_EDGE_REFERENCE_CODE,validateDocument} from '@brickwright/cad-core';
import type {CadDocument,EdgeNamingTopology,ExactCommandHost,ExactEdgeReference} from '@brickwright/cad-core';
import {createExactBackend,createInThreadExactHost,exactKernelIdentity,runExactRequest} from '@brickwright/cad-exact';
import type {ExactBackend} from '@brickwright/cad-exact';

let exact:ExactBackend;
beforeAll(async()=>{exact=await createExactBackend();},120_000);
const host:ExactCommandHost={run:async request=>runExactRequest(exact,request)};
const kernels=[exactKernelIdentity];
const rel=(a:number,b:number)=>Math.abs(a-b)/Math.abs(b);
/** Volume a fillet of radius r removes along a straight 90° edge of length l. */
const roundOff=(r:number,l:number)=>(1-Math.PI/4)*r*r*l;

// --- Pure resolution on a hand-made topology: faces a…d, edges between them. ---
const face=(id:string,k:number)=>`${id}:f${k}`;
const topology=(faces:(string|null)[],edges:[number[],number[][]][]):EdgeNamingTopology=>({faces:faces.map(name=>({name})),edges:edges.map(([f,points])=>({faces:f,points}))});
const A=face('box',0),B=face('box',1),C=face('cut',0);

describe('edge references without the kernel',()=>{
 it('name an edge by its two faces and resolve it again',()=>{
  const t=topology([A,B,C],[[[0,1],[[0,0,0],[1,0,0]]],[[1,2],[[0,0,0],[0,1,0]]]]);
  const refs=edgeReferences(t);
  expect(refs[0].reference).toEqual({faces:[A,B].sort()});
  expect(resolveEdgeReferences(t,[refs[1].reference!])).toEqual([1]);
  // The same names on a moved/resized body (other points, other order) still resolve.
  const moved=topology([C,B,A],[[[0,1],[[5,5,5],[5,9,5]]],[[2,1],[[3,0,0],[9,0,0]]]]);
  expect(resolveEdgeReferences(moved,[refs[0].reference!,refs[1].reference!])).toEqual([1,0]);
 });
 it('record which of several edges between the same faces, in position order',()=>{
  const t=topology([A,B],[[[0,1],[[10,0,0],[12,0,0]]],[[1,0],[[0,0,0],[2,0,0]]]]);
  const refs=edgeReferences(t).map(r=>r.reference!);
  expect(refs[1]).toEqual({faces:[A,B].sort(),index:0,of:2});
  expect(refs[0]).toEqual({faces:[A,B].sort(),index:1,of:2});
  expect(formatEdgeReference(refs[0])).toBe(`${[A,B].sort().join('+')}@2/2`);
  expect(parseEdgeReference(formatEdgeReference(refs[0]))).toEqual(refs[0]);
 });
 it('never pick another edge: a missing pair or a changed count is stale',()=>{
  const ref:ExactEdgeReference={faces:[A,C].sort() as [string,string]};
  const t=topology([A,B,C],[[[0,1],[[0,0,0],[1,0,0]]]]);
  let error:unknown;
  try{resolveEdgeReferences(t,[ref],name=>name==='box:f0'?'Block face 1':'Hole face 1');}catch(e){error=e;}
  expect(error).toBeInstanceOf(ExactEdgeReferenceError);
  expect((error as ExactEdgeReferenceError).code).toBe(STALE_EDGE_REFERENCE_CODE);
  expect((error as Error).message).toMatch(/1 of 1 selected edges no longer exist.*Block face 1 \/ Hole face 1 no longer meet/);
  // Recorded as one of two; now there are three: stale, not "the first one".
  const two={faces:[A,B].sort() as [string,string],index:1,of:2};
  const three=topology([A,B],[0,1,2].map(i=>[[0,1],[[i,0,0],[i+.5,0,0]]] as [number[],number[][]]));
  expect(()=>resolveEdgeReferences(three,[two])).toThrow(/now meet at 3 edges, not 2/);
  // Recorded as the only one; now split in two: stale too.
  expect(()=>resolveEdgeReferences(three,[{faces:two.faces}])).toThrow(/now meet at 3 edges, not 1/);
 });
 it('edges on unnamed faces and seams have no reference',()=>{
  const t=topology([A,null,B],[[[0,1],[[0,0,0],[1,0,0]]],[[0,0],[[0,0,0],[0,0,1]]],[[0],[[0,0,0],[0,1,0]]]]);
  expect(edgeReferences(t).map(r=>r.reference?'ref':r.reason)).toEqual(['unnamed','seam','seam']);
 });
 it('validate, canonicalise and remap references',()=>{
  expect(checkEdgeReferences({references:[{faces:[B,A]}]})).toEqual({references:[{faces:[A,B]}]});
  for(const bad of [{references:[]},{references:[{faces:[A,A]}]},{references:[{faces:[A,'nope']}]},{references:[{faces:[A,B],index:2,of:2}]},{references:[{faces:[A,B]},{faces:[B,A]}]},{refs:[]}])
   expect(()=>checkEdgeReferences(bad)).toThrow();
  const copied=mapEdgeReferenceIds({references:[{faces:['pat#1/box:f0','cut:f2']}]},id=>({box:'box2',pat:'pat2'} as Record<string,string>)[id]);
  expect(copied.references[0].faces).toEqual(['cut:f2','pat2#1/box2:f0']);
 });
});

// --- On the exact kernel. ---
function blockSession(){
 const session=createCadSession(undefined,{kernels});
 const box=session.add({kind:'box',size:[20,30,10]},{name:'Block',transform:{...identityTransform(),position:[0,0,5]}});
 return {session,box,runner:createCommandRunner(session,{exact:host})};
}
const edgeList=async(session:ReturnType<typeof createCadSession>,body:string)=>{
 const result=await host.run({operation:'edges',document:session.state.document,bodies:[body]});
 if(result.operation!=='edges')throw new Error('unexpected');
 return result.bodies[0].edges;
};

describe('fillet and chamfer of chosen edges',()=>{
 it('lists the edges, rounds the chosen ones and records stable references',async()=>{
  const {session,box,runner}=blockSession();
  const listing=await runner.runAsync('edges Block');
  expect(listing.output).toMatch(/Block \(.+\): 12 edges/);
  expect(listing.edited).toBe(false);
  const edges=await edgeList(session,box);
  expect(edges).toHaveLength(12);
  expect(edges.every(edge=>edge.reference)).toBe(true);
  // Two 30 mm edges and one 10 mm edge.
  const picks=[edges.findIndex(e=>Math.abs(e.length-30)<1e-9),edges.findLastIndex(e=>Math.abs(e.length-30)<1e-9),edges.findIndex(e=>Math.abs(e.length-10)<1e-9)].map(i=>i+1);
  const done=await runner.runAsync(`fillet 1.5 Block edges ${picks.join(' ')}`);
  expect(done.edited).toBe(true);
  // Recorded with references, never with the numbers of this listing.
  expect(done.invocation).toMatch(/^fillet 1\.5 \S+ edges \S+\+\S+ \S+\+\S+ \S+\+\S+$/);
  expect(done.kernel).toEqual(expect.objectContaining({package:'@crispcad/exact-kernel'}));
  const doc=session.state.document,id=doc.roots[0],node=doc.nodes[id];
  expect(doc.version).toBe(EXACT_EDGE_REFERENCE_DOCUMENT_VERSION);
  expect(node.kind==='exact-feature'&&node.edges&&typeof node.edges==='object'&&'references' in node.edges&&node.edges.references).toHaveLength(3);
  const volume=exact.measure(doc).bodies[0].volume;
  // The 10 mm edge meets the two 30 mm ones only if they share a corner; the corner patch is small,
  // so compare with the sum of straight round-offs within the corner correction.
  expect(volume).toBeLessThan(6000);
  expect(Math.abs(6000-volume-(2*roundOff(1.5,30)+roundOff(1.5,10)))).toBeLessThan(2*1.5**3);
  // The recorded line replays on a fresh session of the same model.
  const again=blockSession();
  const replay=createCommandRunner(again.session,{exact:host});
  const replayed=await replay.runAsync(done.invocation.replace(/^fillet 1\.5 \S+/,`fillet 1.5 ${again.box}`).replace(new RegExp(box,'g'),again.box));
  expect(rel(exact.measure(again.session.state.document).bodies[0].volume,volume)).toBeLessThan(1e-12);
  expect(replayed.edited).toBe(true);
 },180_000);

 it('one straight edge matches the closed form; chamfer too',async()=>{
  for(const [operation,removed] of [['fillet',roundOff(2,30)],['chamfer',.5*2*2*30]] as const){
   const {session,box,runner}=blockSession();
   const edges=await edgeList(session,box),n=edges.findIndex(e=>Math.abs(e.length-30)<1e-9)+1;
   await runner.runAsync(`${operation} 2 Block edges ${n}`);
   expect(rel(exact.measure(session.state.document).bodies[0].volume,6000-removed),operation).toBeLessThan(1e-9);
   expect(staleExactFeatures(session.state.document)).toEqual([]);
  }
 },180_000);

 it('the reference survives upstream parameter edits and is resolved again at recompute',async()=>{
  const {session,box,runner}=blockSession();
  const edges=await edgeList(session,box),n=edges.findIndex(e=>Math.abs(e.length-30)<1e-9)+1;
  await runner.runAsync(`fillet 2 Block edges ${n}`);
  const id=session.state.document.roots[0];
  for(const size of [[20,45,10],[35,45,12],[8,60,30]] as [number,number,number][]){
   session.update(box,{size} as never);
   expect(staleExactFeatures(session.state.document)).toEqual([id]);
   const done=await recomputeExactFeatures(session,host,staleExactFeatures(session.state.document));
   expect(done.edited).toBe(true);
   // Still the edge along Y (the former 30 mm edge), now size[1] long.
   expect(rel(exact.measure(session.state.document).bodies[0].volume,size[0]*size[1]*size[2]-roundOff(2,size[1])),String(size)).toBeLessThan(1e-9);
  }
 },180_000);

 it('a hole rim through a parameter change, and a stale reference once the hole leaves the face',async()=>{
  const session=createCadSession(undefined,{kernels});
  const plate=session.add({kind:'box',size:[40,40,8]},{name:'Plate'});
  const hole=session.add({kind:'cylinder',radius:5,height:20,segments:64},{name:'Hole',transform:{...identityTransform(),position:[0,0,0]}});
  session.setRole('hole',[hole]);
  const body=session.combine('union',[plate,hole]);
  session.update(body,{name:'Holed'});
  const runner=createCommandRunner(session,{exact:host});
  const edges=await edgeList(session,body);
  const rims=edges.filter(e=>e.curve==='circle');
  expect(rims).toHaveLength(2);
  const top=rims.reduce((a,b)=>a.points[0][2]>b.points[0][2]?a:b);
  const done=await runner.runAsync(`fillet 1 Holed edges ${top.number}`);
  expect(done.edited).toBe(true);
  const id=session.state.document.roots[0];
  const volume=(r:number)=>exact.measure(session.state.document).bodies[0].volume-(40*40*8-Math.PI*r*r*8);
  // A rim fillet of radius 1 removes a ring (Pappus): corner area (1 - π/4), whose centroid lies
  // (10 - 3π)/(12 - 3π) from the rim, swept around the hole axis.
  const ring=(r:number)=>-(1-Math.PI/4)*2*Math.PI*(r+(10-3*Math.PI)/(12-3*Math.PI));
  expect(volume(5)).toBeCloseTo(ring(5),6);
  session.update(hole,{radius:7} as never);
  await recomputeExactFeatures(session,host,staleExactFeatures(session.state.document));
  expect(volume(7)).toBeCloseTo(ring(7),6);
  // The hole now stops below the top face: the rim's two faces no longer meet. Stale, named, unchanged.
  const before=serializeDocument(session.state.document);
  session.update(hole,{height:6} as never);
  const edited=serializeDocument(session.state.document);
  expect(staleExactFeatures(session.state.document)).toEqual([id]);
  await expect(recomputeExactFeatures(session,host,staleExactFeatures(session.state.document))).rejects.toThrow(/selected edges no longer exist after an upstream change \(the faces .*no longer meet\)/);
  expect(serializeDocument(session.state.document)).toBe(edited);
  expect(staleExactFeatures(session.state.document)).toEqual([id]);
  expect(edited).not.toBe(before);
  try{await recomputeExactFeatures(session,host,[id]);}catch(error){expect((error as {diagnostic?:{reason?:string}}).diagnostic?.reason).toBe(STALE_EDGE_REFERENCE_CODE);}
  // Undo brings the hole back and the reference resolves again.
  session.undo();
  await recomputeExactFeatures(session,host,staleExactFeatures(session.state.document));
  expect(volume(7)).toBeCloseTo(ring(7),6);
 },240_000);

 it('pattern copies get their own face names',async()=>{
  const session=createCadSession(undefined,{kernels});
  const plate=session.add({kind:'box',size:[60,20,6]},{name:'Plate'});
  const hole=session.add({kind:'cylinder',radius:3,height:20,segments:48},{name:'Hole',transform:{...identityTransform(),position:[-20,0,0]}});
  const row=session.patternBody(hole,{mode:'linear',axis:'X',count:3,spacing:20});
  session.setRole('hole',[row]);
  const body=session.combine('union',[plate,row]);
  const edges=await edgeList(session,body);
  const rims=edges.filter(e=>e.curve==='circle');
  expect(rims).toHaveLength(6);
  const names=new Set(rims.map(e=>formatEdgeReference(e.reference!)));
  expect(names.size).toBe(6);
  expect([...names].every(name=>new RegExp(`${row}#[0-2]/${hole}:f\\d`).test(name))).toBe(true);
 },180_000);
});

describe('documents, paste and duplicate',()=>{
 it('version 44 is required for references; older versions refuse them',async()=>{
  const {session,box,runner}=blockSession();
  await runner.runAsync(`chamfer 1 Block edges 1`);
  const doc=structuredClone(session.state.document) as CadDocument;
  expect(validateDocument(doc).version).toBe(44);
  expect(()=>validateDocument({...doc,version:43})).toThrow(/bad exact feature/);
  void box;
 },120_000);

 it('model source and save/load keep the references and the display',async()=>{
  const {session,runner}=blockSession();
  await runner.runAsync('fillet 1 Block edges 4');
  const doc=session.state.document,id=doc.roots[0];
  const source=generateModelSource(doc);
  expect(source).toContain('references');
  const edited=createCadSession(doc,{kernels});
  expect(edited.applyModelSource(source.replace('name: "Fillet of Block"','name: "Rounded"').replace('"name": "Fillet of Block"','"name": "Rounded"'))).toBe(true);
  expect(edited.state.document.nodes[id]).toMatchObject({name:'Rounded',edges:(doc.nodes[id] as {edges:unknown}).edges});
  expect(staleExactFeatures(edited.state.document)).toEqual([]);
  expect(validateDocument(JSON.parse(serializeDocument(doc)))).toEqual(doc);
 },120_000);

 it('a face or all-edge feature stays version 41 and never names faces',async()=>{
  const {session,runner}=blockSession();
  const calls:string[]=[];
  const spy=new Proxy(exact.kernel,{get(target,key,receiver){const value=Reflect.get(target,key,receiver);return typeof value==='function'&&(key==='nameFaces'||key==='topology')?(...args:unknown[])=>{calls.push(String(key));return value.apply(target,args);}:value;}});
  const {createExactBackendFromKernel}=await import('@brickwright/cad-exact');
  const watched=createExactBackendFromKernel(spy);
  const spyHost:ExactCommandHost={run:async request=>runExactRequest(watched,request)};
  await createCommandRunner(session,{exact:spyHost}).runAsync('fillet 1 Block --face +z');
  void runner;
  expect(session.state.document.version).toBe(41);
  watched.exportStep(session.state.document);watched.measure(session.state.document);
  expect(calls).toEqual([]);
 },120_000);

 it('duplicate and paste remap the references and keep the display',async()=>{
  const {session,box,runner}=blockSession();
  await runner.runAsync(`fillet 1 Block edges 2 5`);
  const id=session.state.document.roots[0],key=exactFeatureKey(session.state.document,id);
  session.select([id]);session.duplicate([id]);
  const copy=session.state.document.roots.find(root=>root!==id)!;
  const node=session.state.document.nodes[copy];
  expect(node.kind).toBe('exact-feature');
  const refs=node.kind==='exact-feature'&&node.edges&&typeof node.edges==='object'&&'references' in node.edges?node.edges.references:[];
  expect(refs.flatMap(r=>r.faces).some(f=>f.includes(box))).toBe(false);
  expect(exactFeatureKey(session.state.document,copy)).toBe(key);
  expect(staleExactFeatures(session.state.document)).toEqual([]);
  // The copy's references resolve on the copy's own faces.
  await recomputeExactFeatures(session,host,[copy]);
  const measured=exact.measure(session.state.document).bodies;
  expect(rel(measured[0].volume,measured[1].volume)).toBeLessThan(1e-12);
  // Paste of a fragment.
  const fragment=session.fragment([id]);
  session.insert(fragment,[100,0,0]);
  expect(staleExactFeatures(session.state.document)).toEqual([]);
  validateDocument(session.state.document);
 },180_000);
});

describe('limits and errors',()=>{
 it('the tablet pre-flight counts chosen edges',async()=>{
  const {session,box}=blockSession();
  const limited=createInThreadExactHost({limits:{maxFeatureEdges:2,maxShellFaces:160}});
  await expect(createCommandRunner(session,{exact:limited}).runAsync('fillet 1 Block edges 1 2 3')).rejects.toThrow(/Rounding 3 edges \(0 of them curved\)/);
  const ok=await createCommandRunner(session,{exact:limited}).runAsync('fillet 1 Block edges 1 2');
  expect(ok.edited).toBe(true);
  void box;
 },120_000);
 it('bad edge numbers, several bodies and edges with --face are refused before anything changes',async()=>{
  const {session,runner}=blockSession();
  session.add({kind:'box',size:[5,5,5]},{name:'Other'});
  const before=session.state.revision;
  await expect(runner.runAsync('fillet 1 Block edges 13')).rejects.toThrow(/Edge 13 does not exist; the body has 12 edges/);
  await expect(runner.runAsync('fillet 1 Block edges 0')).rejects.toThrow(/start at 1/);
  await expect(runner.runAsync('fillet 1 Block Other edges 1')).rejects.toThrow(/one body at a time/);
  await expect(runner.runAsync('fillet 1 Block --face +z edges 1')).rejects.toThrow(/edges or a face/);
  await expect(runner.runAsync('shell 1 Block edges 1 --open +z')).rejects.toThrow();
  await expect(runner.runAsync('fillet 1 Block edges nope')).rejects.toThrow(/Not an edge reference/);
  expect(session.state.revision).toBe(before);
 },120_000);
 it('an edge on a fillet round cannot be chosen',async()=>{
  const {session,runner}=blockSession();
  await runner.runAsync('fillet 1 Block --face +z');
  const id=session.state.document.roots[0];
  const edges=await edgeList(session,id);
  const unnamed=edges.find(e=>!e.reference);
  expect(unnamed?.unreferable).toBe('unnamed');
  await expect(runner.runAsync(`chamfer 0.5 "${session.state.document.nodes[id].name}" edges ${unnamed!.number}`)).rejects.toThrow(/without a stable name/);
  // An edge between two named faces of the filleted body can still be chosen (nested feature).
  const named=edges.find(e=>e.reference)!;
  expect((await runner.runAsync(`chamfer 0.5 "${session.state.document.nodes[id].name}" edges ${named.number}`)).edited).toBe(true);
 },180_000);
});
