// SPDX-License-Identifier: BSD-3-Clause
import {readFileSync} from 'node:fs';
import {beforeAll,expect,it} from 'vitest';
import {createCadSession,designGraph,generateModelSource,compileModelSource,parseDocument,validateDocument,identityTransform} from '@brickwright/cad-core';
import {createGeometryKernel} from '@brickwright/cad-geometry';

let kernel:Awaited<ReturnType<typeof createGeometryKernel>>;
beforeAll(async()=>{kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});});
const result=(session:ReturnType<typeof createCadSession>)=>kernel.evaluate(session.state.document).bodies[0];

it('creates negative linear spacing with stable source and output identities and merges overlapping copies',()=>{
 const session=createCadSession(),source=session.add({kind:'box',size:[4,4,4]});
 const id=session.patternBody(source,{mode:'linear',axis:'Y',count:3,spacing:-10});
 expect(result(session).bounds).toEqual({min:[-2,-22,-2],max:[2,2,2]});
 expect(result(session).volume).toBeCloseTo(192);
 session.editPattern(id,{mode:'linear',axis:'Y',count:3,spacing:-2});
 expect(result(session).volume).toBeCloseTo(128);
 session.update(source,{size:[4,6,4]});
 expect(result(session).volume).toBeCloseTo(160);
 expect(result(session).id).toBe(id);
 session.undo();
 expect(result(session).volume).toBeCloseTo(128);
 expect(parseDocument(session.serialize())).toEqual(session.state.document);
});

it('creates a full bolt circle without duplicating the first instance',()=>{
 const session=createCadSession();
 const transform=identityTransform();
 transform.position=[14,2,1];
 const bolt=session.add({kind:'cylinder',radius:1,height:2,segments:32},{transform});
 const original=result(session).volume;
 session.patternBody(bolt,{mode:'circular',axis:'Z',count:4,center:[4,2],sweep:360});
 const pattern=result(session);
 expect(pattern.bounds).toEqual({min:[-7,-9,0],max:[15,13,2]});
 expect(pattern.volume).toBeCloseTo(4*original);
});

it('rotates about a non-Z axis and includes the end of a negative partial sweep',()=>{
 const session=createCadSession();
 const transform=identityTransform();
 transform.position=[0,11,2];
 const source=session.add({kind:'box',size:[2,2,2]},{transform});
 session.patternBody(source,{mode:'circular',axis:'X',count:2,center:[1,2],sweep:-90});
 const mesh=result(session);
 expect(mesh.bounds).toEqual({min:[-1,0,-9],max:[1,12,3]});
 expect(mesh.volume).toBeCloseTo(16);
});

it('keeps symbolic settings through source, paste, duplicate, and rejects invalid edits atomically',()=>{
 const session=createCadSession();
 session.setParametric({version:1,parameters:{
  instances:{unit:'scalar',expression:'3'},pitch:{unit:'mm',expression:'12'},unused:{unit:'mm',expression:'5'}
 },bindings:[]});
 const seed=session.add({kind:'box',size:[2,2,2]});
 const id=session.patternBody(seed,{mode:'linear',axis:'X',count:'instances',spacing:'pitch'});
 const doc=session.state.document,original=session.serialize();
 expect(compileModelSource(generateModelSource(doc),doc).nodes[id]).toEqual(doc.nodes[id]);
 expect(designGraph(doc).find(record=>record.id===id)?.dependencies).toEqual(['feature:'+seed,'parameter:instances','parameter:pitch']);
 expect(()=>session.editPattern(id,{mode:'linear',axis:'Y',count:2.5,spacing:10})).toThrow('whole number');
 expect(()=>session.editPattern(id,{mode:'linear',axis:'Y',count:3,spacing:0})).toThrow('spacing');
 expect(session.serialize()).toBe(original);
 const fragment=session.fragment([id]);
 expect(Object.keys(fragment.parametric!.parameters)).toEqual(['instances','pitch']);
 const host=createCadSession();
 host.setParametric({version:1,parameters:{pitch:{unit:'mm',expression:'5'}},bindings:[]});
 host.insert(fragment,[7,0,0],{mergeParameters:true});
 const [pasted]=host.state.selection;
 expect(host.state.document.nodes[pasted]).toMatchObject({pattern:{spacing:'pitch_2'}});
 expect(result(host).bounds.max[0]).toBe(32);
 host.duplicate([pasted]);
 const duplicate=host.state.document.nodes[host.state.selection[0]];
 expect(duplicate.kind).toBe('pattern');
 if(duplicate.kind!=='pattern')throw Error('fixture');
 expect(duplicate.source).not.toBe(seed);
 const corrupt=structuredClone(doc),node=corrupt.nodes[id];
 if(node.kind!=='pattern')throw Error('fixture');
 node.source=id;
 expect(()=>validateDocument(corrupt)).toThrow('cyclic');
});

it('drives an editable circular hole pattern through a downstream boolean',()=>{
 const session=createCadSession();
 session.setParametric({version:1,parameters:{
  center:{unit:'mm',expression:'4'},turn:{unit:'deg',expression:'360'}
 },bindings:[]});
 const transform=identityTransform();
 transform.position=[14,0,0];
 const drill=session.add({kind:'cylinder',radius:1,height:10,segments:64},{transform});
 session.setRole('hole',[drill]);
 const id=session.patternBody(drill,{mode:'circular',axis:'Z',count:4,center:['center',0],sweep:'turn'});
 expect(session.state.document.nodes[id].role).toBe('hole');
 const plate=session.add({kind:'box',size:[50,50,4]});
 const resultId=session.combine('union',[plate,id]);
 const saved=session.state.document;
 expect(compileModelSource(generateModelSource(saved),saved).nodes[id]).toEqual(saved.nodes[id]);
 expect(result(session).id).toBe(resultId);
 const before=result(session).volume;
 session.editPattern(id,{mode:'circular',axis:'Z',count:6,center:['center',0],sweep:'turn'});
 expect(result(session).id).toBe(resultId);
 expect(before-result(session).volume).toBeCloseTo(25.09,1);
});
