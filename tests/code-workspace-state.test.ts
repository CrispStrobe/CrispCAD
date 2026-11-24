// SPDX-License-Identifier: BSD-3-Clause
import {expect,it} from 'vitest';
import {createCodeWorkspaceStore,codeParameterCompletions} from '../packages/editor/src/code-workspace-state.js';
import type {CodeWorkspaceDraft,CodeWorkspaceStorage} from '../packages/editor/src/code-workspace-state.js';

const storage=():CodeWorkspaceStorage=>{const values=new Map<string,string>();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>{values.set(key,value);}};};
const draft=(projectId='project-a',targetId?:string):CodeWorkspaceDraft=>({projectId,...(targetId?{targetId}:{}),name:'Draft block',program:{version:1,language:'brickwright-cad-script',source:'param width: mm = 40;\nreturn box(width, 20, 5);',parameters:{width:'42'}}});

it('restores unapplied invalid source and local parameter overrides without mixing projects or objects',()=>{
 const host=storage(),store=createCodeWorkspaceStore(host),first=draft();first.program.source+=' unfinished';
 expect(store.save(first)).toEqual({accepted:true,persistent:true});
 const object=draft('project-a','code-a');object.baseline=structuredClone(object.program);object.program.parameters.width='50';store.save(object);
 const other=draft('project-b');other.program.source='return sphere(3);';store.save(other);
 const reopened=createCodeWorkspaceStore(host);
 expect(reopened.load('project-a')).toEqual(first);
 expect(reopened.load('project-a','code-a')).toEqual(object);
 expect(reopened.latest('project-a')?.targetId).toBe('code-a');
 expect(reopened.load('project-b')).toEqual(other);
 expect(reopened.load('project-b','code-a')).toBeUndefined();
});

it('copies caller and restored data and retains the baseline for detecting another saved edit',()=>{
 const store=createCodeWorkspaceStore(),value=draft('project','code');value.baseline=structuredClone(value.program);store.save(value);
 value.program.parameters.width='100';value.baseline.source='changed outside the store';
 const loaded=store.load('project','code')!;loaded.program.parameters.width='200';
 expect(store.load('project','code')!.program.parameters.width).toBe('42');
 expect(store.load('project','code')!.baseline!.source).toContain('param width');
});

it('degrades safely when device storage is unavailable or corrupt',()=>{
 const unavailable={getItem(){throw new Error('blocked');},setItem(){throw new Error('quota');}};
 const store=createCodeWorkspaceStore(unavailable),value=draft();expect(store.save(value)).toEqual({accepted:true,persistent:false});expect(store.load('project-a')).toEqual(value);
 const corrupt={getItem:()=>'{invalid',setItem(){}};expect(createCodeWorkspaceStore(corrupt).latest('project-a')).toBeUndefined();
 const malformed={getItem:()=>JSON.stringify({version:1,drafts:[{...value,program:{...value.program,parameters:{width:42}}}]}),setItem(){}};
 expect(createCodeWorkspaceStore(malformed).load('project-a')).toBeUndefined();
});

it('bounds persisted drafts and source bytes while keeping the last valid draft',()=>{
 const host=storage(),store=createCodeWorkspaceStore(host);for(let i=0;i<20;i++)store.save(draft(`project-${i}`));
 expect(store.load('project-0')).toBeUndefined();expect(createCodeWorkspaceStore(host).load('project-19')).toEqual(draft('project-19'));
 const oversized=draft('project-19');oversized.program.source='é'.repeat(16385);
 expect(store.save(oversized)).toEqual({accepted:false,persistent:false});expect(store.load('project-19')).toEqual(draft('project-19'));
 store.remove('project-19');expect(createCodeWorkspaceStore(host).load('project-19')).toBeUndefined();
});

it('completes declared parameters in unfinished code without using comments or text literals',()=>{
 const source='param width: mm = 40;\nparam wall: mm = 2;\n// param wrong: mm = 3;\nreturn box(wi';
 const result=codeParameterCompletions(source,source.length);expect(result.matches).toEqual(['width']);expect(source.slice(result.start,result.end)).toBe('wi');
 const choices=source.slice(0,-1);expect(codeParameterCompletions(choices,choices.length).matches).toEqual(['wall','width']);
 const comment=source+'\n// ';expect(codeParameterCompletions(comment,comment.length).matches).toEqual([]);
 const text=source+'\ntext("wi';expect(codeParameterCompletions(text,text.length).matches).toEqual([]);
});
