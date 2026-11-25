// SPDX-License-Identifier: BSD-3-Clause
import {describe,expect,it,vi} from 'vitest';
import {COMMAND_SCRIPT_LABEL,createCadSession,createCommandJournal,createCommandRunner,createDocument,runCommandScript,serializeDocument} from '@brickwright/cad-core';
import type {SessionCommandRecord} from '@brickwright/cad-core';
import {createTerminalController} from '../packages/editor/src/terminal-controller.js';

function terminalFixture(){
 const session=createCadSession(createDocument('Scripts')),executeEditorCommand=vi.fn((command:string)=>{if(command==='undo')session.undo();else if(command==='redo')session.redo();});
 const store=new Map<string,string>(),storage={getItem:(key:string)=>store.get(key)??null,setItem:(key:string,value:string)=>{store.set(key,value);}};
 const terminal=createTerminalController(session,{executeEditorCommand,openCodeWorkspace:vi.fn(),storage});
 return {session,terminal,executeEditorCommand};
}
const errors=(terminal:ReturnType<typeof terminalFixture>['terminal'])=>terminal.state.entries.filter(entry=>entry.kind==='error').map(entry=>entry.summary);

describe('atomic command scripts',()=>{
 it('commits every line as one history step with one replayable record',async()=>{
  const initial=createDocument('Atomic'),session=createCadSession(initial),records:SessionCommandRecord[]=[];
  session.subscribeCommands(record=>records.push(record));
  const done=await runCommandScript(session,'// plate\nbox 40,30,10 0,0,5\n\nsphere 5 30,0,5\nselect "Box"\nmove 0,0,0 @10,0,0');
  expect(done.edited).toBe(true);expect(done.results.map(r=>r.command)).toEqual(['box','sphere','select','move']);
  expect(done.invocation).toMatch(/^box 40,30,10 0,0,5; sphere 5 30,0,5; select [\w-]+; move 0,0,0 10,0,0$/);
  expect(session.history.past).toEqual([COMMAND_SCRIPT_LABEL]);expect(session.state.label).toBe(COMMAND_SCRIPT_LABEL);expect(session.state.revision).toBe(1);
  expect(records).toHaveLength(1);expect(records[0].command.kind).toBe('apply');
  const box=session.state.document.roots.find(id=>session.state.document.nodes[id].name==='Box')!;
  expect(session.state.document.nodes[box].transform.position).toEqual([10,0,5]);expect(session.state.selection).toEqual([box]);
  // Undo removes the whole script; the record replays it as one step.
  const after=serializeDocument(session.state.document);
  session.undo();expect(session.state.document.roots).toEqual([]);
  expect(session.executeCommand(records[0].text)).toBe(true);
  expect(serializeDocument(session.state.document)).toBe(after);expect(session.history.past).toEqual([COMMAND_SCRIPT_LABEL]);
  // A fresh copy of the project replays the record as well.
  const copy=createCadSession(initial);createCommandRunner(copy).run(records[0].text);
  expect(serializeDocument(copy.state.document)).toBe(after);expect(copy.history.past).toHaveLength(1);
 });
 it('changes nothing when a line fails, and names the line',async()=>{
  const session=createCadSession();session.add({kind:'box',size:[1,1,1]});
  const saved=session.serialize(),revision=session.state.revision;
  await expect(runCommandScript(session,'box 10,10,10\n\n// next\nfrobnicate 1')).rejects.toThrow(/^Line 4: Unknown command: frobnicate/);
  // Scripts never prompt: missing arguments fail instead of waiting.
  await expect(runCommandScript(session,'sphere 4\ncylinder 3')).rejects.toThrow(/^Line 2: Missing arguments/);
  await expect(runCommandScript(session,'box 1,1,1\nfit')).rejects.toThrow('Line 2: fit needs the interactive editor.');
  await expect(runCommandScript(session,'box 1,1,1\nbox ${globalThis.process.exit()}')).rejects.toThrow(/^Line 2: /);
  await expect(runCommandScript(session,'// only a comment\n')).rejects.toThrow('Enter a command.');
  expect(session.serialize()).toBe(saved);expect(session.state.revision).toBe(revision);expect(session.history.past).toHaveLength(1);
 });
 it('starts from the current selection and reports selection-only scripts as unedited',async()=>{
  const session=createCadSession(),id=session.add({kind:'box',size:[2,2,2]});
  session.select([id]);
  await runCommandScript(session,'move 0,0,0 5,0,0\nrotate 0,0,90');
  expect(session.state.document.nodes[id].transform).toMatchObject({position:[5,0,0],rotation:[0,0,90]});expect(session.history.past).toHaveLength(2);
  const done=await runCommandScript(session,'select none\nlist');
  expect(done.edited).toBe(false);expect(done.results[1].output).toContain(id);expect(session.state.selection).toEqual([]);expect(session.history.past).toHaveLength(2);
 });
 it('refuses to commit when the model changed during the run',async()=>{
  const session=createCadSession();let release!:()=>void;
  const exact={run:async()=>{await new Promise<void>(resolve=>{release=resolve;});return {operation:'measure' as const,kernel:{id:'smlib',package:'@crispcad/exact-kernel',version:'0.1.0'},bodies:[]};}};
  const running=runCommandScript(session,'box 1,1,1\nmeasure exact all',{exact:exact as never});
  await vi.waitFor(()=>expect(release).toBeDefined());
  session.add({kind:'sphere',radius:1,segments:16});release();
  await expect(running).rejects.toThrow('The model changed while the script was running');
  expect(session.state.document.roots).toHaveLength(1);
 });
 it('keeps the model source in step when it is live',async()=>{
  const session=createCadSession();session.enableModelSource();
  await runCommandScript(session,'box 3,3,3\ncylinder 1 4 10,0,2');
  expect(session.state.document.roots).toHaveLength(2);expect(session.modelSource).toContain('cylinder');expect(session.history.past).toHaveLength(1);
 });
});

