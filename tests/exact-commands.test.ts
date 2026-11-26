// SPDX-License-Identifier: BSD-3-Clause
// Exact-kernel commands outside the kernel itself: kernel identity in recorded commands and
// replay, the terminal's export step / measure exact routing, and the worker client's separate,
// cancellable exact channel.
import {afterEach,describe,expect,it,vi} from 'vitest';
import {createCadSession,createCommandJournal,createDocument,formatExactResult,parseSessionCommand,serializeSessionCommand} from '../packages/core/src/index.js';
import type {ExactCommandHost,ExactCommandResult,KernelIdentity,SessionCommandRecord} from '../packages/core/src/index.js';
import {createTerminalController} from '../packages/editor/src/terminal-controller.js';
import {createGeometryClient} from '../packages/editor/dist/geometry-client.js';
import {exactKernelIdentity} from '@brickwright/cad-exact/identity';

const kernel:KernelIdentity={id:'smlib',package:'@crispcad/exact-kernel',version:'0.1.0'};
const record=(session:ReturnType<typeof createCadSession>)=>{const records:SessionCommandRecord[]=[];session.subscribeCommands(r=>records.push(r));return records;};

describe('kernel identity in recorded commands',()=>{
 it('records the kernel of edits made with it and replays only on the same version',()=>{
  const session=createCadSession(undefined,{kernels:[kernel]}),records=record(session);
  session.withKernel(kernel,()=>session.add({kind:'box',size:[1,2,3]}));
  session.add({kind:'sphere',radius:2,segments:24});
  const [withKernel,plain]=records;
  expect(withKernel.command.kind==='apply'&&withKernel.command.context).toEqual({kernel});
  expect(plain.command.kind==='apply'&&plain.command.context).toBeUndefined();
  expect(parseSessionCommand(withKernel.text)).toEqual(withKernel.command);

  const fresh=()=>createCadSession({...session.state.document,nodes:{},roots:[]},{kernels:[kernel]});
  const same=fresh(),replayed=record(same);
  expect(same.executeCommand(withKernel.text)).toBe(true);
  // The replayed edit is recorded again with the kernel it was checked against.
  expect(replayed[0].command.kind==='apply'&&replayed[0].command.context?.kernel).toEqual(kernel);

  const newer=createCadSession({...session.state.document,nodes:{},roots:[]},{kernels:[{...kernel,version:'0.2.0'}]});
  expect(()=>newer.executeCommand(withKernel.text)).toThrow('Recorded command is stale: it was built with @crispcad/exact-kernel 0.1.0, but this host has 0.2.0');
  expect(newer.state.revision).toBe(0);
  const none=createCadSession({...session.state.document,nodes:{},roots:[]});
  expect(()=>none.executeCommand(withKernel.text)).toThrow(/built with the smlib kernel \(@crispcad\/exact-kernel 0\.1\.0\), which this host does not provide/);
  // Records without a kernel stay valid everywhere.
  expect(createCadSession(same.state.document).executeCommand(plain.text)).toBe(true);
 });
 it('validates kernel identities and refuses undeclared kernels',()=>{
  const session=createCadSession(undefined,{kernels:[kernel]});
  expect(()=>session.withKernel({...kernel,version:'9'},()=>0)).toThrow(/does not provide/);
  expect(()=>createCadSession(undefined,{kernels:[{id:'bad id',package:'x',version:'1'}]})).toThrow(/invalid kernel identity/);
  const base={version:1,kind:'apply',projectId:session.state.document.id,label:'x',changes:[{path:['title'],before:{present:true,value:'a'},after:{present:true,value:'b'}}],selection:[]};
  expect(()=>serializeSessionCommand({...base,context:{kernel:{...kernel,extra:1}}} as never)).toThrow(/unsupported property/);
  expect(()=>serializeSessionCommand({...base,context:{kernel:{...kernel,version:'0.1.0\n'}}} as never)).toThrow(/invalid kernel identity/);
  expect(serializeSessionCommand({...base,context:{kernel}} as never)).toContain('"kernel":{"id":"smlib"');
 });
 it('keeps kernel records in the journal replay export, and the shipped identity matches',()=>{
  const session=createCadSession(undefined,{kernels:[exactKernelIdentity]}),journal=createCommandJournal(session);
  session.withKernel(exactKernelIdentity,()=>session.add({kind:'box',size:[1,1,1]}));
  const replay=journal.export('replay');
  expect(replay).toContain('"context":{"kernel":{"id":"smlib","package":"@crispcad/exact-kernel","version":"0.1.7"}}');
  expect(journal.export('cadscript')).toMatch(/non-portable/);
  journal.dispose();
 });
});

