// SPDX-License-Identifier: BSD-3-Clause
import {expect,test} from '@playwright/test';
import type {Page} from '@playwright/test';

const model=(page:Page)=>page.evaluate(()=>JSON.parse(localStorage.getItem('brickwright-cad:standalone:v1')!));
async function openTerminal(page:Page){
 await page.getByRole('button',{name:'Terminal',exact:true}).click();
 const terminal=page.getByRole('region',{name:'CAD terminal',exact:true});await expect(terminal).toBeVisible();return terminal;
}
test('prompts, cancels, completes and replays GUI edits using the same Undo',async({page})=>{
 await page.goto('/');const root=page.locator('#cad-root');await expect(root).toHaveAttribute('data-state','ready');
 const terminal=await openTerminal(page),input=terminal.getByRole('combobox',{name:'CAD command'});
 await input.fill('b');await input.press('Enter');await expect(terminal.getByRole('status')).toContainText('Box dimensions');
 await input.fill('20,30,10');await input.press('Enter');expect((await model(page)).roots).toHaveLength(0);
 await input.press('Escape');expect((await model(page)).roots).toHaveLength(0);
 await input.fill('box 20,30,10 0,0,5');await input.press('Enter');await expect(root).toHaveAttribute('data-state','ready');
 await expect.poll(async()=>(await model(page)).roots.length).toBe(1);const first=await model(page);
 await page.getByRole('button',{name:'Duplicate',exact:true}).first().click();await expect.poll(async()=>(await model(page)).roots.length).toBe(2);
 const replayRow=terminal.locator('.terminal-entry.action').filter({has:page.getByText('Duplicate',{exact:true})});
 await expect(replayRow).toHaveCount(1);await replayRow.getByRole('button',{name:'Use command'}).click();
 const replay=await input.inputValue();expect(replay).toMatch(/^apply /);
 await page.getByRole('button',{name:'Undo',exact:true}).click();await expect.poll(async()=>(await model(page)).roots.length).toBe(1);
 await input.fill(replay);await input.press('Enter');await expect.poll(async()=>(await model(page)).roots.length).toBe(2);
 await input.fill('undo');await input.press('Enter');await expect.poll(async()=>(await model(page)).roots).toEqual(first.roots);
 await input.fill('cyl');await input.press('Tab');await expect(input).toHaveValue('cylinder ');expect((await model(page)).roots).toHaveLength(1);
 await input.fill('draft text');await input.press('ArrowUp');await expect(input).toHaveValue('undo');await input.press('ArrowDown');await expect(input).toHaveValue('draft text');
 await input.press('Control+Backquote');await expect(terminal).toBeHidden();
});

test('uses typed and picked points, accepts canvas selection with Enter, and retains local command history',async({page})=>{
 await page.goto('/');const root=page.locator('#cad-root');await expect(root).toHaveAttribute('data-state','ready');
 const terminal=await openTerminal(page),input=terminal.getByRole('combobox',{name:'CAD command'});
 await input.fill('line');await input.press('Enter');const canvas=page.getByTestId('cad-canvas'),bounds=await canvas.boundingBox();expect(bounds).not.toBeNull();
 await canvas.click({position:{x:bounds!.width*.5,y:bounds!.height*.5}});await expect(terminal.getByRole('status')).toContainText('Next point');
 await input.fill('@10<90');await input.press('Enter');await expect.poll(async()=>Object.keys((await model(page)).sketches??{}).length).toBe(1);
 const sketch=Object.values((await model(page)).sketches)[0] as {profile:{points:number[][]}};expect(sketch.profile.points[1][0]).toBeCloseTo(sketch.profile.points[0][0]);expect(sketch.profile.points[1][1]-sketch.profile.points[0][1]).toBeCloseTo(10);
 await input.fill('box 10,10,10 0,0,5');await input.press('Enter');await expect(root).toHaveAttribute('data-state','ready');
 await input.fill('select');await input.press('Enter');await canvas.focus();await page.keyboard.press('Enter');await expect(input).toBeFocused();await expect(terminal.getByRole('status')).toContainText('Type help');
 await page.reload();await expect(root).toHaveAttribute('data-state','ready');await expect(terminal).toBeVisible();await input.focus();await input.press('ArrowUp');await expect(input).toHaveValue('select');
});

test('opens the persistent code workspace from the terminal without stealing source focus',async({page})=>{
 await page.goto('/');await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');const terminal=await openTerminal(page),input=terminal.getByRole('combobox',{name:'CAD command'});
 await input.fill('code');await input.press('Enter');const workspace=page.getByRole('dialog',{name:'CAD code workspace',exact:true});await expect(workspace).toBeVisible();await expect(workspace.getByLabel('CAD code source',{exact:true})).toBeFocused();
 await workspace.getByRole('button',{name:'Close code',exact:true}).click();await expect(input).toBeFocused();
});
