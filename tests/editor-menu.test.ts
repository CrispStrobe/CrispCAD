// SPDX-License-Identifier: BSD-3-Clause
// The editor's menu as data (editor-menu.ts): every item names a command the editor runs, every
// label and section has a German translation, and the standalone app's native menus offer no
// command the shared definition lacks.
import {readFileSync} from 'node:fs';
import {afterEach,expect,it} from 'vitest';
import {setLocale,t} from '@brickwright/cad-core';
import {editorMenu,editorMenuSections,resolveEditorMenu} from '../packages/editor/src/editor-menu.js';
afterEach(()=>setLocale('en'));
const editorSource=readFileSync(new URL('../packages/editor/src/index.ts',import.meta.url),'utf8');
it('names only commands the editor executes, each once',()=>{
 const union=/export type CadCommand=([^;]+);/.exec(editorSource)![1];
 const known=new Set([...union.matchAll(/'([^']+)'/g)].map(m=>m[1]));
 const handled=editorSource.slice(editorSource.indexOf('async function executeCommand'));
 const commands=editorMenu.map(item=>item.command);
 expect(new Set(commands).size).toBe(commands.length);
 for(const command of commands){expect(known.has(command),command).toBe(true);expect(handled.includes(`'${command}'`),command).toBe(true);}
});
it('offers the exact features, STEP exchange and drawings in the menu',()=>{
 const commands=editorMenu.map(item=>item.command);
 for(const command of ['import-step','export-step','exact-feature','exact-edges','measure-exact','recompute-exact','drawing','drawing-exact','printability','hole','fasten','standard-part'])expect(commands).toContain(command);
 expect(editorMenu.filter(item=>item.exact).map(item=>item.command)).toEqual(['import-step','export-step','exact-feature','exact-edges','measure-exact','recompute-exact','drawing-exact']);
});
it('translates every label and section into German',()=>{
 setLocale('de');
 const same=new Set(['Home']);
 for(const label of [...editorMenu.map(item=>item.label),...Object.values(editorMenuSections)])if(!same.has(label))expect(t(label),label).not.toBe(label);
 const items=resolveEditorMenu({hasSelection:false,canDelete:false,canCombine:false,canExport:true,hasBodies:true,canUndo:false,canRedo:false,oneBody:true,canDraw:true});
 expect(items.find(item=>item.command==='import-step')!.title).toBe('STEP als exakte Körper importieren…');
 expect(items.find(item=>item.command==='undo')!.enabled).toBe(false);
 expect(items.find(item=>item.command==='measure-exact')!.enabled).toBe(true);
});
it('omits commands a host does not offer',()=>{
 const items=resolveEditorMenu({hasSelection:true,canDelete:true,canCombine:true,canExport:true,hasBodies:true,canUndo:true,canRedo:true,oneBody:true,canDraw:true},new Set(['robot-projects']));
 expect(items.some(item=>item.command==='robot-projects')).toBe(false);
 expect(items.every(item=>item.enabled)).toBe(true);
});
it('covers every command of the macOS app menus',()=>{
 const swift=readFileSync(new URL('../apps/macos/Main.swift',import.meta.url),'utf8');
 const native=[...swift.matchAll(/addCommand\(\w+,"[^"]+","([^"]+)"/g)].map(m=>m[1]).filter(command=>!['projects','help'].includes(command));
 expect(native.length).toBeGreaterThan(30);
 const commands=new Set(editorMenu.map(item=>item.command));
 expect(native.filter(command=>!commands.has(command as never))).toEqual([]);
});