describe('terminal scripts',()=>{
 it('runs a multi-line submission as one Undo step with one action row',async()=>{
  const {session,terminal}=terminalFixture();
  await terminal.submit('box 10,10,10\ncircle 0,0 5\nextrude Circle 3');
  expect(errors(terminal)).toEqual([]);expect(session.history.past).toHaveLength(1);expect(session.state.document.roots).toHaveLength(2);
  expect(terminal.state.entries.filter(entry=>entry.kind==='action').map(entry=>entry.summary)).toEqual([COMMAND_SCRIPT_LABEL]);
  expect(terminal.state.entries.at(-1)?.summary).toBe('Script: 3 commands, committed as one Undo step.');
  // Scripts are not added to the single-line input history.
  expect(terminal.state.history).toEqual([]);
  await terminal.submit('undo');expect(session.state.document.roots).toEqual([]);
  expect(session.state.document.sketches??{}).toEqual({});
 });
 it('reports the failing line and leaves the model unchanged',async()=>{
  const {session,terminal}=terminalFixture();
  await terminal.submit('box 10,10,10\nextrude Missing 5');
  expect(errors(terminal)).toEqual(['Line 2: Choose one closed sketch by ID or unique name. The script changed nothing.']);
  expect(session.state.revision).toBe(0);
  // Interactive single-line commands keep prompting.
  await terminal.submit('box');expect(terminal.state.prompt?.command).toBe('box');
  await terminal.submit('a\nb');expect(errors(terminal).at(-1)).toBe('Finish or cancel the current command before running a script.');
  terminal.cancel();
 });
 it('expands custom aliases on each line and repeats the last script or command',async()=>{
  const {session,terminal}=terminalFixture();
  await terminal.submit('alias cube box');
  await terminal.submit('cube 1,1,1\n  cube 2,2,2');
  expect(session.state.document.roots).toHaveLength(2);expect(session.history.past).toHaveLength(1);
  await terminal.submit('');expect(session.state.document.roots).toHaveLength(4);expect(session.history.past).toHaveLength(2);
  await terminal.submit('repeat');expect(session.state.document.roots).toHaveLength(6);expect(session.history.past).toHaveLength(3);
  await terminal.submit('sphere 2 0,0,0');await terminal.submit('repeat');
  expect(session.state.document.roots).toHaveLength(8);expect(terminal.state.history.at(-1)).toBe('sphere 2 0,0,0');expect(terminal.state.history).not.toContain('repeat');
  await terminal.submit('repeat now');expect(errors(terminal).at(-1)).toBe('Too many arguments. Use help for command syntax.');
  terminal.dispose();
 });
 it('says when there is nothing to repeat',async()=>{
  const {terminal}=terminalFixture();
  await terminal.submit('repeat');expect(errors(terminal)).toEqual(['Nothing to repeat.']);
 });
 it('records the script as one journal entry whose replay text reproduces it',async()=>{
  const {session,terminal}=terminalFixture();const initial=session.state.document;
  await terminal.submit('rect 0,0 20,10\nextrude Rectangle 4\nbox 5,5,5 30,0,2.5');
  const exported=terminal.exportJournal();
  expect(exported).toContain('// from: rectangle 0,0 20,10; extrude ');
  expect(exported).toContain('return extrudeProfile(4, rectangle2d(20, 10));');
  const copy=createCadSession(initial);createCommandRunner(copy).runScript(terminal.exportJournal('replay'));
  expect(serializeDocument(copy.state.document)).toBe(serializeDocument(session.state.document));expect(copy.history.past).toHaveLength(1);
  const journal=createCommandJournal(copy);expect(journal.entries).toEqual([]);journal.dispose();
 });
});
