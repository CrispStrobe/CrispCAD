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

it('merges saves from independent editors and refreshes drafts written by another instance',()=>{
 const host=storage(),first=createCodeWorkspaceStore(host),second=createCodeWorkspaceStore(host);
 const a=draft('project-a','code-a'),b=draft('project-b'),c=draft('project-a','code-b');
 first.save(a);second.save(b);first.save(c);
 const reopened=createCodeWorkspaceStore(host);
 expect(reopened.load('project-a','code-a')).toEqual(a);expect(reopened.load('project-b')).toEqual(b);expect(reopened.load('project-a','code-b')).toEqual(c);
 expect(second.latest('project-a')).toEqual(c);
 const updated=structuredClone(a);updated.program.source='return sphere(9);';second.save(updated);
 expect(first.load('project-a','code-a')).toEqual(updated);expect(first.load('project-b')).toEqual(b);
});

it('merges removals without deleting unrelated drafts or resurrecting stale ones',()=>{
 const host=storage(),first=createCodeWorkspaceStore(host),second=createCodeWorkspaceStore(host),third=createCodeWorkspaceStore(host);
 first.save(draft('project-a','code-a'));first.save(draft('project-a','code-b'));
 second.load('project-a','code-a');third.save(draft('project-b'));
 second.remove('project-a','code-a');first.save(draft('project-c'));
 const reopened=createCodeWorkspaceStore(host);
 expect(reopened.load('project-a','code-a')).toBeUndefined();expect(reopened.load('project-a','code-b')).toEqual(draft('project-a','code-b'));
 expect(reopened.load('project-b')).toEqual(draft('project-b'));expect(reopened.load('project-c')).toEqual(draft('project-c'));
});

it('retains unsaved changes and removals through write failures while merging other editors',()=>{
 const host=storage();let blocked=false;
 const flaky={getItem:host.getItem,setItem(key:string,value:string){if(blocked)throw new Error('quota');host.setItem(key,value);}};
 const first=createCodeWorkspaceStore(flaky),second=createCodeWorkspaceStore(host);
 first.save(draft('old'));blocked=true;
 first.remove('old');expect(first.save(draft('local'))).toEqual({accepted:true,persistent:false});second.save(draft('other'));
 expect(first.load('old')).toBeUndefined();expect(first.load('local')).toEqual(draft('local'));expect(first.load('other')).toEqual(draft('other'));
 blocked=false;expect(first.save(draft('retry'))).toEqual({accepted:true,persistent:true});
 const reopened=createCodeWorkspaceStore(host);expect(reopened.load('old')).toBeUndefined();
 for(const project of ['local','other','retry'])expect(reopened.load(project)).toEqual(draft(project));
});

it('does not overwrite unreadable shared storage and flushes local drafts after access returns',()=>{
 const host=storage();let blocked=false,writes=0;
 const flaky={getItem(key:string){if(blocked)throw new Error('unavailable');return host.getItem(key);},setItem(key:string,value:string){writes++;host.setItem(key,value);}};
 const first=createCodeWorkspaceStore(flaky),second=createCodeWorkspaceStore(host);blocked=true;
 second.save(draft('other'));expect(first.save(draft('local'))).toEqual({accepted:true,persistent:false});expect(writes).toBe(0);
 expect(first.load('local')).toEqual(draft('local'));blocked=false;
 expect(first.save(draft('retry'))).toEqual({accepted:true,persistent:true});
 const reopened=createCodeWorkspaceStore(host);for(const project of ['local','other','retry'])expect(reopened.load(project)).toEqual(draft(project));
});

it('keeps in-session drafts when shared storage becomes corrupt and repairs it on the next save',()=>{
 const host=storage(),store=createCodeWorkspaceStore(host);store.save(draft('existing'));
 host.setItem('brickwright-cad:code-workspace:v1','{invalid');
 expect(store.load('existing')).toEqual(draft('existing'));expect(store.save(draft('new'))).toEqual({accepted:true,persistent:true});
 const reopened=createCodeWorkspaceStore(host);expect(reopened.load('existing')).toEqual(draft('existing'));expect(reopened.load('new')).toEqual(draft('new'));
});

it('applies the draft limit to the merged collection across editors',()=>{
 const host=storage(),editors=[createCodeWorkspaceStore(host),createCodeWorkspaceStore(host)];
 for(let i=0;i<20;i++)editors[i%2].save(draft(`project-${i}`));
 const reopened=createCodeWorkspaceStore(host);
 for(let i=0;i<20;i++)expect(reopened.load(`project-${i}`)).toEqual(i<4?undefined:draft(`project-${i}`));
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