const measure:ExactCommandResult={operation:'measure',kernel,bodies:[{id:'b',name:'Block',volume:6000,area:2200,bounds:{min:[-5,-10,0],max:[5,10,30]},centroid:[0,0,15],solids:1}]};
describe('terminal',()=>{
 it('routes export step and measure exact to the exact host; bare export opens the dialog',async()=>{
  const session=createCadSession(),id=session.add({kind:'box',size:[10,20,30]},{name:'Block'});
  const run=vi.fn<ExactCommandHost['run']>(async request=>request.operation==='measure'?measure:{operation:'export-step',kernel,bodies:[{id,name:'Block'}],step:'ISO-10303-21;\nEND-ISO-10303-21;\n',bytes:36});
  const saveFile=vi.fn(async()=>{}),executeEditorCommand=vi.fn();
  const terminal=createTerminalController(session,{executeEditorCommand,openCodeWorkspace:vi.fn(),exact:{run},saveFile});
  await terminal.submit('measure exact "Block"');
  expect(run).toHaveBeenLastCalledWith({operation:'measure',document:session.state.document,bodies:[id]});
  expect(terminal.state.entries.at(-1)!.summary).toMatch(/Block \(b\): volume 6000 mm³ · area 2200 mm²/);
  // Without targets: the selected top-level bodies; `all` asks for every solid body.
  await terminal.submit('export step');
  expect(run).toHaveBeenLastCalledWith({operation:'export-step',document:session.state.document,bodies:[id]});
  await terminal.submit('export step all');
  expect(run).toHaveBeenLastCalledWith({operation:'export-step',document:session.state.document,bodies:[]});
  expect(saveFile).toHaveBeenCalledWith({name:'Untitled design.step',mime:'model/step',text:'ISO-10303-21;\nEND-ISO-10303-21;\n'});
  await terminal.submit('export');
  expect(executeEditorCommand).toHaveBeenCalledWith('export');
  await terminal.submit('export stl');
  expect(terminal.state.entries.at(-1)).toMatchObject({kind:'error',summary:'Usage: export step [all|"name"|id ...].'});
  run.mockRejectedValueOnce(new Error('Scan (mesh): Imported meshes have no exact B-rep'));
  await terminal.submit('measure exact all');
  expect(terminal.state.entries.at(-1)).toMatchObject({kind:'error',summary:'Scan (mesh): Imported meshes have no exact B-rep'});
  const none=createTerminalController(createCadSession(),{executeEditorCommand,openCodeWorkspace:vi.fn()});
  await none.submit('measure exact');
  expect(none.state.entries.at(-1)).toMatchObject({kind:'error',summary:'The exact kernel is not available in this host.'});
  terminal.dispose();none.dispose();
 });
});

