// SPDX-License-Identifier: BSD-3-Clause
import {describe,expect,it,vi} from 'vitest';
import {createCadSession} from '../packages/core/src/index.js';
import type {SessionCommandRecord} from '../packages/core/src/index.js';
import {createTerminalController} from '../packages/editor/src/terminal-controller.js';
import type {TerminalStorage} from '../packages/editor/src/terminal-controller.js';

const aliasesKey='brickwright-cad:terminal-aliases:v1';
function memory(){
 const values=new Map<string,string>();
 const storage:TerminalStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>{values.set(key,value);}};
 return {values,storage};
}
function fixture(storage?:TerminalStorage){
 const session=createCadSession(),openCodeWorkspace=vi.fn();
 const executeEditorCommand=vi.fn((command:string)=>{if(command==='undo')session.undo();else if(command==='redo')session.redo();});
 const terminal=createTerminalController(session,{executeEditorCommand,openCodeWorkspace,storage});
 const output=()=>terminal.state.entries.at(-1)!;
 return {session,terminal,executeEditorCommand,openCodeWorkspace,output};
}

describe('custom CAD terminal aliases',()=>{
 it('teaches list, query, set and removal without editing the model or its history',async()=>{
  const {session,terminal,output}=fixture();
  await terminal.submit('alias');expect(output().summary).toContain('Use alias <name> <command>');
  await terminal.submit('alias Plate BOX');expect(output().summary).toBe('plate → box');
  await terminal.submit('alias MoveBody move');await terminal.submit('alias');expect(output().summary).toBe('movebody → move\nplate → box');
  await terminal.submit('alias PLATE');expect(output().summary).toBe('plate → box');
  await terminal.submit('help plate');expect(output().summary).toContain('box [width,depth,height] [center]');expect(output().summary).toContain('b, plate');
  await terminal.submit('unalias PLATE');expect(output().summary).toContain('Alias removed.');
  await terminal.submit('plate');expect(output().kind).toBe('error');expect(output().summary).toContain('Unknown command');
  expect(session.state.revision).toBe(0);expect(session.history.past).toHaveLength(0);expect(terminal.state.prompt).toBeUndefined();
 });
 it('resolves built-in and custom alias targets once, then dispatches the canonical operation',async()=>{
  const {session,terminal}=fixture();
  await terminal.submit('alias Solid B');await terminal.submit('alias Plate SOLID');await terminal.submit('alias solid sphere');await terminal.submit('unalias solid');
  await terminal.submit('PLATE 20,30,10 0,0,5');
  const body=session.state.document.nodes[session.state.document.roots[0]];
  expect(body).toMatchObject({kind:'box',size:[20,30,10]});
  expect(body.transform.position).toEqual([0,0,5]);expect(session.history.past).toHaveLength(1);
  expect(terminal.state.entries.filter(entry=>entry.kind==='action')).toHaveLength(1);
  expect(terminal.state.entries.find(entry=>entry.kind==='action')?.text).toMatch(/^apply /);
 });
 it('keeps the canonical prompted lifecycle and invalid-input recovery',async()=>{
  const {session,terminal}=fixture();await terminal.submit('alias block box');await terminal.submit('BLOCK');
  expect(terminal.state.prompt?.command).toBe('box');expect(session.state.revision).toBe(0);
  await terminal.submit('bad');expect(terminal.state.prompt?.message).toContain('Box dimensions');
  await terminal.submit('10,20,30');expect(terminal.state.prompt?.point).toBe(true);await terminal.submit('');
  expect(session.state.document.roots).toHaveLength(1);expect(session.history.past).toHaveLength(1);
 });
 it('routes aliases for editor commands and code to the existing bridge',async()=>{
  const {terminal,executeEditorCommand,openCodeWorkspace}=fixture();
  await terminal.submit('alias backstep u');await terminal.submit('alias workspace script');
  await terminal.submit('BACKSTEP');await terminal.submit('workspace');
  expect(executeEditorCommand).toHaveBeenCalledExactlyOnceWith('undo');expect(openCodeWorkspace).toHaveBeenCalledOnce();
 });
 it.each(['box','B','undo','u','alias','unalias','code','script','fit','zoom'])('preserves the built-in name or fixed alias %s',async name=>{
  const {session,terminal,output}=fixture();await terminal.submit(`alias ${name} sphere`);
  expect(output()).toMatchObject({kind:'error',summary:'Built-in commands and fixed aliases cannot be changed.'});
  await terminal.submit(`unalias ${name}`);expect(output().kind).toBe('error');expect(session.state.revision).toBe(0);
 });
 it.each(['','1bad','has space','a'.repeat(33),'__proto__','x;undo','Å'])('rejects invalid alias name %j',async name=>{
  const {terminal,output,session}=fixture();await terminal.submit(`alias ${JSON.stringify(name)} box`);
  expect(output().kind).toBe('error');expect(output().summary).toContain('Alias names must');expect(session.state.revision).toBe(0);
 });
 it('accepts bounded simple names and refuses expansions, unknown targets and extra arguments',async()=>{
  const {terminal,output,session}=fixture();await terminal.submit('alias my-box_2 box');expect(output().summary).toBe('my-box_2 → box');
  for(const text of ['alias nope missing','alias nope "box 1,2,3"','alias nope "box;undo"','alias nope box extra','unalias','unalias my-box_2 extra','alias unknown','unalias unknown']){
   await terminal.submit(text);expect(output().kind,text).toBe('error');expect(terminal.state.prompt).toBeUndefined();
  }
  expect(session.state.revision).toBe(0);await terminal.submit('alias my-box_2');expect(output().summary).toBe('my-box_2 → box');
 });
 it('bounds the collection and permits updating or removing an existing alias at capacity',async()=>{
  const {terminal,output,session}=fixture();for(let i=0;i<64;i++)await terminal.submit(`alias shortcut${i} box`);
  await terminal.submit('alias overflow box');expect(output().summary).toBe('At most 64 custom aliases can be saved.');
  await terminal.submit('alias shortcut0 sphere');expect(output().summary).toBe('shortcut0 → sphere');
  await terminal.submit('unalias shortcut1');await terminal.submit('alias replacement cylinder');expect(output().summary).toBe('replacement → cylinder');
  expect(session.state.revision).toBe(0);
 });
 it('completes custom command aliases, alias management and help without executing',async()=>{
  const {terminal,session}=fixture();await terminal.submit('alias block box');await terminal.submit('alias pick select');
  expect(terminal.complete('BLO').map(item=>item.text)).toEqual(['box ']);
  expect(terminal.complete('help blo').map(item=>item.text)).toEqual(['help box ']);
  expect(terminal.complete('alias bl').map(item=>item.text)).toEqual(['alias block ']);
  expect(terminal.complete('unalias bl').map(item=>item.text)).toEqual(['unalias block ']);
  expect(terminal.complete('alias new blo').map(item=>item.text)).toEqual(['alias new box ']);
  expect(terminal.complete('alias new se').map(item=>item.text)).toContain('alias new select ');
  expect(terminal.complete('unalias block ')).toEqual([]);expect(terminal.complete('alias new box ')).toEqual([]);
  expect(session.state.revision).toBe(0);
 });
 it('uses target-aware entity completion through custom aliases, including prompts',async()=>{
  const {session,terminal}=fixture();const body=session.add({kind:'box',size:[1,2,3]},{name:'Motor plate'});
  const sketch=session.addSketch({id:'plate-profile',kind:'rectangle',width:20,depth:30},{name:'Base plate'});
  await terminal.submit('alias pick select');await terminal.submit('alias raise extrude');
  expect(terminal.complete('pick mo').map(item=>item.text)).toEqual(['pick "Motor plate" ']);
  await terminal.submit('pick');expect(terminal.complete('mo')[0].text).toBe('"Motor plate" ');await terminal.submit('"Motor plate"');expect(session.state.selection).toEqual([body]);
  const choice=terminal.complete('raise "Ba" 5',9)[0];expect(choice.text).toBe('raise "Base plate" 5');await terminal.submit(choice.text);
  expect(session.state.document.nodes[session.state.document.roots.at(-1)!]).toMatchObject({kind:'extrusion',sketchId:sketch,distance:5});
 });
 it('does not persist replay payloads through a custom apply alias',async()=>{
  const {storage,values}=memory(),{session,terminal}=fixture(storage),records:SessionCommandRecord[]=[];
  session.subscribeCommands(record=>records.push(record));session.add({kind:'box',size:[1,2,3]});const command=records[0].text;session.undo();
  await terminal.submit('alias replay apply');const text='replay '+command.slice('apply '.length);await terminal.submit(text);
  expect(session.state.document.roots).toHaveLength(1);expect(terminal.state.history).not.toContain(text);
  const saved=values.get(`brickwright-cad:terminal-history:v1:${session.state.document.id}`)!;expect(saved).not.toContain('"changes"');
 });
});

