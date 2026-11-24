// SPDX-License-Identifier: BSD-3-Clause
import {expect,test} from '@playwright/test';
import type {Page} from '@playwright/test';

const saved=(page:Page)=>page.evaluate(()=>JSON.parse(localStorage.getItem('brickwright-cad:standalone:v1')!));
async function openWorkspace(page:Page){
 await page.getByRole('button',{name:'Command palette',exact:true}).click();
 const palette=page.getByRole('dialog',{name:'Command palette',exact:true});
 await palette.getByRole('combobox',{name:'Search CAD commands',exact:true}).fill('Code workspace');
 await palette.getByRole('option',{name:'Code workspace',exact:true}).click();
 const workspace=page.getByRole('dialog',{name:'CAD code workspace',exact:true});await expect(workspace).toBeVisible();return workspace;
}

test('keeps an unapplied workspace draft through closing and reload, then applies in one Undo step',async({page})=>{
 await page.goto('/');const root=page.locator('#cad-root');await expect(root).toHaveAttribute('data-state','ready');const before=await saved(page);
 let workspace=await openWorkspace(page);const source=workspace.getByLabel('CAD code source',{exact:true});
 await source.fill('param width: mm = 40; return box(wi');await source.press('Control+Space');await expect(source).toHaveValue('param width: mm = 40; return box(width');
 const program='param width: mm = 40; return box(width, 20, 5);';await source.fill(program);await workspace.getByLabel('Code object name',{exact:true}).fill('Workspace block');
 await expect(workspace.getByRole('status',{name:'Code status',exact:true})).toContainText('Preview ready');expect(await saved(page)).toEqual(before);
 await workspace.getByRole('button',{name:'Close code',exact:true}).click();await expect(workspace).toBeHidden();workspace=await openWorkspace(page);await expect(workspace.getByLabel('CAD code source',{exact:true})).toHaveValue(program);
 await page.reload();await expect(root).toHaveAttribute('data-state','ready');workspace=await openWorkspace(page);await expect(workspace.getByLabel('CAD code source',{exact:true})).toHaveValue(program);await expect(workspace.getByLabel('Code object name',{exact:true})).toHaveValue('Workspace block');
 await workspace.getByRole('button',{name:'Create code object',exact:true}).click();await expect(workspace).toBeVisible();await expect(workspace.getByRole('button',{name:'Apply code changes',exact:true})).toBeVisible();
 await expect.poll(async()=>(await saved(page)).roots.length).toBe(1);const created=await saved(page);expect(created.nodes[created.roots[0]].program.source).toBe(program);
 await page.getByRole('button',{name:'Undo',exact:true}).click();await expect.poll(async()=>(await saved(page)).roots.length).toBe(0);await expect(workspace.getByLabel('CAD code source',{exact:true})).toHaveValue(program);
});

test('retains a stale draft and requires an explicit baseline refresh before replacing changed saved source',async({page})=>{
 await page.goto('/');const root=page.locator('#cad-root');await expect(root).toHaveAttribute('data-state','ready');
 await page.getByRole('button',{name:'Code',exact:true}).click();const modal=page.getByRole('dialog',{name:'Code object',exact:true});await modal.getByLabel('CAD code source',{exact:true}).fill('return box(10, 10, 10);');await modal.getByRole('button',{name:'Create code object',exact:true}).click();await expect(modal).toBeHidden();await expect(root).toHaveAttribute('data-state','ready');
 let workspace=await openWorkspace(page);const draft='return box(30, 10, 10);';await workspace.getByLabel('CAD code source',{exact:true}).fill(draft);await workspace.getByRole('button',{name:'Close code',exact:true}).click();
 await page.getByRole('button',{name:'Code',exact:true}).click();await modal.getByLabel('CAD code source',{exact:true}).fill('return box(20, 10, 10);');await modal.getByRole('button',{name:'Apply code changes',exact:true}).click();await expect(modal).toBeHidden();await expect(root).toHaveAttribute('data-state','ready');const changed=await saved(page),id=changed.roots[0];
 workspace=await openWorkspace(page);await expect(workspace.getByLabel('CAD code source',{exact:true})).toHaveValue(draft);await expect(workspace.getByRole('button',{name:'Use current model',exact:true})).toBeVisible();
 await workspace.getByRole('button',{name:'Apply code changes',exact:true}).click();expect(await saved(page)).toEqual(changed);
 await workspace.getByRole('button',{name:'Use current model',exact:true}).click();await workspace.getByRole('button',{name:'Apply code changes',exact:true}).click();await expect.poll(async()=>(await saved(page)).nodes[id].program.source).toBe(draft);expect((await saved(page)).roots).toEqual([id]);
 await page.getByRole('button',{name:'Undo',exact:true}).click();await expect.poll(async()=>(await saved(page)).nodes[id].program.source).toBe('return box(20, 10, 10);');
});

