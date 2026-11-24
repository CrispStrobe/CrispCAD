// SPDX-License-Identifier: BSD-3-Clause
import {describe,expect,it,vi} from 'vitest';
import {createCadSession} from '../packages/core/src/index.js';
import {parseTerminalPoint,terminalArguments} from '../packages/editor/src/terminal-coordinates.js';
import {completeTerminalCommand,createTerminalController} from '../packages/editor/src/terminal-controller.js';

function fixture(storage?:{getItem:(key:string)=>string|null;setItem:(key:string,value:string)=>void}){
 const session=createCadSession(),executeEditorCommand=vi.fn((command:string)=>{if(command==='undo')session.undo();else if(command==='redo')session.redo();else if(command==='delete')session.remove();}),openCodeWorkspace=vi.fn();
 const terminal=createTerminalController(session,{executeEditorCommand,openCodeWorkspace,storage});
 return {session,terminal,executeEditorCommand,openCodeWorkspace};
}
describe('terminal coordinates',()=>{
 it('accepts absolute, relative and polar points with explicit world Z semantics',()=>{
  expect(parseTerminalPoint('#10, 20')).toEqual([10,20,0]);
  expect(parseTerminalPoint('1e2,-.5,3')).toEqual([100,-.5,3]);
  expect(parseTerminalPoint('@5,-2',[10,20,7])).toEqual([15,18,7]);
  expect(parseTerminalPoint('10<90')).toEqual([0,10,0]);
  expect(parseTerminalPoint('@10<90',[2,3,4])).toEqual([2,13,4]);
 });
 it.each(['','1','1,2,3,4','1e999,2','NaN,2','0x10,0','@1,2','1<2<3','-3<45','100001,0','Infinity,0'])('rejects invalid coordinates %s',value=>{
  expect(()=>parseTerminalPoint(value)).toThrow();
 });
 it('keeps quoted names and coordinate whitespace intact',()=>{
  expect(terminalArguments('10, 20, 30 0, 0, 15')).toEqual(['10,20,30','0,0,15']);
  expect(terminalArguments('"Box with spaces" other')).toEqual(['Box with spaces','other']);
  expect(()=>terminalArguments('"missing')).toThrow();
 });
});
describe('CAD terminal session bridge',()=>{
 it('prompts without touching the model and completes one Undo step',async()=>{
  const {session,terminal}=fixture();
  await terminal.submit('B');expect(terminal.state.prompt?.command).toBe('box');expect(session.state.revision).toBe(0);
  await terminal.submit('20,30,10');expect(terminal.state.prompt?.point).toBe(true);expect(session.state.revision).toBe(0);
  await terminal.submit('');expect(session.state.document.roots).toHaveLength(1);expect(session.state.revision).toBe(1);
  const body=session.state.document.nodes[session.state.document.roots[0]];expect(body.transform.position).toEqual([0,0,5]);
  expect(terminal.state.entries.filter(entry=>entry.kind==='action')).toHaveLength(1);
  session.undo();expect(session.state.document.roots).toHaveLength(0);expect(session.state.canUndo).toBe(false);
 });
 it('leaves invalid prompts editable and Escape cancellation leaves history intact',async()=>{
  const {session,terminal}=fixture();await terminal.submit('cylinder 5');await terminal.submit('-3');
  expect(terminal.state.prompt?.message).toContain('Height');expect(session.state.revision).toBe(0);
  await terminal.submit('20');terminal.cancel();expect(terminal.state.prompt).toBeUndefined();expect(session.state.canUndo).toBe(false);
 });
 it('validates primitive dimensions at their own prompt before asking for placement',async()=>{
  const {session,terminal}=fixture();await terminal.submit('sphere 60000');expect(terminal.state.prompt?.message).toBe('Radius (mm).');await terminal.submit('5');await terminal.submit('');expect(session.state.document.roots).toHaveLength(1);
  await terminal.submit('box .001,2,3');expect(terminal.state.prompt?.message).toContain('Box dimensions');terminal.cancel();expect(session.history.past).toHaveLength(1);
 });
 it('accepts typed and picked points through one pending command',async()=>{
  const {session,terminal}=fixture();await terminal.submit('line');await terminal.submitPoint([10,20,0]);await terminal.submit('@10<90');
  const sketch=Object.values(session.state.document.sketches!)[0];
  expect(sketch.profile).toMatchObject({kind:'path',points:[[10,20],[10,30]]});expect(session.history.past).toHaveLength(1);
  await terminal.submit('line 1,2,4 5,6,4');expect(terminal.state.prompt?.command).toBe('line');expect(session.history.past).toHaveLength(1);
 });
 it('moves a group once and preserves the existing transform guards',async()=>{
  const {session,terminal}=fixture();const a=session.add({kind:'box',size:[10,10,10]}),b=session.add({kind:'sphere',radius:5,segments:16});session.select([a,b]);const before=session.state.revision;
  await terminal.submit('m 0,0,0 @10,20,3');expect(session.state.revision).toBe(before+1);
  expect(session.state.document.nodes[a].transform.position).toEqual([10,20,3]);expect(session.state.document.nodes[b].transform.position).toEqual([10,20,3]);
  session.undo();expect(session.state.document.nodes[a].transform.position).toEqual([0,0,0]);
 });
 it('extrudes a closed typed sketch with a separate reversible feature',async()=>{
  const {session,terminal}=fixture();await terminal.submit('rect 0,0 20,30');const id=Object.keys(session.state.document.sketches!)[0];
  await terminal.submit('ex '+id+' 5');expect(session.state.document.roots).toHaveLength(1);expect(session.history.past).toHaveLength(2);
  expect(session.state.document.nodes[session.state.document.roots[0]]).toMatchObject({kind:'extrusion',sketchId:id,distance:5});session.undo();expect(session.state.document.roots).toHaveLength(0);expect(session.state.document.sketches![id]).toBeDefined();
 });
 it('cancels stale prompts when a GUI edit commits',async()=>{
  const {session,terminal}=fixture();await terminal.submit('box 10,20,30');session.rename('GUI edit');
  expect(terminal.state.prompt).toBeUndefined();expect(terminal.state.entries.some(entry=>entry.summary.includes('model changed'))).toBe(true);expect(session.state.document.roots).toHaveLength(0);
 });
 it('cancels a pending transform when the highlighted selection changes',async()=>{
  const {session,terminal}=fixture();const a=session.add({kind:'box',size:[1,2,3]}),b=session.add({kind:'box',size:[1,2,3]});session.select([a]);const revision=session.state.revision;
  await terminal.submit('move 0,0,0');session.select([b]);expect(terminal.state.prompt).toBeUndefined();
  expect(terminal.state.entries.at(-1)?.summary).toContain('selection changed');expect(session.state.revision).toBe(revision);expect(session.state.document.nodes[a].transform.position).toEqual([0,0,0]);
 });
 it('captures GUI edits as replayable canonical commands and reuses the shared Undo',async()=>{
  const {session,terminal}=fixture();const id=session.add({kind:'box',size:[10,20,30]});const original=session.serialize();
  const replay=terminal.state.entries.find(entry=>entry.kind==='action')!.text!;
  expect(replay.startsWith('apply ')).toBe(true);session.undo();await terminal.submit(replay);expect(session.serialize()).toBe(original);
  expect(session.state.selection).toEqual([id]);expect(session.history.past).toHaveLength(1);
  const revision=session.state.revision;await terminal.submit(replay);expect(session.state.revision).toBe(revision);expect(terminal.state.entries.at(-1)?.kind).toBe('error');
 });
 it('resolves quoted selection names and control aliases',async()=>{
  const {session,terminal,executeEditorCommand}=fixture();const id=session.add({kind:'box',size:[1,2,3]},{name:'My test object'});session.select([]);
  await terminal.submit('sel "My test object"');expect(session.state.selection).toEqual([id]);
  await terminal.submit('select none');expect(session.state.selection).toEqual([]);
  await terminal.submit('U');expect(executeEditorCommand).toHaveBeenLastCalledWith('undo');expect(session.state.document.roots).toHaveLength(0);
 });
 it('retains history independently of model history and isolates projects',async()=>{
  const values=new Map<string,string>(),storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);}};
  const {session,terminal}=fixture(storage);await terminal.submit('box 10,10,10 0,0,5');await terminal.submit('list');
  expect(session.history.past).toHaveLength(1);const same=createTerminalController(session,{executeEditorCommand:()=>{},openCodeWorkspace:()=>{},storage});expect(same.state.history).toEqual(['box 10,10,10 0,0,5','list']);
  session.load(createCadSession().state.document);expect(terminal.state.history).toEqual([]);same.dispose();terminal.dispose();
 });
 it('repeats the last complete command with empty Enter',async()=>{
  const {session,terminal}=fixture();await terminal.submit('box 1,2,3 0,0,1.5');await terminal.submit('');expect(session.state.document.roots).toHaveLength(2);
  expect(terminal.state.history).toEqual(['box 1,2,3 0,0,1.5']);
 });
 it('does not execute completion or a command with extra arguments',async()=>{
  const {session,terminal,executeEditorCommand,openCodeWorkspace}=fixture();expect(completeTerminalCommand('cyl')).toEqual(['cylinder']);expect(completeTerminalCommand('u')).toContain('undo');
  await terminal.submit('undo unexpected');expect(executeEditorCommand).not.toHaveBeenCalled();expect(session.state.revision).toBe(0);
  await terminal.submit('script');expect(openCodeWorkspace).toHaveBeenCalledOnce();
 });
});