class MockWorker {
 onmessage:((event:{data:unknown})=>void)|null=null;
 onerror:((event:{message:string})=>void)|null=null;
 messages:any[]=[];terminated=false;
 postMessage(data:unknown){this.messages.push(data);}
 terminate(){this.terminated=true;}
}
afterEach(()=>vi.useRealTimers());
describe('geometry client exact channel',()=>{
 it('runs exact requests in their own worker that cancellation terminates',async()=>{
  const workers:MockWorker[]=[],client=createGeometryClient('wasm',()=>{const w=new MockWorker();workers.push(w);return w as unknown as Worker;});
  const evaluation=client.evaluate(createDocument());
  const controller=new AbortController(),exact=client.exact.run({operation:'measure',document:createDocument(),bodies:[]},controller.signal);
  expect(workers).toHaveLength(2);
  expect(workers[1].messages[0].exact).toMatchObject({operation:'measure',bodies:[]});
  const cancelled=expect(exact).rejects.toThrow('Request cancelled');controller.abort();await cancelled;
  expect(workers[1].terminated).toBe(true);expect(workers[0].terminated).toBe(false);
  workers[0].onmessage!({data:{request:workers[0].messages[0].request,result:{bodies:[],volume:0,triangles:0}}});
  expect((await evaluation).volume).toBe(0);
  const second=client.exact.run({operation:'measure',document:createDocument(),bodies:[]});
  const timed={...measure,timing:{loadMs:812.4,runMs:3.2,memoryBytes:64*1048576}};
  workers[2].onmessage!({data:{request:workers[2].messages[0].request,result:timed}});
  expect(await second).toEqual(timed);
  expect(formatExactResult(timed,createDocument()).output).toMatch(/\nExact kernel: load 812 ms · run 3 ms · WASM memory 64 MiB$/);
  const failed=client.exact.run({operation:'export-step',document:createDocument(),bodies:[]});
  const rejected=expect(failed).rejects.toMatchObject({name:'ExactCommandError',diagnostic:{feature:'mesh'}});
  workers[2].onmessage!({data:{request:workers[2].messages[1].request,error:'Scan (mesh): no exact B-rep',exactDiagnostic:{code:'unsupported',bodyId:'s',nodeId:'s',feature:'mesh',message:'Scan (mesh): no exact B-rep'}}});
  await rejected;
  client.dispose();
 });
 it('falls back to the host\'s in-thread runner when the exact worker cannot start, never for Manifold',async()=>{
  const runs:string[]=[],fallback={run:async(request:{operation:string})=>{runs.push(request.operation);return measure;}};
  // A constructor that throws: the request runs in the fallback, and so does every later one.
  let constructed=0;
  const thrown=createGeometryClient('wasm',()=>{constructed++;throw new Error('Workers are disabled');},{exactFallback:fallback as never});
  expect(await thrown.exact.run({operation:'measure',document:createDocument(),bodies:[]})).toEqual(measure);
  expect(await thrown.exact.run({operation:'export-step',document:createDocument(),bodies:[]})).toEqual(measure);
  expect(runs).toEqual(['measure','export-step']);expect(constructed).toBe(1);
  await expect(thrown.evaluate(createDocument())).rejects.toThrow('Workers are disabled');
  thrown.dispose();
  // A worker script that fails to load before answering: what is waiting moves to the fallback.
  const workers:MockWorker[]=[],failing=createGeometryClient('wasm',()=>{const w=new MockWorker();workers.push(w);return w as unknown as Worker;},{exactFallback:fallback as never});
  const waiting=failing.exact.run({operation:'measure',document:createDocument(),bodies:[]});
  workers[0].onerror!({message:'Module scripts are not supported'});
  expect(await waiting).toEqual(measure);expect(workers[0].terminated).toBe(true);
  // A worker that answered once keeps its errors: a crash later is not a reason to block the UI.
  const answering=createGeometryClient('wasm',()=>{const w=new MockWorker();workers.push(w);return w as unknown as Worker;},{exactFallback:fallback as never});
  const first=answering.exact.run({operation:'measure',document:createDocument(),bodies:[]});
  const worker=workers.at(-1)!;worker.onmessage!({data:{request:worker.messages[0].request,result:measure}});await first;
  const crashed=answering.exact.run({operation:'measure',document:createDocument(),bodies:[]});
  worker.onerror!({message:'out of memory'});
  await expect(crashed).rejects.toThrow('out of memory');
  expect(runs).toHaveLength(3);
  failing.dispose();answering.dispose();
 });
 it('gives the first exact request 60 seconds before stopping it',async()=>{
  vi.useFakeTimers();
  const workers:MockWorker[]=[],client=createGeometryClient('wasm',()=>{const w=new MockWorker();workers.push(w);return w as unknown as Worker;});
  const request=client.exact.run({operation:'measure',document:createDocument(),bodies:[]});
  const failure=expect(request).rejects.toThrow(/60 seconds/);
  await vi.advanceTimersByTimeAsync(30000);expect(workers[0].terminated).toBe(false);
  await vi.advanceTimersByTimeAsync(30000);await failure;expect(workers[0].terminated).toBe(true);
  client.dispose();
 });
});
