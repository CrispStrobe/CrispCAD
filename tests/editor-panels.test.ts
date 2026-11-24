// @vitest-environment happy-dom
// SPDX-License-Identifier: BSD-3-Clause
import {afterEach,describe,expect,it,vi} from 'vitest';
import {createCadSession,defaultCodeProgram} from '@brickwright/cad-core';
import type {CadDocument,Vec3} from '@brickwright/cad-core';
import type {GeometryResult} from '@brickwright/cad-geometry';
import {mountCodePanel} from '../packages/editor/src/code-panel.js';
import {mountTerminalPanel} from '../packages/editor/src/terminal-panel.js';

// Exercise the real panels/session in a ShadowRoot. Geometry rendering and
// pointer hit testing have separate browser coverage; layout needs browser QA.
vi.mock('../packages/editor/src/shapes.js',()=>({evaluatedPreview:()=> 'data:image/png;base64,'}));
const cleanups:(()=>void)[]=[];
afterEach(()=>{for(const cleanup of cleanups.splice(0).reverse())cleanup();document.body.replaceChildren();vi.useRealTimers();});
const host=()=>{const node=document.createElement('div');document.body.append(node);const root=node.attachShadow({mode:'open'}),parent=document.createElement('div');root.append(parent);return {root,parent};};
const field=(parent:ParentNode,label:string)=>{const result=parent.querySelector<HTMLInputElement|HTMLTextAreaElement>(`[aria-label="${label}"]`);if(!result)throw Error(`Missing ${label}`);return result;};
const button=(parent:ParentNode,label:string)=>{const result=[...parent.querySelectorAll('button')].find(item=>item.textContent===label);if(!result)throw Error(`Missing ${label}`);return result;};
function change(input:HTMLInputElement|HTMLTextAreaElement,value:string){input.value=value;input.setSelectionRange(value.length,value.length);input.dispatchEvent(new Event('input',{bubbles:true,composed:true}));}
function key(input:HTMLElement,key:string,options:KeyboardEventInit={}){const event=new KeyboardEvent('keydown',{key,bubbles:true,composed:true,cancelable:true,...options});input.dispatchEvent(event);return event;}
async function submit(input:HTMLInputElement|HTMLTextAreaElement){input.closest('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await Promise.resolve();await Promise.resolve();}
function geometry(doc:CadDocument):GeometryResult{return {bodies:doc.roots.map(id=>({id,name:doc.nodes[id].name,color:doc.nodes[id].color,positions:new Float32Array([0,0,0,10,0,0,0,10,0]),indices:new Uint32Array([0,1,2]),volume:100,bounds:{min:[0,0,0],max:[10,10,10]}})),volume:100,triangles:1};}
function workspace(options:{after?:()=>Promise<unknown>;onModelSource?:()=>void}={}){
 const {root,parent}=host(),session=createCadSession();cleanups.push(()=>session.dispose());
 const after=vi.fn(options.after??(async()=>{})),evaluate=vi.fn(async(doc:CadDocument)=>geometry(doc));
 const values=new Map<string,string>(),storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);}};
 const code=mountCodePanel(parent,session,evaluate,after,undefined,options.onModelSource,{workspaceStorage:storage});cleanups.push(()=>code.dispose());
 return {root,parent,session,code,after,evaluate,storage};
}
function terminal(){
 const fixture=workspace(),{parent,session,code}=fixture,canvas=document.createElement('button');canvas.textContent='Canvas';parent.append(canvas);
 const picks:((point:Vec3|null)=>void)[]=[],cancelPick=vi.fn();
 const panel=mountTerminalPanel(parent,session,{executeEditorCommand:command=>{if(command==='undo')session.undo();else if(command==='redo')session.redo();},openCodeWorkspace:()=>code.openWorkspace(),pickPoint:done=>{picks.push(done);return cancelPick;},focusCanvas:()=>canvas.focus(),storage:fixture.storage});
 cleanups.push(()=>panel.dispose());panel.setVisible(true);return {...fixture,panel,canvas,picks,cancelPick,input:field(parent,'CAD command')};
}

