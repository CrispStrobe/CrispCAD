// SPDX-License-Identifier: BSD-3-Clause
// Host-created editor sessions and the exact kernel: the public SDK surface declares the kernel
// the editor's worker bundles, a host session without it is refused before the kernel runs, and
// the SDK build emits the exact kernel's WebAssembly as a file rather than base64 in a chunk.
import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {createCadSession,createCommandRunner,identityTransform} from '@brickwright/cad-core';
import type {ExactCommandHost,ExactCommandRequest,SessionCommandRecord} from '@brickwright/cad-core';
import {exactKernelIdentity as packageIdentity} from '@brickwright/cad-exact/identity';
import {createEditorSession,editorKernels,exactEditHost,exactKernelIdentity,providesKernel} from '../packages/editor/src/kernels.js';
import {findInlineWasm,INLINE_WASM_LIMIT} from '../scripts/sdk-wasm-check.mjs';

/** A stand-in exact kernel: a fixed display mesh, no WebAssembly. */
function fakeKernel(){
 const requests:ExactCommandRequest['operation'][]=[];
 const host:ExactCommandHost={run:async request=>{
  requests.push(request.operation);
  if(request.operation!=='feature-display')throw new Error('unexpected');
  const {exactFeatureKey}=await import('@brickwright/cad-core');
  return {operation:'feature-display',kernel:{...exactKernelIdentity},features:request.bodies.map(id=>({id,name:'Rounded',volume:1,display:{sourceKey:exactFeatureKey(request.document,id),positions:[0,0,0,1,0,0,0,1,0,0,0,1],indices:[0,2,1,0,1,3,0,3,2,1,2,3]}}))} as never;
 }};
 return {host,requests};
}
const boxIn=(session:ReturnType<typeof createCadSession>)=>session.add({kind:'box',size:[20,30,10]},{name:'Block',transform:{...identityTransform(),position:[0,0,5]}});

describe('editor kernels for host sessions',()=>{
 it('exports the pinned exact kernel identity and declares it on editor sessions',()=>{
  expect(exactKernelIdentity).toBe(packageIdentity);
  expect(exactKernelIdentity).toEqual({id:'smlib',package:'@crispcad/exact-kernel',version:'0.1.0'});
  expect(editorKernels).toEqual([exactKernelIdentity]);
  expect(Object.isFrozen(editorKernels)).toBe(true);
  expect(createEditorSession().kernels).toEqual([exactKernelIdentity]);
  expect(createCadSession().kernels).toEqual([]);
  expect(providesKernel(createEditorSession().kernels,exactKernelIdentity)).toBe(true);
  expect(providesKernel([{...exactKernelIdentity,version:'0.2.0'}],exactKernelIdentity)).toBe(false);
 });
 it('lets the host choose the kernels explicitly, including none',()=>{
  const other={id:'other',package:'@example/kernel',version:'1.0.0'};
  expect(createEditorSession(undefined,{kernels:[]}).kernels).toEqual([]);
  expect(createEditorSession(undefined,{kernels:[...editorKernels,other]}).kernels).toEqual([exactKernelIdentity,other]);
  const session=createCadSession();boxIn(session);
  expect(createEditorSession(session.state.document).state.document).toEqual(session.state.document);
 });
 it('creates and replays an exact feature in a host-created editor session',async()=>{
  const session=createEditorSession(),records:SessionCommandRecord[]=[];boxIn(session);
  const before=session.state.document;
  session.subscribeCommands(record=>records.push(record));
  const {host,requests}=fakeKernel();
  const result=await createCommandRunner(session,{exact:exactEditHost(session,host)}).runAsync('fillet 1 Block');
  expect(result).toMatchObject({edited:true,kernel:{id:'smlib'}});
  expect(requests).toEqual(['feature-display']);
  expect(session.state.document.version).toBe(41);
  const recorded=records.find(record=>record.command.kind==='apply')!;
  expect(recorded.command.kind==='apply'&&recorded.command.context?.kernel).toEqual(exactKernelIdentity);
  // Replay needs a session that declares the same kernel; the SDK's default session does.
  const replay=createEditorSession(before);
  expect(replay.executeCommand(recorded.text)).toBe(true);
  expect(replay.state.document).toEqual(session.state.document);
  expect(()=>createCadSession(before).executeCommand(recorded.text)).toThrow(/which this host does not provide/);
 });
 it('refuses exact edits before running the kernel when the host session does not declare it',async()=>{
  const session=createCadSession();boxIn(session);
  const {host,requests}=fakeKernel(),guarded=exactEditHost(session,host);
  await expect(createCommandRunner(session,{exact:guarded}).runAsync('fillet 1 Block')).rejects.toThrow(/does not declare the exact kernel.*createEditorSession/);
  expect(requests).toEqual([]);
  expect(session.state.revision).toBe(1);
  // Commands that commit nothing pass through.
  await expect(guarded.run({operation:'measure',document:session.state.document,bodies:[]})).rejects.toThrow('unexpected');
  expect(requests).toEqual(['measure']);
  // Without the guard the kernel runs first and only the commit is refused.
  const unguarded=fakeKernel();
  await expect(createCommandRunner(session,{exact:unguarded.host}).runAsync('fillet 1 Block')).rejects.toThrow(/does not provide the smlib kernel/);
  expect(unguarded.requests).toEqual(['feature-display']);
 });
 it('the browser SDK exports the kernel API and declares the bundled kernel by default',()=>{
  const sdk=readFileSync('apps/brickwright/sdk.ts','utf8');
  expect(sdk).toMatch(/export \{createEditorSession,createEditorSession as createCadSession,editorKernels,exactKernelIdentity,providesKernel\} from '@brickwright\/cad-editor'/);
  expect(sdk).not.toMatch(/export \{[^}]*\bcreateCadSession\b[^}]*\} from '@brickwright\/cad-core'/);
 });
});

describe('SDK WebAssembly packaging check',()=>{
 const wasmBase64=(bytes:number)=>Buffer.concat([Buffer.from([0,0x61,0x73,0x6d,1,0,0,0]),Buffer.alloc(bytes,7)]).toString('base64');
 it('finds Vite-inlined WebAssembly data URLs and long base64 WebAssembly runs',()=>{
  expect(findInlineWasm(`const u=new URL("data:application/wasm;base64,${wasmBase64(16)}",import.meta.url);`)).toHaveLength(1);
  expect(findInlineWasm(`const b="${wasmBase64(INLINE_WASM_LIMIT)}";`)[0]).toMatch(/^base64 WebAssembly of [\d.]+ MiB/);
 });
 it('accepts a chunk that references its WebAssembly by URL',()=>{
  expect(findInlineWasm('return new URL("smlibwasm-Ab12Cd34.wasm", import.meta.url).href;')).toEqual([]);
  expect(findInlineWasm(`const short="${wasmBase64(64)}";`)).toEqual([]);
 });
});
