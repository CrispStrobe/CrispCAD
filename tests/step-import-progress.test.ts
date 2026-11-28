// SPDX-License-Identifier: BSD-3-Clause
// STEP import on tablets: the exact worker reports how far an import has got (reading the file,
// then each body), the client turns it into the exact activity the status bar shows, and the
// document of a many-body import serializes in one pass, byte for byte as before.
import {readFileSync} from 'node:fs';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {createCadSession,parseDocument,runStepImport,serializeDocument,setLocale,validateDocument} from '@brickwright/cad-core';
import type {CadDocument,ExactCommandHost,ExactProgress} from '@brickwright/cad-core';
import {createExactBackend,EXACT_LIMITS_TABLET,exactKernelIdentity,runExactRequest} from '@brickwright/cad-exact';
import type {ExactBackend} from '@brickwright/cad-exact';
import {createGeometryClient} from '../packages/editor/src/geometry-client.js';

let exact:ExactBackend;
beforeAll(async()=>{exact=await createExactBackend();},120_000);
afterAll(()=>setLocale('en'));
const HOLDER='library/sources/adafruit-electronics/830 Battery Holder 4xAA.step';
const MPM='library/sources/adafruit-electronics/4739 MPM3610 5V Buck.step';

/** The serializer as it was before the one-pass replacement, to compare against. */
function serializeBefore(document:CadDocument):string{
 const valid=validateDocument(document),buffers=new Map<unknown,string>();
 for(const node of Object.values(valid.nodes) as {kind?:string;display?:{positions?:unknown;indices?:unknown}}[]){
  if((node.kind!=='exact-feature'&&node.kind!=='exact-body')||!node.display)continue;
  for(const array of [node.display.positions,node.display.indices])if(Array.isArray(array))buffers.set(array,`\u0000exact-display:${buffers.size}\u0000`);
 }
 let result=JSON.stringify(valid,buffers.size?(_key,value)=>buffers.get(value)??value:undefined,2);
 for(const [array,token] of buffers)result=result.replace(JSON.stringify(token),()=>JSON.stringify(array));
 return result;
}

describe('STEP import progress',()=>{
 it('reports the read, then every body in order, and the bodies are the same as without it',async()=>{
  const bytes=new Uint8Array(readFileSync(MPM)),seen:ExactProgress[]=[];
  const result=runExactRequest(exact,{operation:'import-step',document:createCadSession().state.document,bodies:[],step:{name:'mpm.step',bytes}},0,{limits:EXACT_LIMITS_TABLET,progress:p=>seen.push(p)});
  if(result.operation!=='import-step')throw new Error('unexpected');
  expect(result.bodies).toHaveLength(23);
  expect(seen[0]).toEqual({phase:'read',done:0,total:1});
  expect(seen.slice(1)).toEqual(Array.from({length:24},(_,done)=>({phase:'body',done,total:23})));
  const plain=runExactRequest(exact,{operation:'import-step',document:createCadSession().state.document,bodies:[],step:{name:'mpm.step',bytes}},0,{limits:EXACT_LIMITS_TABLET});
  if(plain.operation!=='import-step')throw new Error('unexpected');
  expect(plain.bodies.map(b=>b.body.measures)).toEqual(result.bodies.map(b=>b.body.measures));
 },120_000);

 it('reaches the exact activity while the request is still running, and clears with it',async()=>{
  // A fake exact worker: two progress messages, then the result.
  let onmessage:((event:{data:unknown})=>void)|undefined;
  const worker={postMessage(message:{request:number}){
   const reply=(data:unknown)=>setTimeout(()=>onmessage?.({data}),0);
   reply({request:message.request,progress:{phase:'read',done:0,total:1}});
   reply({request:message.request,progress:{phase:'body',done:3,total:23}});
   setTimeout(()=>onmessage?.({data:{request:message.request,result:{operation:'import-step',bodies:[],notes:[],kernel:{}}}}),20);
  },terminate(){},set onmessage(f:typeof onmessage){onmessage=f;},get onmessage(){return onmessage;},onerror:null} as unknown as Worker;
  const client=createGeometryClient('manifold.wasm',()=>worker);
  const states:string[]=[];
  client.onExactActivity(a=>states.push(a.busy?`${a.operation} ${a.progress?`${a.progress.phase} ${a.progress.done}/${a.progress.total}`:'-'}`:'idle'));
  await client.exact.run({operation:'import-step',document:createCadSession().state.document,bodies:[],step:{name:'x.step',bytes:new Uint8Array([1])}});
  expect(states).toEqual(['import-step -','import-step read 0/1','import-step body 3/23','idle']);
  client.dispose();
 });
});

describe('serializing a many-body import',()=>{
 it('writes the same text as before, in one pass over it',async()=>{
  const host:ExactCommandHost={run:async request=>runExactRequest(exact,request)};
  for(const file of [HOLDER,MPM]){
   const session=createCadSession(undefined,{kernels:[exactKernelIdentity]});
   await runStepImport(session,host,{name:file.split('/').pop()!,bytes:new Uint8Array(readFileSync(file))});
   const doc=session.state.document,text=serializeDocument(doc);
   expect(text).toBe(serializeBefore(doc));
   expect(serializeDocument(parseDocument(text))).toBe(text);
   expect(text).not.toContain('exact-display:');
  }
 },180_000);
});
