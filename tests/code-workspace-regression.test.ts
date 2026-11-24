// @vitest-environment happy-dom
// SPDX-License-Identifier: BSD-3-Clause
import {afterEach,describe,expect,it,vi} from 'vitest';
import {createCadSession} from '@brickwright/cad-core';
import {mountCodePanel} from '../packages/editor/src/code-panel.js';

vi.mock('../packages/editor/src/shapes.js',()=>({evaluatedPreview:()=> 'data:image/png;base64,'}));
const cleanups:(()=>void)[]=[];
afterEach(()=>{for(const cleanup of cleanups.splice(0).reverse())cleanup();document.body.replaceChildren();vi.useRealTimers();});
function fixture(){
 vi.useFakeTimers();
 const host=document.createElement('div');document.body.append(host);const root=host.attachShadow({mode:'open'}),parent=document.createElement('div');root.append(parent);
 const session=createCadSession();cleanups.push(()=>session.dispose());
 const code=mountCodePanel(parent,session,async()=>({bodies:[],volume:0,triangles:0}),async()=>{});cleanups.push(()=>code.dispose());code.openWorkspace();
 const source=parent.querySelector<HTMLTextAreaElement>('[aria-label="CAD code source"]')!,file=parent.querySelector<HTMLInputElement>('[aria-label="Import CAD source"]')!,status=parent.querySelector('[aria-label="Code status"]')!;
 function importFile(name:string){
  let resolve!:(text:string)=>void,reject!:(error:Error)=>void;const text=new Promise<string>((yes,no)=>{resolve=yes;reject=no;});
  Object.defineProperty(file,'files',{configurable:true,value:[{name,size:128,text:()=>text}]});file.dispatchEvent(new Event('change',{bubbles:true}));
  return {resolve,reject};
 }
 function edit(text:string){source.value=text;source.dispatchEvent(new Event('input',{bubbles:true}));}
 return {session,code,parent,source,status,importFile,edit};
}
const flush=async()=>{await Promise.resolve();await Promise.resolve();};

describe('code workspace import requests',()=>{
 it('keeps the latest selected file when an older file finishes reading first',async()=>{
  const {session,source,status,importFile}=fixture(),initial=source.value;
  const older=importFile('older.cadcode'),newer=importFile('newer.cadcode');
  older.resolve('return box(1, 2, 3);');await flush();expect(source.value).toBe(initial);
  newer.resolve('return sphere(8);');await flush();expect(source.value).toBe('return sphere(8);');expect(status.textContent).toContain('Source loaded');expect(session.state.revision).toBe(0);
 });

 it('ignores a failed older import while the latest selection is still loading',async()=>{
  const {source,status,importFile}=fixture(),initial=source.value;
  const older=importFile('older.cadcode'),newer=importFile('newer.cadcode');
  older.reject(new Error('Older file could not be read'));await flush();expect(status.textContent).not.toContain('Older file');expect(source.value).toBe(initial);
  newer.resolve('return box(12, 10, 5);');await flush();expect(source.value).toBe('return box(12, 10, 5);');expect(status.textContent).toContain('Source loaded');
 });

 it.each(['return sphere(8);','this is not CAD Script'])('ignores obsolete import contents after a manual edit: %s',async text=>{
  const {session,source,status,importFile,edit}=fixture(),pending=importFile('older.cadcode');
  edit('return box(20, 10, 5);');const message=status.textContent;
  pending.resolve(text);await flush();
  expect(source.value).toBe('return box(20, 10, 5);');expect(status.textContent).toBe(message);expect(source.hasAttribute('aria-invalid')).toBe(false);expect(session.state.revision).toBe(0);
 });

 it('ignores a file that finishes after closing and reopening the workspace',async()=>{
  const {session,code,parent,importFile}=fixture(),pending=importFile('closed.cadcode');code.close();code.openWorkspace();
  const source=parent.querySelector<HTMLTextAreaElement>('[aria-label="CAD code source"]')!,status=parent.querySelector('[aria-label="Code status"]')!;
  source.value='return sphere(7);';source.dispatchEvent(new Event('input',{bubbles:true}));const message=status.textContent;
  pending.resolve('return box(1, 2, 3);');await flush();
  expect(source.value).toBe('return sphere(7);');expect(status.textContent).toBe(message);expect(code.isWorkspaceOpen).toBe(true);expect(session.state.revision).toBe(0);
 });

 it('still reports an error from the current import and preserves the prior draft',async()=>{
  const {session,source,status,importFile}=fixture(),initial=source.value,pending=importFile('invalid.cadcode');
  pending.resolve('this is not CAD Script');await flush();
  expect(source.value).toBe(initial);expect(status.textContent).not.toBe('');expect(source.getAttribute('aria-invalid')).toBe('true');expect(session.state.revision).toBe(0);
 });
});