describe('terminal panel integration',()=>{
 it('cycles quoted entity completions with accessible selection and commits only on Enter',async()=>{
  const {session,parent,panel,input}=terminal();
  const a=session.add({kind:'box',size:[10,10,10]},{name:'Named Alpha'}),b=session.add({kind:'box',size:[10,10,10]},{name:'Named Beta'});session.select([]);const revision=session.state.revision;
  change(input,'sel Named');key(input,'Tab');expect(input.value).toBe('sel "Named Alpha" ');
  key(input,'Tab');expect(input.value).toBe('sel "Named Beta" ');key(input,'Tab',{shiftKey:true});expect(input.value).toBe('sel "Named Alpha" ');
  const active=parent.querySelector('[role="option"][aria-selected="true"]');expect(active?.id).toBe(input.getAttribute('aria-activedescendant'));expect(active?.textContent).toContain(a);
  expect(session.state.selection).toEqual([]);expect(session.state.revision).toBe(revision);
  await submit(input);expect(session.state.selection).toEqual([a]);expect(session.state.selection).not.toContain(b);expect(session.state.revision).toBe(revision);
  await panel.controller.submit('select');change(input,'"Named B');key(input,'Tab');expect(input.value).toBe('"Named Beta" ');await submit(input);expect(session.state.selection).toEqual([b]);
 });

 it('preserves following arguments when completing a closed sketch in the middle of a line',async()=>{
  const {session,panel,input}=terminal();
  await panel.controller.submit('rectangle 0,0 20,30');await panel.controller.submit('line 0,0 10,0');const revision=session.state.revision;
  change(input,'ex "Rec" 7');input.setSelectionRange(7,7);key(input,'Tab');expect(input.value).toBe('ex "Rectangle" 7');expect(session.state.revision).toBe(revision);
  await submit(input);expect(session.state.document.nodes[session.state.document.roots[0]]).toMatchObject({kind:'extrusion',distance:7});expect(session.state.revision).toBe(revision+1);
  session.undo();expect(session.state.document.roots).toEqual([]);expect(Object.keys(session.state.document.sketches!)).toHaveLength(2);
 });

 it('restores unfinished history input and contains editor shortcuts',async()=>{
  const {parent,panel,input}=terminal(),outside=vi.fn();parent.addEventListener('keydown',outside);
  await panel.controller.submit('help box');change(input,'unfinished input');key(input,'ArrowUp');expect(input.value).toBe('help box');key(input,'ArrowDown');expect(input.value).toBe('unfinished input');
  key(input,'Delete');key(input,'z',{ctrlKey:true});expect(outside).not.toHaveBeenCalled();
 });

 it('cancels pending picking and ignores a late point callback without creating an undo step',async()=>{
  const {session,panel,input,picks,cancelPick}=terminal();await panel.controller.submit('line');expect(picks).toHaveLength(1);
  picks[0]([10,20,0]);await Promise.resolve();expect(panel.controller.state.prompt?.message).toContain('Next point');const next=picks.at(-1)!;
  key(input,'Escape');expect(cancelPick).toHaveBeenCalled();next([30,40,0]);await Promise.resolve();expect(panel.controller.state.prompt).toBeUndefined();expect(session.state.revision).toBe(0);expect(session.state.canUndo).toBe(false);
 });

 it('hands source focus to the workspace and returns to the terminal on close',async()=>{
  const {root,parent,input,code}=terminal();change(input,'code');await submit(input);expect(code.isWorkspaceOpen).toBe(true);expect(root.activeElement).toBe(field(parent,'CAD code source'));
  button(parent,'Close code').click();expect(root.activeElement).toBe(input);
 });
});

