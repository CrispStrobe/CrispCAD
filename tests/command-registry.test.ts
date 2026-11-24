// SPDX-License-Identifier: BSD-3-Clause
import {describe,expect,it} from 'vitest';
import {commandRegistry,createCadSession,createCommandRunner,findCommandSpec,interactiveCommandNames,paletteCommandSpecs,prepareCommand,setLocale,t} from '@brickwright/cad-core';
import type {CadDocument,CadSession} from '@brickwright/cad-core';
import {createTerminalController,terminalCommands} from '../packages/editor/src/terminal-controller.js';
import {paletteCommands} from '../packages/editor/src/command-palette.js';

/** Model content without generated identities, for comparing two front ends. */
function shape(document:CadDocument){
 const ids=new Map<string,string>();let next=0;const alias=(id:string)=>{if(!ids.has(id))ids.set(id,'id'+next++);return ids.get(id)!;};
 const replace=(value:unknown):unknown=>typeof value==='string'&&(document.nodes[value]||document.sketches?.[value])?alias(value):Array.isArray(value)?value.map(replace):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([key])=>key!=='id'&&key!=='modelSource').map(([key,item])=>[document.nodes[key]||document.sketches?.[key]?alias(key):key,replace(item)])):value;
 return replace({nodes:document.nodes,roots:document.roots,sketches:document.sketches??{}});
}

describe('command registry',()=>{
 it('has unique canonical names and aliases, in the established terminal order',()=>{
  const names=commandRegistry.flatMap(entry=>[entry.name,...entry.aliases]);
  expect(new Set(names).size).toBe(names.length);
  expect(terminalCommands.slice(0,5).map(entry=>entry.name)).toEqual(['help','list','clear','alias','unalias']);
  expect(terminalCommands.map(entry=>entry.name)).not.toContain('terminal');
  expect(terminalCommands.map(entry=>entry.name)).not.toContain('code-workspace');
  expect(findCommandSpec('ERASE')?.name).toBe('delete');expect(findCommandSpec('cyl')?.name).toBe('cylinder');
  for(const name of interactiveCommandNames)expect(findCommandSpec(name)?.headless).toBe(true);
 });
 it('describes typed arguments and model edits for every front end',()=>{
  expect(findCommandSpec('box')).toMatchObject({editsModel:true,headless:true,category:'create',arguments:[{name:'size',kind:'vector'},{name:'center',kind:'point',optional:true}]});
  expect(findCommandSpec('line')!.arguments.every(arg=>arg.plane==='XY')).toBe(true);
  expect(findCommandSpec('extrude')!.arguments[0].kind).toBe('sketch');
  expect(findCommandSpec('select')).toMatchObject({editsModel:false,arguments:[{kind:'bodies',repeated:true}]});
  expect(findCommandSpec('top')).toMatchObject({headless:false,editsModel:false,category:'view',editorBridge:true});
  expect(findCommandSpec('undo')).toMatchObject({headless:true,editsModel:true,editorBridge:true});
 });
 it('drives the command palette labels, order and availability',()=>{
  expect(paletteCommands.map(entry=>entry.command)).toEqual(paletteCommandSpecs().map(entry=>entry.name));
  expect(paletteCommands[0]).toEqual({command:'shapes',label:'Find a shape',alias:'shape browser primitives'});
  expect(paletteCommands.find(entry=>entry.command==='union')).toMatchObject({label:'Union',requires:'canCombine'});
  expect(paletteCommands.map(entry=>entry.command)).toContain('terminal');
 });
 it('has a German entry for every description, palette label and prompt',()=>{
  const prompts=(session:CadSession)=>interactiveCommandNames.flatMap(name=>prepareCommand(session,name).steps.map(step=>step.message));
  const session=createCadSession();session.select([session.add({kind:'box',size:[1,1,1]})]);
  const english=prompts(session);
  setLocale('de');
  try{
   for(const entry of commandRegistry){
    expect(t(entry.description),entry.description).not.toBe(entry.description);
    if(entry.palette)expect(t(entry.palette.label),entry.palette.label).not.toBe(entry.palette.label);
   }
   // 'Radius (mm).' is spelled the same in German.
   expect(prompts(session).filter((message,i)=>message===english[i]&&message!=='Radius (mm).')).toEqual([]);
  }finally{setLocale('en');}
 });
});

