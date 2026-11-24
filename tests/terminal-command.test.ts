// SPDX-License-Identifier: BSD-3-Clause
import {expect,it} from 'vitest';
import {createCadSession,recordCadEdit} from '@brickwright/cad-core';
import {parseTerminalBox,parseTerminalPoint,resolveTerminalCommand,terminalCompletions} from '../packages/editor/src/terminal-command.js';

it('resolves aliases and completes canonical command names',()=>{
  expect(resolveTerminalCommand('M')?.name).toBe('move');
  expect(resolveTerminalCommand('source')?.command).toBe('model-source');
  expect(resolveTerminalCommand('move-tool')?.command).toBe('move');
  expect(terminalCompletions('und')).toContain('undo');
  expect(resolveTerminalCommand('missing')).toBeUndefined();
});
it('parses absolute, relative and polar world coordinates and rejects nondecimal input',()=>{
  expect(parseTerminalPoint('12, 5',[1,2,3])).toEqual([12,5,3]);
  expect(parseTerminalPoint('@2,-5,4',[1,2,3])).toEqual([3,-3,7]);
  const polar=parseTerminalPoint('@10<90',[1,2,3]);expect(polar[0]).toBeCloseTo(1);expect(polar[1]).toBeCloseTo(12);expect(polar[2]).toBe(3);
  expect(parseTerminalBox('20,30,4')).toEqual([20,30,4]);
  for(const input of ['','Infinity,2','0x10,2','1,2,3,4','@-3<90','1e999,2'])expect(()=>parseTerminalPoint(input,[0,0,0])).toThrow();
  expect(()=>parseTerminalBox('0,1,2')).toThrow();
});
it('records actual commits, selections, undo, redo and project loads; no-op edits emit no commit',()=>{
  const session=createCadSession(),events:string[]=[];
  session.subscribe((_state,change)=>events.push(change));
  const id=session.add({kind:'box',size:[10,20,30]});
  session.select([]);session.select([id]);session.rename(session.state.document.title);
  session.undo();session.redo();session.load(session.state.document);
  expect(events).toEqual(['commit','selection','selection','undo','redo','load']);
});
it('replays retained graph edits with identical IDs and one undo, and rejects conflicting or invalid changes',()=>{
  const session=createCadSession(),initial=session.state.document;
  const id=session.add({kind:'box',size:[10,20,30]});
  const added=session.state.document;
  const line=JSON.stringify(recordCadEdit(initial,added,session.state.label,session.state.selection));
  session.undo();expect(session.state.document).toEqual(initial);
  expect(session.applyRecordedEdit(JSON.parse(line))).toBe(true);
  expect(session.state.document).toEqual(added);expect(session.state.selection).toEqual([id]);
  const revision=session.state.revision;
  expect(()=>session.applyRecordedEdit(JSON.parse(line))).toThrow(/conflicts/);
  expect(session.state.revision).toBe(revision);
  session.undo();expect(session.state.document).toEqual(initial);
  const unsafe=JSON.parse(line);unsafe.header.push(['__proto__',[],[{}]]);
  expect(()=>session.applyRecordedEdit(unsafe)).toThrow();
  const invalid=JSON.parse(line);invalid.nodes[0][2][0].size=[-1,2,3];
  expect(()=>session.applyRecordedEdit(invalid)).toThrow();
  expect(session.state.document).toEqual(initial);
});
it('records deletion and optional-field changes and rejects a different project',()=>{
  const session=createCadSession();
  const id=session.add({kind:'box',size:[10,20,30]}),before=session.state.document;
  session.setRole('hole');const hole=session.state.document;
  const role=JSON.parse(JSON.stringify(recordCadEdit(before,hole,'Change role',[id])));
  session.remove();const deletion=recordCadEdit(hole,session.state.document,'Delete',[]);
  session.undo();session.undo();
  session.applyRecordedEdit(role);expect(session.state.document).toEqual(hole);
  session.applyRecordedEdit(JSON.parse(JSON.stringify(deletion)));expect(session.state.document.roots).toEqual([]);
  expect(()=>createCadSession().applyRecordedEdit(role)).toThrow(/different project/);
});