test('chooses parameter suggestions with the keyboard and lets focus leave the source',async({page})=>{
 await page.goto('/');await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');const before=await saved(page);
 const workspace=await openWorkspace(page),source=workspace.getByLabel('CAD code source',{exact:true}),suggestions=workspace.getByRole('listbox',{name:'Parameter suggestions',exact:true});
 const prefix='param width: mm = 40; param wall: mm = 2; return box(w';
 await source.fill(prefix);await source.press('Control+Space');await expect(suggestions).toBeVisible();
 await expect(suggestions.getByRole('option',{name:'wall',exact:true})).toHaveAttribute('aria-selected','true');
 await source.press('ArrowDown');await expect(suggestions.getByRole('option',{name:'width',exact:true})).toHaveAttribute('aria-selected','true');
 await source.press('Enter');await expect(source).toHaveValue(prefix+'idth');await expect(suggestions).toBeHidden();await expect(source).toBeFocused();
 await source.fill(prefix);await source.press('Control+Space');await source.press('ArrowUp');await source.press('Tab');
 await expect(source).toHaveValue(prefix+'idth');await expect(source).toBeFocused();
 await source.fill(prefix);await source.press('Control+Space');await source.press('Escape');
 await expect(suggestions).toBeHidden();await expect(workspace).toBeVisible();await expect(source).toHaveValue(prefix);
 await source.press('Tab');await expect(source).toHaveValue(prefix+'  ');await expect(source).toBeFocused();
 await source.press('Shift+Tab');await expect(source).not.toBeFocused();expect(await saved(page)).toEqual(before);
});

test('an old linked Apply completion does not close a reopened workspace',async({page})=>{
 // Hold only the live-model rebuild after Apply. The trial build still runs,
 // commits the model, and reaches the panel's pending after() callback.
 await page.addInitScript(()=>{
  const original=Worker.prototype.postMessage;
  const gate={remaining:0,held:false,release:()=>{}};
  Object.assign(window,{workspaceBuildGate:gate});
  Worker.prototype.postMessage=function(...args:Parameters<Worker['postMessage']>){
   const message=args[0] as {document?:unknown;printability?:unknown};
   if(gate.remaining>0&&message?.document&&!message.printability&&--gate.remaining===0){
    gate.held=true;gate.release=()=>{gate.held=false;Reflect.apply(original,this,args);};return;
   }
   Reflect.apply(original,this,args);
  };
 });
 await page.goto('/');await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');
 let workspace=await openWorkspace(page);await workspace.getByLabel('CAD code source',{exact:true}).fill('return box(20, 10, 5);');
 await expect(workspace.getByRole('status',{name:'Code status',exact:true})).toContainText('Preview ready');
 await page.evaluate(()=>{(window as unknown as {workspaceBuildGate:{remaining:number}}).workspaceBuildGate.remaining=2;});
 await workspace.getByRole('button',{name:'Create & show model source',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as unknown as {workspaceBuildGate:{held:boolean}}).workspaceBuildGate.held)).toBe(true);
 await expect.poll(async()=>(await saved(page)).roots.length).toBe(1);
 await workspace.getByRole('button',{name:'Close code',exact:true}).click();workspace=await openWorkspace(page);
 const draft='return sphere(7);';await workspace.getByLabel('CAD code source',{exact:true}).fill(draft);
 await page.evaluate(()=>{(window as unknown as {workspaceBuildGate:{release:()=>void}}).workspaceBuildGate.release();});
 await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');
 await expect(workspace).toBeVisible();await expect(workspace.getByLabel('CAD code source',{exact:true})).toHaveValue(draft);
 await expect(page.locator('section.model-source-pane')).toBeHidden();
});