describe('headless command runner',()=>{
 it('runs the terminal vocabulary without a DOM, one Undo step per edit',()=>{
  const session=createCadSession(),runner=createCommandRunner(session);
  expect(runner.run('b 40,30,10').invocation).toBe('box 40,30,10 0,0,5');
  expect(session.history.past).toHaveLength(1);
  runner.run('sphere 5 20,0,5');runner.run('cyl 3 8');runner.run('rect 0,0 20,30');runner.run('circle 50,0 5');runner.run('line 0,0 @10<90');
  const rect=Object.values(session.state.document.sketches!).find(sketch=>sketch.name==='Rectangle')!;
  expect(runner.run(`extrude ${rect.id} 4`).edited).toBe(true);
  expect(session.state.document.roots).toHaveLength(4);expect(session.history.past).toHaveLength(7);
  expect(runner.run('select "Box"').edited).toBe(false);expect(session.history.past).toHaveLength(7);
  const box=session.state.selection[0];
  expect(runner.run('move 0,0,0 @10,0,0').invocation).toBe('move 0,0,0 10,0,0');
  runner.run('rotate 0,0,90');runner.run('scale 2,1,1');
  expect(session.state.document.nodes[box].transform).toEqual({position:[10,0,5],rotation:[0,0,90],scale:[2,1,1]});
  runner.run('undo');expect(session.state.document.nodes[box].transform.scale).toEqual([1,1,1]);runner.run('redo');
  runner.run('select all');runner.run('deselect');expect(session.state.selection).toEqual([]);
  expect(runner.run('list').output).toContain(box);expect(runner.run('help move').output).toContain('move [base] [destination]');
 });
 it('replays canonical records and refuses view, panel and malformed input',()=>{
  const session=createCadSession(),records:string[]=[];session.subscribeCommands(record=>records.push(record.text));
  const runner=createCommandRunner(session);runner.run('box 1,2,3');const original=session.serialize();session.undo();
  runner.run(records[0]);expect(session.serialize()).toBe(original);
  expect(()=>runner.run('top')).toThrow(/interactive editor/);expect(()=>runner.run('code')).toThrow(/interactive editor/);
  expect(()=>runner.run('frobnicate')).toThrow(/Unknown command/);expect(()=>runner.run('cylinder 5')).toThrow(/Missing arguments/);
  expect(()=>runner.run('box 1,2,3 0,0,0 9')).toThrow(/Too many/);runner.run('select none');expect(()=>runner.run('move 0,0,0 1,0,0')).toThrow(/Select a top-level body/);
  expect(()=>runner.run('apply {"constructor":1}')).toThrow();expect(()=>runner.run('undo now')).toThrow(/Too many/);
  expect(session.history.past).toHaveLength(1);
 });
 it('runs scripts with comments, stops at the failing line and reports it',()=>{
  const session=createCadSession(),runner=createCommandRunner(session);
  const results=runner.runScript('// plate\nbox 10,10,2\n\nselect all\nmove 0,0,0 0,0,5');expect(results.map(r=>r.command)).toEqual(['box','select','move']);
  let failure:any;try{runner.runScript('box 1,1,1\nbox 0,1,1');}catch(error){failure=error;}
  expect(failure.line).toBe(2);expect(failure.message).toMatch(/^Line 2: Dimension/);
  expect(()=>runner.runScript(Array(300).fill('list').join('\n'))).toThrow(/at most 256/);
 });
 it('produces the same model as the terminal for the same input',async()=>{
  const script=['box 40,30,10 0,0,5','sphere 4 @10,0,0','rect 0,0 20,30','select all','move 0,0,0 @5,5,0','rotate 0,0,45','scale 1,2,1','select none','circle 10,10 3'];
  const headless=createCadSession();createCommandRunner(headless).runScript(script.join('\n'));
  const typed=createCadSession(),terminal=createTerminalController(typed,{executeEditorCommand:()=>{},openCodeWorkspace:()=>{}});
  for(const line of script)await terminal.submit(line);
  expect(terminal.state.entries.filter(entry=>entry.kind==='error')).toEqual([]);
  expect(shape(headless.state.document)).toEqual(shape(typed.state.document));
  expect(headless.history.past).toEqual(typed.history.past);
  terminal.dispose();
 });
});
