// SPDX-License-Identifier: BSD-3-Clause
// Split a body at a plane (convergence Phase 6.5, document version 49): split nodes in Manifold
// and in the exact kernel (the cut face is an exact plane), both halves following the source,
// the command, plane edits, validation and version gate, model source, history and Undo.
import {readFileSync} from 'node:fs';
import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {SPLIT_DOCUMENT_VERSION,createCadSession,createCommandJournal,createCommandRunner,identityTransform,parseDocument,serializeDocument,setLocale,validateDocument} from '@brickwright/cad-core';
import type {CadDocument} from '@brickwright/cad-core';
import {createGeometryKernel} from '@brickwright/cad-geometry';
import type {GeometryKernel} from '@brickwright/cad-geometry';
import {createExactBackend,lowerDocumentBody} from '@brickwright/cad-exact';
import type {ExactBackend} from '@brickwright/cad-exact';
import {appendPortableRevision,readPortableHistory} from '@brickwright/cad-history';

vi.setConfig({testTimeout:120_000});
let exact:ExactBackend,manifold:GeometryKernel;
beforeAll(async()=>{
 [exact,manifold]=await Promise.all([createExactBackend(),createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')})]);
},120_000);
afterAll(()=>setLocale('en'));

/** A 40 × 30 × 20 box resting on z = 0 with a Ø10 hole through it, as one body. */
function plate(){
 const session=createCadSession();
 const box=session.add({kind:'box',size:[40,30,20]},{name:'Plate',transform:{...identityTransform(),position:[0,0,10]}});
 const hole=session.add({kind:'cylinder',radius:5,height:30,segments:64},{transform:{...identityTransform(),position:[0,0,10]}});
 session.select([box,hole]);session.combine('subtract');
 return {session,body:session.state.document.roots[0]};
}
const volumes=(doc:CadDocument)=>Object.fromEntries(manifold.evaluate(doc).bodies.map(b=>[b.name,b.volume]));

describe('split nodes',()=>{
 it('splits a body into two halves that add up, in Manifold and exactly',()=>{
  const {session,body}=plate(),before=session.state.document.version,whole=manifold.evaluate(session.state.document).volume;
  const ids=session.splitBody(body,{normal:[0,0,1],offset:8});
  const doc=session.state.document;
  expect(before).toBeLessThan(SPLIT_DOCUMENT_VERSION);
  expect(doc.version).toBe(SPLIT_DOCUMENT_VERSION);
  expect(doc.roots).toEqual(ids);
  expect(ids.map(id=>doc.nodes[id])).toMatchObject([{kind:'split',side:'positive',source:body,name:'Subtract (+ side)'},{kind:'split',side:'negative',source:body,name:'Subtract (− side)'}]);
  // Exact volumes: (40·30 − π·25) per mm of height; the plane at z = 8 leaves 12 mm above and 8 below.
  const perMm=40*30-Math.PI*25;
  const measured=exact.measure(doc).bodies;
  expect(measured[0].volume).toBeCloseTo(12*perMm,6);
  expect(measured[1].volume).toBeCloseTo(8*perMm,6);
  expect(measured[0].bounds.min[2]).toBeCloseTo(8,9);expect(measured[1].bounds.max[2]).toBeCloseTo(8,9);
  // Manifold: a 64-gon hole, so within the polygon's area deficit.
  const v=Object.values(volumes(doc));
  expect(v[0]+v[1]).toBeCloseTo(whole,6);
  expect(v[0]/v[1]).toBeCloseTo(12/8,4);
 });
 it('keeps the exact surfaces: the cut face is a plane and the hole stays a cylinder',()=>{
  const {session,body}=plate();
  const [upper]=session.splitBody(body,{normal:[0,0,1],offset:8,keep:'positive'});
  const doc=session.state.document;
  expect(doc.roots).toEqual([upper]);
  const faces=exact.kernel.scope(()=>exact.kernel.topology(lowerDocumentBody(exact.kernel,doc,upper)).faces);
  expect(faces.filter(f=>f.surface==='cylinder').map(f=>f.radius)).toEqual(expect.arrayContaining([5]));
  const cut=faces.filter(f=>f.surface==='plane'&&Math.abs(f.normal[2]+1)<1e-9);
  expect(cut).toHaveLength(1);
  expect(cut[0].point[2]).toBeCloseTo(8,9);
  expect(cut[0].area).toBeCloseTo(40*30-Math.PI*25,6);
 });
 it('splits along any normal and offset; a plane that misses the body is an error',()=>{
  const session=createCadSession();
  const cube=session.add({kind:'box',size:[20,20,20]});
  const ids=session.splitBody(cube,{normal:[1,1,0],offset:0});
  const m=exact.measure(session.state.document).bodies;
  expect(m[0].volume).toBeCloseTo(4000,6);expect(m[1].volume).toBeCloseTo(4000,6);
  expect(m[0].centroid[0]+m[0].centroid[1]).toBeGreaterThan(0);
  const missed=createCadSession(),box=missed.add({kind:'box',size:[10,10,10]});
  missed.splitBody(box,{normal:[0,0,1],offset:50});
  expect(()=>manifold.evaluate(missed.state.document)).toThrow(/Nothing of the body lies on the − side|Nothing of the body lies on the \+ side/);
  expect(()=>exact.measure(missed.state.document)).toThrow(/Nothing of the body lies/);
  expect(ids).toHaveLength(2);
 });
 it('both halves follow edits of the source and of the plane',()=>{
  const session=createCadSession();
  const box=session.add({kind:'box',size:[10,10,10]},{transform:{...identityTransform(),position:[0,0,5]}});
  const [a,b]=session.splitBody(box,{normal:[0,0,1],offset:4});
  session.update(box,{size:[20,10,10]} as never);
  let v=volumes(session.state.document);
  expect(v[session.state.document.nodes[a].name]).toBeCloseTo(20*10*6,6);
  session.editSplit(a,{normal:[0,0,1],offset:7});
  const doc=session.state.document;
  expect(doc.nodes[b]).toMatchObject({offset:7});
  v=volumes(doc);
  expect(v[doc.nodes[a].name]).toBeCloseTo(20*10*3,6);expect(v[doc.nodes[b].name]).toBeCloseTo(20*10*7,6);
  session.undo();session.undo();session.undo();
  expect(session.state.document.roots).toEqual([box]);
 });
 it('refuses joints, holes and reference helpers, and documents before version 49',()=>{
  const {session,body}=plate();
  session.splitBody(body,{normal:[0,0,1],offset:8});
  const doc=JSON.parse(serializeDocument(session.state.document));
  expect(()=>parseDocument(JSON.stringify({...doc,version:48}))).toThrow(/requires document version 49/);
  const bad=structuredClone(doc);bad.nodes[bad.roots[0]].normal=[0,0,0];
  expect(()=>parseDocument(JSON.stringify(bad))).toThrow(/bad split/);
  const side=structuredClone(doc);side.nodes[side.roots[0]].side='up';
  expect(()=>parseDocument(JSON.stringify(side))).toThrow(/bad split/);
  const s=createCadSession(),cutter=s.add({kind:'box',size:[1,1,1]});
  s.setRole('hole',[cutter]);
  expect(()=>s.splitBody(cutter,{normal:[0,0,1],offset:0})).toThrow(/Hole cutters cannot be split/);
  expect(()=>s.splitBody('missing',{normal:[0,0,1],offset:0})).toThrow(/Select one top-level body to split/);
  expect(()=>s.splitBody(cutter,{normal:[0,0,0],offset:0})).toThrow();
 });
});

describe('split command, model source and history',()=>{
 it('runs from the registry with a canonical invocation and is journaled',()=>{
  const {session,body}=plate(),journal=createCommandJournal(session);
  const runner=createCommandRunner(session,{journal});
  const result=runner.run(`split ${body} z 8`);
  expect(result.invocation).toBe(`split ${body} z 8`);
  expect(result.output).toMatch(/Subtract \(\+ side\), Subtract \(− side\)/);
  expect(session.state.document.roots).toHaveLength(2);
  expect(journal.entries.map(e=>e.invocation)).toContain(`split ${body} z 8`);
  session.select([session.state.document.roots[0]]);
  const keep=runner.run('split -x 3 keep negative');
  expect(keep.invocation).toMatch(/^split \S+ -x 3 negative$/);
  expect(()=>runner.run('split')).toThrow(/Usage: split/);
  expect(()=>runner.run('split nope z')).toThrow(/Choose one existing object/);
 });
 it('round-trips through model source and the history archive; German names',async()=>{
  const {session,body}=plate();
  session.splitBody(body,{normal:[0,1,0],offset:-2});
  const doc=session.state.document;
  const source=createCadSession(doc);source.enableModelSource();
  const text=source.modelSource;expect(text).toContain('split(');
  const reread=createCadSession(doc);reread.applyModelSource(text);
  expect(reread.state.document.nodes).toEqual(doc.nodes);expect(reread.state.document.roots).toEqual(doc.roots);
  const archive=await appendPortableRevision(undefined,doc,'Split body');
  const back=await readPortableHistory(archive);
  expect(JSON.parse(serializeDocument(back.readDocument(back.project.headId)))).toEqual(JSON.parse(serializeDocument(doc)));
  setLocale('de');
  const de=plate();de.session.splitBody(de.body,{normal:[0,0,1],offset:1});
  expect(de.session.state.document.nodes[de.session.state.document.roots[0]].name).toMatch(/\(\+-Seite\)$/);
  setLocale('en');
 });
});