describe('terminal alias preferences',()=>{
 it('restores one device-wide set across projects without adding model history',async()=>{
  const {storage,values}=memory(),first=fixture(storage);await first.terminal.submit('alias draw rect');
  first.session.load(createCadSession().state.document);const revision=first.session.state.revision;
  await first.terminal.submit('alias draw');expect(first.output().summary).toBe('draw → rectangle');
  expect(first.session.state.revision).toBe(revision);expect(first.session.history.past).toHaveLength(0);first.terminal.dispose();
  const second=fixture(storage);await second.terminal.submit('draw 0,0 20,30');
  expect(Object.values(second.session.state.document.sketches??{})).toHaveLength(1);expect(second.session.history.past).toHaveLength(1);
  expect(JSON.parse(values.get(aliasesKey)!)).toEqual({version:1,aliases:[{name:'draw',command:'rectangle'}]});
 });
 it.each(['broken','[]','null','{"version":2,"aliases":[]}','{"version":1,"aliases":{}}','x'.repeat(16385)])('ignores unreadable or unsupported storage %j',async raw=>{
  const {storage,values}=memory();values.set(aliasesKey,raw);const {terminal,output}=fixture(storage);
  await terminal.submit('alias');expect(output().summary).toContain('No custom aliases.');await terminal.submit('alias safe box');expect(output().summary).toBe('safe → box');
 });
 it('filters corrupt entries without allowing saved aliases to shadow built-ins',async()=>{
  const {storage,values}=memory();values.set(aliasesKey,JSON.stringify({version:1,aliases:[
   {name:'BLOCK',command:'box'},{name:'block',command:'sphere'},{name:'b',command:'sphere'},
   {name:'__proto__',command:'box'},{name:'bad name',command:'box'},{name:'missing',command:'unknown'},
   {name:'chain',command:'block'},{name:'fixed',command:'b'},{name:'extra',command:'box',script:'anything'},
   null,[],{name:'constructor',command:'box'},
  ]}));
  const {terminal,output,session}=fixture(storage);await terminal.submit('alias');expect(output().summary).toBe('block → box\nconstructor → box');
  await terminal.submit('b 1,2,3 0,0,0');expect(session.state.document.roots).toHaveLength(1);
  expect(session.state.document.nodes[session.state.document.roots[0]]).toMatchObject({kind:'box'});
 });
 it('refuses an oversized stored collection',async()=>{
  const {storage,values}=memory();values.set(aliasesKey,JSON.stringify({version:1,aliases:Array.from({length:65},(_,i)=>({name:`shortcut${i}`,command:'box'}))}));
  const {terminal,output}=fixture(storage);await terminal.submit('alias');expect(output().summary).toContain('No custom aliases.');
 });
 it('keeps aliases usable when storage is denied and retries outstanding changes later',async()=>{
  const {storage:backing}=memory();let blocked=true;
  const storage:TerminalStorage={getItem:key=>{if(blocked)throw new Error('blocked');return backing.getItem(key);},setItem:(key,value)=>{if(blocked)throw new Error('blocked');backing.setItem(key,value);}};
  const {terminal,output,session}=fixture(storage);await terminal.submit('alias block box');expect(output().summary).toContain('could not be saved');
  await terminal.submit('block 1,2,3 0,0,0');expect(session.state.document.roots).toHaveLength(1);
  blocked=false;await terminal.submit('alias orb sphere');expect(output().summary).toBe('orb → sphere');
  const restored=fixture(storage);await restored.terminal.submit('alias');expect(restored.output().summary).toBe('block → box\norb → sphere');
 });
 it('merges unrelated alias edits from sequential editor instances and persists removals',async()=>{
  const {storage}=memory(),first=fixture(storage),second=fixture(storage);
  await first.terminal.submit('alias block box');await second.terminal.submit('alias orb sphere');await first.terminal.submit('alias tube cylinder');await second.terminal.submit('unalias block');
  const restored=fixture(storage);await restored.terminal.submit('alias');expect(restored.output().summary).toBe('orb → sphere\ntube → cylinder');
 });
 it('does not overwrite an unreadable alias collection and merges pending edits when access returns',async()=>{
  const {storage:backing,values}=memory();let blocked=false,aliasWrites=0;
  const storage:TerminalStorage={getItem:key=>{if(blocked&&key===aliasesKey)throw new Error('read unavailable');return backing.getItem(key);},setItem:(key,value)=>{if(key===aliasesKey)aliasWrites++;backing.setItem(key,value);}};
  const first=fixture(storage),second=fixture(backing);
  await first.terminal.submit('alias old box');await second.terminal.submit('alias orb sphere');
  const shared=values.get(aliasesKey),writes=aliasWrites;blocked=true;
  await first.terminal.submit('alias block box');expect(first.output().summary).toContain('could not be saved');
  await first.terminal.submit('unalias old');expect(first.output().summary).toContain('could not be saved');
  expect(values.get(aliasesKey)).toBe(shared);expect(aliasWrites).toBe(writes);
  expect(first.terminal.complete('blo').map(item=>item.text)).toEqual(['box ']);
  await first.terminal.submit('alias old');expect(first.output().kind).toBe('error');
  blocked=false;await first.terminal.submit('alias tube cylinder');expect(first.output().summary).toBe('tube → cylinder');
  const restored=fixture(backing);await restored.terminal.submit('alias');expect(restored.output().summary).toBe('block → box\norb → sphere\ntube → cylinder');
 });
});
