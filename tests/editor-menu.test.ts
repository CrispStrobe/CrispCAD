// SPDX-License-Identifier: BSD-3-Clause
// The editor's menu as data (editor-menu.ts): every item names a command the editor runs, every
// label and section has a German translation, and the standalone app's native menus offer no
// command the shared definition lacks: they and the toolbar's File and Edit dropdowns are built
// from it.
import {readFileSync} from 'node:fs';
import {afterEach,expect,it} from 'vitest';
import {setLocale,t} from '@brickwright/cad-core';
import {editorMenu,editorMenuSections,editorToolbarMenu,editorToolbarMenuOf,resolveEditorMenu} from '../packages/editor/src/editor-menu.js';
// @ts-expect-error a plain ES module without types
import {macMenuSwift} from '../scripts/lib/mac-menus.mjs';
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
 for(const command of ['import-step','export-step','exact-feature','exact-edges','measure-exact','recompute-exact','drawing','drawing-exact','printability','manufacturing','hole','fasten','standard-part','split-body','materials','surface-blends','step-evidence'])expect(commands).toContain(command);
 expect(editorMenu.filter(item=>item.exact).map(item=>item.command)).toEqual(['import-step','export-step','step-evidence','exact-feature','exact-edges','measure-exact','recompute-exact','surface-blends','drawing-exact','manufacturing']);
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
it('builds the macOS app menus from the definition, with native titles only for its commands',()=>{
 const swift=readFileSync(new URL('../apps/macos/Main.swift',import.meta.url),'utf8');
 const table=swift.slice(swift.indexOf('private let nativeCommands'),swift.indexOf('/// The definition\'s items of one section'));
 const native=[...table.matchAll(/"([a-z-]+)":\("/g)].map(m=>m[1]);
 expect(native.length).toBeGreaterThan(30);
 const commands=new Set(editorMenu.map(item=>item.command));
 expect(native.filter(command=>!commands.has(command as never))).toEqual([]);
 // Only the macOS-only items are still added by hand.
 expect([...swift.matchAll(/addCommand\(\w+,"[^"]+","([^"]+)"/g)].map(m=>m[1]).sort()).toEqual(['help','projects']);
});
it('keeps the generated macOS menu table up to date with the definition',()=>{
 const german=(key:string)=>{setLocale('de');try{return t(key);}finally{setLocale('en');}};
 const generated=readFileSync(new URL('../apps/macos/EditorMenu.generated.swift',import.meta.url),'utf8');
 expect(generated,'run node scripts/generate-mac-menus.mjs').toBe(macMenuSwift({editorMenu,editorMenuSections,german}));
 for(const command of ['import-step','export-step','exact-feature','hole','drawing-exact','manufacturing'])expect(generated).toContain(`command: "${command}"`);
 expect(generated).toContain('"Exact modeling (B-rep)": "');
});
it('renders the toolbar File and Edit dropdowns from the definition',()=>{
 const file=editorToolbarMenu('file').map(item=>item.command),edit=editorToolbarMenu('edit').map(item=>item.command);
 expect(file.slice(0,3)).toEqual(['new','open','save']);
 for(const command of ['import-step','export-step','hole','fasten','drawing','drawing-exact','printability','manufacturing'])expect(file).toContain(command);
 expect(edit.slice(0,3)).toEqual(['mirror','pattern','split-body']);
 for(const command of ['split-body','exact-feature','exact-edges','measure-exact','recompute-exact','surface-blends','assembly','explode-view','cut','copy','paste','duplicate','delete'])expect(edit).toContain(command);
 for(const command of ['step-evidence','drawing-export','materials'])expect(file).toContain(command);
 expect([...file,...edit]).not.toContain('undo');
 expect(editorToolbarMenu('file',new Set(['robot-projects']))).not.toContainEqual(expect.objectContaining({command:'robot-projects'}));
 // Every command lands in at most one dropdown; view, object (unless marked) and tools in none.
 expect(new Set([...file,...edit]).size).toBe(file.length+edit.length);
 expect(editorMenu.filter(item=>item.section==='view').every(item=>editorToolbarMenuOf(item)===undefined)).toBe(true);
 setLocale('de');
 for(const item of editorMenu)for(const key of [item.short,item.hint])if(key)expect(t(key),key).not.toBe(key);
});
