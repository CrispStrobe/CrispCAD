// SPDX-License-Identifier: BSD-3-Clause
import {beforeAll,describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {compileCode,createCadSession,createCommandJournal,createCommandRunner,createDocument,exportCommandJournal,portableJournalObjects,serializeDocument} from '@brickwright/cad-core';
import type {CadDocument} from '@brickwright/cad-core';
import {createGeometryKernel} from '@brickwright/cad-geometry';
import {createTerminalController} from '../packages/editor/src/terminal-controller.js';

let kernel:Awaited<ReturnType<typeof createGeometryKernel>>;
beforeAll(async()=>{kernel=await createGeometryKernel({wasmBinary:readFileSync('node_modules/manifold-3d/manifold.wasm')});});

function fixture(document?:CadDocument){
 const session=createCadSession(document),journal=createCommandJournal(session),runner=createCommandRunner(session,{journal});
 return {session,journal,runner};
}
const objectBlocks=(text:string)=>text.split('\n\n').filter(block=>block.includes('// @object'));
const replayBlocks=(text:string)=>text.split('\n\n').filter(block=>block.includes('// @replay'));

describe('command journal export',()=>{
 it('exports created primitives, folding their later transforms, as faithful CAD Script',()=>{
  const {session,journal,runner}=fixture();
  runner.runScript('box 40,30,10 0,0,5\nsphere 6 30,0,6\ncylinder 4 12 -20,5,6\nselect "Box"\nmove 0,0,0 @10,0,0\nrotate 15,0,30\nscale 1,2,1');
  const text=journal.export();
  expect(text.startsWith('// crispcad-journal 1 · cadscript\n// Data only. Never evaluate this text as JavaScript.')).toBe(true);
  expect(objectBlocks(text)).toHaveLength(3);expect(replayBlocks(text)).toHaveLength(0);
  expect(text).toContain('// from: box 40,30,10 0,0,5; move 0,0,0 10,0,0; rotate 15,0,30; scale 1,2,1');
  expect(text).toContain('return move([10, 0, 5], rotate([15, 0, 30], scale([1, 2, 1], box(40, 30, 10))));');
  // Each object program compiles and builds the same solid as the recorded body.
  const exported=portableJournalObjects(journal.entries);expect(exported.map(o=>o.id)).toEqual(session.state.document.roots);
  for(const object of exported){
   const document=session.state.document,original=kernel.evaluate({...document,nodes:{[object.id]:document.nodes[object.id]},roots:[object.id]});
   const code=createCadSession();code.addCode({version:1,language:'brickwright-cad-script',source:object.source,parameters:{}});
   expect(compileCode({version:1,language:'brickwright-cad-script',source:object.source,parameters:{}}).shape).toBeDefined();
   const rebuilt=kernel.evaluate(code.state.document);
   expect(rebuilt.volume).toBeCloseTo(original.volume,6);
   const flat=(bounds:{min:number[];max:number[]})=>[...bounds.min,...bounds.max];
   flat(rebuilt.bodies[0].bounds).forEach((value,i)=>expect(value).toBeCloseTo(flat(original.bodies[0].bounds)[i],5));
  }
 });
 it('keeps non-portable edits as marked canonical replay text and resolves undo/redo',()=>{
  const {session,journal,runner}=fixture();
  runner.runScript('box 10,10,10\nrect 0,0 20,30\nbox 5,5,5 30,0,2.5\nundo\nredo\nsphere 3\nundo');
  const text=journal.export();
  expect(objectBlocks(text)).toHaveLength(2);
  const replay=replayBlocks(text);expect(replay).toHaveLength(1);
  expect(replay[0]).toMatch(/^\/\/ @replay 2 non-portable: rectangle 0,0 20,30\n\/\/\| apply \{/);
  expect(text).toContain('undone edits are not included');expect(text).not.toContain('sphere(');
  // Every replay payload is commented out: the export is never executable source.
  for(const line of text.split('\n'))if(line.startsWith('//| '))expect(line.slice(4)).toMatch(/^(apply|select|undo|redo) /);
  expect(session.state.document.roots).toHaveLength(2);
 });
 it('makes bodies non-portable when a non-portable edit consumes or changes them',()=>{
  const {session,journal,runner}=fixture();
  runner.runScript('box 10,10,10\nbox 4,4,20\nsphere 2 50,0,0\nselect all\nunion');
  // The union consumed all three bodies, so their creations become replay too.
  expect(objectBlocks(journal.export())).toHaveLength(0);expect(replayBlocks(journal.export())).toHaveLength(4);
  runner.run('box 1,2,3');const id=session.state.document.roots.at(-1)!;session.update(id,{name:'Renamed',color:'#ff0000'});
  expect(journal.export()).toContain('// @object 1 "Renamed" color #ff0000');
  session.setRole('hole',[id]);
  expect(objectBlocks(journal.export())).toHaveLength(0);
 });
 it('treats GUI-recorded primitives like typed ones and keeps the GUI summary',()=>{
  const {session,journal}=fixture();const id=session.add({kind:'box',size:[2,3,4]},{name:'GUI box'});
  session.transform([{id,transform:{position:[1,2,3],rotation:[0,0,0],scale:[1,1,1]}}]);
  expect(journal.export()).toContain('// from: Add box; Transform selection\nreturn move([1, 2, 3], box(2, 3, 4));');
 });
 it('exports a replay stream that the headless runner reproduces on the recorded project',()=>{
  const initial=createDocument('Journal');const {session,journal,runner}=fixture(initial);
  runner.runScript('box 10,10,10\nrect 0,0 20,30\nselect all\nmove 0,0,0 1,2,3\nundo\nredo');
  const replay=journal.export('replay');expect(replay.split('\n')[0]).toBe('// crispcad-journal 1 · replay');
  const copy=createCadSession(initial);createCommandRunner(copy).runScript(replay);
  expect(serializeDocument(copy.state.document)).toBe(serializeDocument(session.state.document));
 });
 it('never changes the model, its history or saved data, and stays bounded',()=>{
  const {session,runner}=fixture(),journal=createCommandJournal(session,{entries:3});
  for(let i=0;i<5;i++)runner.run(`box ${i+1},1,1`);
  const saved=session.serialize(),revision=session.state.revision,past=session.history.past;
  expect(journal.entries).toHaveLength(3);expect(journal.dropped).toBe(2);
  expect(journal.export()).toContain('2 earlier entries exceeded the journal limit');
  expect(session.serialize()).toBe(saved);expect(session.state.revision).toBe(revision);expect(session.history.past).toEqual(past);
  expect(saved).not.toContain('crispcad-journal');
  session.load(createDocument('Other'));expect(journal.entries).toEqual([]);
  expect(exportCommandJournal([])).toContain('// No model edits recorded.');
 });
 it('is available as a terminal command without adding history',async()=>{
  const session=createCadSession(),terminal=createTerminalController(session,{executeEditorCommand:()=>{},openCodeWorkspace:()=>{}});
  await terminal.submit('box 10,20,30 0,0,15');await terminal.submit('select none');await terminal.submit('select all');await terminal.submit('m 0,0,0 @5,0,0');
  const revision=session.state.revision;
  await terminal.submit('journal');expect(terminal.state.entries.at(-1)?.summary).toMatch(/^4 journal entries · 1 portable objects/);
  await terminal.submit('journal export');
  const output=terminal.state.entries.at(-1)!;expect(output.kind).toBe('output');
  expect(output.summary).toContain('// from: box 10,20,30 0,0,15; move 0,0,0 5,0,0\nreturn move([5, 0, 15], box(10, 20, 30));');
  await terminal.submit('journal export replay');expect(terminal.state.entries.at(-1)?.summary).toContain('\nselect [');
  await terminal.submit('journal export json');expect(terminal.state.entries.at(-1)?.kind).toBe('error');
  expect(terminal.exportJournal()).toBe(output.summary);
  expect(session.state.revision).toBe(revision);expect(session.history.past).toHaveLength(2);
  terminal.dispose();
 });
});