describe('persistent code panel integration',()=>{
 it('previews without history, applies once, then keeps editing the same code object',async()=>{
  vi.useFakeTimers();const {session,parent,code,evaluate}=workspace();code.openWorkspace();const source=field(parent,'CAD code source');change(source,'return box(10, 20, 5);');
  await vi.advanceTimersByTimeAsync(450);expect(evaluate).toHaveBeenCalled();expect(session.state.revision).toBe(0);expect(parent.querySelector('[aria-label="Code status"]')?.textContent).toContain('Preview ready');
  button(parent,'Create code object').click();await vi.waitFor(()=>expect(session.state.document.roots).toHaveLength(1));const id=session.state.document.roots[0];expect(code.isWorkspaceOpen).toBe(true);expect(session.history.past).toHaveLength(1);
  change(source,'return box(30, 20, 5);');button(parent,'Apply code changes').click();await vi.waitFor(()=>expect(session.state.revision).toBe(2));expect(session.state.document.roots).toEqual([id]);session.undo();expect(session.state.document.nodes[id]).toMatchObject({program:{source:'return box(10, 20, 5);'}});
 });

 it('allows keyboard selection among parameter suggestions and releases Shift+Tab',()=>{
  const {root,parent,code}=workspace();code.openWorkspace();const source=field(parent,'CAD code source');
  const prefix='param wall: mm = 2; param width: mm = 40; return box(w';change(source,prefix);key(source,' ',{code:'Space',ctrlKey:true});
  expect(parent.querySelectorAll('.code-completions [role="option"]')).toHaveLength(2);key(source,'ArrowDown');key(source,'Enter');expect(source.value).toBe(prefix.slice(0,-1)+'width');expect(root.activeElement).toBe(source);
  change(source,prefix);key(source,' ',{code:'Space',ctrlKey:true});key(source,'Escape');expect(code.isWorkspaceOpen).toBe(true);expect(parent.querySelector('.code-completions')?.childElementCount).toBe(0);
  expect(key(source,'Tab',{shiftKey:true}).defaultPrevented).toBe(false);expect(key(source,'Tab').defaultPrevented).toBe(true);
 });

 it('ignores a preview that finishes after its workspace was replaced',async()=>{
  const {session,parent,code,evaluate}=workspace();const other=session.addCode(defaultCodeProgram(),'Other code');let finish!:(value:GeometryResult)=>void;
  evaluate.mockImplementationOnce(doc=>new Promise(resolve=>{finish=()=>resolve(geometry(doc));}));code.openWorkspace();button(parent,'Preview code').click();await vi.waitFor(()=>expect(evaluate).toHaveBeenCalled());
  code.openWorkspace(other);const source=field(parent,'CAD code source');change(source,'return sphere(8);');const revision=session.state.revision;finish({bodies:[],triangles:0,volume:0});await Promise.resolve();await Promise.resolve();
  expect(source.value).toBe('return sphere(8);');expect(session.state.revision).toBe(revision);expect(code.isWorkspaceOpen).toBe(true);expect(parent.querySelector('[aria-label="Code status"]')?.textContent).not.toContain('Preview ready');
 });

 for(const action of ['Preview code','Apply & show model source'])it(`invalidates in-flight ${action} when the source baseline is refreshed`,async()=>{
  const onModelSource=vi.fn(),{session,parent,code,evaluate}=workspace({onModelSource}),id=session.addCode(defaultCodeProgram(),'Existing code');
  let finish!:()=>void;evaluate.mockImplementationOnce(doc=>new Promise(resolve=>{finish=()=>resolve(geometry(doc));}));
  code.openWorkspace(id);change(field(parent,'CAD code source'),'return box(12, 12, 12);');const actionButton=button(parent,action);actionButton.click();await vi.waitFor(()=>expect(evaluate).toHaveBeenCalled());
  session.updateCode(id,{...defaultCodeProgram(),source:'return sphere(3);'});button(parent,'Use current model').click();const changed=session.serialize(),revision=session.state.revision;
  finish();await vi.waitFor(()=>expect(actionButton.disabled).toBe(false));await Promise.resolve();
  expect(session.serialize()).toBe(changed);expect(session.state.revision).toBe(revision);expect(onModelSource).not.toHaveBeenCalled();expect(code.isWorkspaceOpen).toBe(true);
  expect(field(parent,'CAD code source').value).toBe('return box(12, 12, 12);');expect(parent.querySelector('[aria-label="Code status"]')?.textContent).not.toContain('Preview ready');
 });

 for(const action of ['replace','close','dispose','edit','refresh-after-model-edit'] as const)it(`suppresses a delayed linked Apply follow-up after ${action}`,async()=>{
  let finish!:()=>void;const pending=new Promise<void>(resolve=>{finish=resolve;}),onModelSource=vi.fn();
  const {session,parent,code,after}=workspace({after:()=>pending,onModelSource});const other=session.addCode(defaultCodeProgram(),'Other code');code.openWorkspace();change(field(parent,'CAD code source'),'return box(12, 12, 12);');
  const linked=button(parent,'Create & show model source');linked.click();await vi.waitFor(()=>expect(after).toHaveBeenCalled());expect(linked.disabled).toBe(true);
  if(action==='replace')code.openWorkspace(other);else if(action==='close')code.close();else if(action==='dispose')code.dispose();else if(action==='refresh-after-model-edit'){session.rename('Changed while applying');button(parent,'Use current model').click();}else change(field(parent,'CAD code source'),'return sphere(9);');
  finish();await vi.waitFor(()=>expect(linked.disabled).toBe(false));await Promise.resolve();expect(onModelSource).not.toHaveBeenCalled();
  if(action==='replace'||action==='edit'||action==='refresh-after-model-edit')expect(code.isWorkspaceOpen).toBe(true);
 });

 it('still follows a successful linked Apply from the original modal',async()=>{
  const onModelSource=vi.fn(),{parent,code,session}=workspace({onModelSource});code.open();change(field(parent,'CAD code source'),'return box(12, 12, 12);');button(parent,'Create & show model source').click();
  await vi.waitFor(()=>expect(onModelSource).toHaveBeenCalledOnce());expect(session.state.document.roots).toHaveLength(1);expect(parent.querySelector('dialog')?.open).toBe(false);
 });
});
