// SPDX-License-Identifier: BSD-3-Clause
import {describe,expect,it,vi} from 'vitest';
import {createCadSession} from '../packages/core/src/index.js';
import {parseTerminalPoint,terminalArguments,terminalTokens} from '../packages/editor/src/terminal-coordinates.js';
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
 it('retains empty arguments, quote metadata and escaped object names',()=>{
  expect(terminalArguments('"" "all"')).toEqual(['','all']);
  expect(terminalTokens('all "all"')).toEqual([{value:'all',start:0,end:3,quoted:false},{value:'all',start:4,end:9,quoted:true}]);
  expect(terminalArguments(String.raw`"A \"quoted\" \\ path"`)).toEqual(['A "quoted" \\ path']);
  expect(terminalTokens('select "unfin',true).at(-1)).toMatchObject({value:'unfin',quoted:true});
  expect(()=>terminalTokens('select "unfin')).toThrow();
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
 it('treats quoted selection keywords as names and rejects empty quoted arguments',async()=>{
  const {session,terminal}=fixture();const all=session.add({kind:'box',size:[1,2,3]},{name:'all'}),none=session.add({kind:'sphere',radius:2,segments:16},{name:'none'});
  await terminal.submit('select "all"');expect(session.state.selection).toEqual([all]);
  await terminal.submit("sel 'none'");expect(session.state.selection).toEqual([none]);
  await terminal.submit('select ALL');expect(session.state.selection).toEqual([all,none]);
  await terminal.submit('select ""');expect(terminal.state.entries.at(-1)?.kind).toBe('error');expect(session.state.selection).toEqual([all,none]);
  terminal.cancel();await terminal.submit('help move unexpected');expect(terminal.state.entries.at(-1)?.kind).toBe('error');
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

describe('terminal argument completion',()=>{
 it('completes command aliases and help arguments without invoking an action',()=>{
  const {session,terminal,executeEditorCommand}=fixture();
  expect(terminal.complete('CYL').map(item=>item.text)).toEqual(['cylinder ']);
  expect(terminal.complete('help cy').map(item=>item.text)).toEqual(['help cylinder ']);
  expect(terminal.complete('? re').map(item=>item.text)).toContain('? rectangle ');
  expect(terminal.complete('help box ')).toEqual([]);expect(terminal.complete('box ')).toEqual([]);
  expect(executeEditorCommand).not.toHaveBeenCalled();expect(session.state.revision).toBe(0);expect(terminal.state.history).toEqual([]);
 });
 it('offers stable IDs and unique quoted names for select, including aliases',async()=>{
  const {session,terminal}=fixture();const id=session.add({kind:'box',size:[1,2,3]},{name:'Motor plate'});session.select([]);
  const before=session.state.revision,completion=terminal.complete('SEL mo');
  expect(completion).toEqual([{text:'SEL "Motor plate" ',caret:18,label:'Motor plate',description:id}]);
  expect(terminal.complete('select '+id.slice(0,6)).some(item=>item.text==='select '+id+' ')).toBe(true);
  expect(terminal.state.history).toEqual([]);expect(session.state.selection).toEqual([]);expect(session.state.revision).toBe(before);
  await terminal.submit(completion[0].text);expect(session.state.selection).toEqual([id]);expect(session.state.revision).toBe(before);
 });
 it('keeps earlier selected arguments and does not suggest an already chosen body',async()=>{
  const {session,terminal}=fixture();const a=session.add({kind:'box',size:[1,2,3]},{name:'First body'}),b=session.add({kind:'sphere',radius:2,segments:16},{name:'Second body'});
  const text='select "First body" se',completion=terminal.complete(text);
  expect(completion.map(item=>item.text)).toEqual(['select "First body" "Second body" ']);
  expect(terminal.complete('select '+a+' ').some(item=>item.label==='First body'||item.label===a)).toBe(false);
  await terminal.submit(completion[0].text);expect(session.state.selection).toEqual([a,b]);
  expect(terminal.complete('select all ')).toEqual([]);
 });
 it('offers only stable IDs when object names are ambiguous',async()=>{
  const {session,terminal}=fixture();const a=session.add({kind:'box',size:[1,2,3]},{name:'Plate'}),b=session.add({kind:'box',size:[1,2,3]});session.update(b,{name:'Plate'});
  expect(terminal.complete('select Pl')).toEqual([]);
  const ids=terminal.complete('select ').filter(item=>[a,b].includes(item.label));expect(ids).toHaveLength(2);expect(ids.every(item=>item.description==='Plate')).toBe(true);
 });
 it('quotes names containing quotes, backslashes and reserved keywords for exact selection',async()=>{
  const {session,terminal}=fixture();const name='A "quoted" \\ part',id=session.add({kind:'box',size:[1,2,3]},{name});
  const completion=terminal.complete('select "A ');expect(completion).toHaveLength(1);
  await terminal.submit(completion[0].text);expect(session.state.selection).toEqual([id]);
  const reserved=session.add({kind:'box',size:[1,2,3]},{name:'all'}),matches=terminal.complete('select al');
  expect(matches.map(item=>item.text)).toContain('select all ');expect(matches.map(item=>item.text)).toContain('select "all" ');
  expect(terminal.complete('select "al').map(item=>item.text)).toEqual(['select "all" ']);
  await terminal.submit('select "all"');expect(session.state.selection).toEqual([reserved]);
 });
 it('completes closed sketch names and IDs while excluding open paths and duplicate names',()=>{
  const {session,terminal}=fixture();const plate=session.addSketch({kind:'rectangle',id:'plate-profile',width:10,depth:20},{name:'Base plate'}),path=session.addSketch({kind:'path',id:'open-profile',points:[[0,0],[10,0]]},{name:'Open guide'});
  const duplicate=session.addSketch({kind:'rectangle',id:'duplicate-profile',width:10,depth:20},{name:'Duplicate'});session.addSketch({kind:'path',id:'other-profile',points:[[0,0],[10,0]]},{name:'Duplicate'});
  expect(terminal.complete('ex ba').map(item=>item.text)).toEqual(['ex "Base plate" ']);
  expect(terminal.complete('extrude '+plate.slice(0,6)).some(item=>item.label===plate)).toBe(true);
  const labels=terminal.complete('extrude ').map(item=>item.label);expect(labels).not.toContain(path);expect(labels).not.toContain('Open guide');expect(labels).not.toContain('Duplicate');expect(labels).toContain(duplicate);
  expect(terminal.complete('extrude "Base plate" ')).toEqual([]);
 });
 it('preserves later arguments when completing a token under the caret',async()=>{
  const {session,terminal}=fixture();const id=session.addSketch({kind:'rectangle',id:'plate-profile',width:10,depth:20},{name:'Base plate'});
  const completion=terminal.complete('ex "Ba" 7',6);expect(completion[0].text).toBe('ex "Base plate" 7');
  await terminal.submit(completion[0].text);expect(session.state.document.nodes[session.state.document.roots[0]]).toMatchObject({kind:'extrusion',sketchId:id,distance:7});
 });
 it('keeps IDs unambiguous when another sketch is named after an ID',async()=>{
  const {session,terminal}=fixture();const id=session.addSketch({kind:'rectangle',id:'first-profile',width:10,depth:20},{name:'First'});
  session.addSketch({kind:'rectangle',id:'second-profile',width:20,depth:30},{name:id});
  const completion=terminal.complete('ex '+id)[0];expect(completion.text).toBe('ex '+id+' ');await terminal.submit(completion.text+'6');
  expect(session.state.document.nodes[session.state.document.roots[0]]).toMatchObject({kind:'extrusion',sketchId:id,distance:6});
 });
 it('uses the same entity completion during interactive prompts',async()=>{
  const {session,terminal}=fixture();const body=session.add({kind:'box',size:[1,2,3]},{name:'Bracket'}),sketch=session.addSketch({kind:'rectangle',id:'plate-profile',width:10,depth:20},{name:'Base plate'});
  await terminal.submit('select');expect(terminal.complete('Br')[0].text).toBe('"Bracket" ');await terminal.submit(terminal.complete('Br')[0].text);expect(session.state.selection).toEqual([body]);
  await terminal.submit('extrude');const choices=terminal.complete('Ba');expect(choices[0].text).toBe('"Base plate" ');await terminal.submit(choices[0].text);
  expect(terminal.complete('')).toEqual([]);await terminal.submit('3');expect(session.state.document.nodes[session.state.document.roots.at(-1)!]).toMatchObject({kind:'extrusion',sketchId:sketch,distance:3});
  await terminal.submit('line');expect(terminal.complete('')).toEqual([]);terminal.cancel();
 });
 it('round-trips sketch names that begin with a quotation mark',async()=>{
  const {session,terminal}=fixture();const id=session.addSketch({kind:'rectangle',id:'plate-profile',width:10,depth:20},{name:'"Quoted" profile'});
  const choice=terminal.complete('ex "\\"Qu')[0];expect(choice).toBeDefined();await terminal.submit(choice.text+'4');
  expect(session.state.document.nodes[session.state.document.roots[0]]).toMatchObject({kind:'extrusion',sketchId:id,distance:4});
 });
 it('refreshes targets after model changes and never completes replay payloads',()=>{
  const {session,terminal}=fixture();const id=session.add({kind:'box',size:[1,2,3]},{name:'Temporary'});expect(terminal.complete('select Temp')).toHaveLength(1);session.remove([id]);expect(terminal.complete('select Temp')).toEqual([]);
  expect(terminal.complete('apply {')).toEqual([]);expect(terminal.complete('select ["')).toEqual([]);
  terminal.dispose();expect(terminal.complete('bo')).toEqual([]);
 });
});
