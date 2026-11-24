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

test('completes body arguments and selection prompts without changing the model',async({page})=>{
 await page.goto('/');const root=page.locator('#cad-root');await expect(root).toHaveAttribute('data-state','ready');
 const terminal=await openTerminal(page),input=terminal.getByRole('combobox',{name:'CAD command'});
 for(const command of ['box 10,10,10 0,0,5','sphere 3 20,0,3']){await input.fill(command);await input.press('Enter');await expect(root).toHaveAttribute('data-state','ready');}
 await expect.poll(async()=>(await model(page)).roots.length).toBe(2);const before=await model(page);
 await input.fill('select ');const choices=terminal.getByRole('option');await expect(choices).toHaveCount(6);
 const last=(await choices.last().innerText()).split(' — ')[0];await input.press('Shift+Tab');await expect(input).toHaveValue('select '+last+' ');
 await expect(terminal.locator('[role="option"][aria-selected="true"]')).toHaveCount(1);await expect(input).toHaveAttribute('aria-activedescendant',/./);
 await input.fill('sel bo');await input.press('Tab');await expect(input).toHaveValue('sel "Box" ');expect(await model(page)).toEqual(before);
 await input.press('Enter');await input.fill('move 0,0,0 4,5,0');await input.press('Enter');
 await expect.poll(async()=>(await model(page)).nodes[before.roots[0]].transform.position).toEqual([4,5,5]);
 expect((await model(page)).nodes[before.roots[1]].transform.position).toEqual([20,0,3]);
 await input.fill('select');await input.press('Enter');await input.fill('Sph');await input.press('Tab');await expect(input).toHaveValue('"Sphere" ');
 const priorSelection=await model(page);await input.press('Enter');expect(await model(page)).toEqual(priorSelection);
 await input.fill('help cy');await input.press('Tab');await expect(input).toHaveValue('help cylinder ');await input.press('Enter');await expect(terminal.locator('.terminal-entry.output').last()).toContainText('cylinder [radius]');
});

test('completes a closed sketch at a prompt and preserves a later height argument',async({page})=>{
 await page.goto('/');const root=page.locator('#cad-root');await expect(root).toHaveAttribute('data-state','ready');
 const terminal=await openTerminal(page),input=terminal.getByRole('combobox',{name:'CAD command'});
 for(const command of ['rect 0,0 20,30','line 0,0 10,0']){await input.fill(command);await input.press('Enter');}
 await expect.poll(async()=>Object.keys((await model(page)).sketches??{}).length).toBe(2);
 const before=await model(page);await input.fill('extrude');await input.press('Enter');
 await expect(terminal.getByRole('option').filter({hasText:/^Line —/})).toHaveCount(0);
 await input.fill('Rec');await input.press('Tab');await expect(input).toHaveValue('"Rectangle" ');expect(await model(page)).toEqual(before);
 await input.press('Enter');await expect(terminal.getByRole('status')).toContainText('Height');await input.fill('5');await input.press('Enter');
 await expect.poll(async()=>(await model(page)).roots.length).toBe(1);await input.fill('undo');await input.press('Enter');await expect.poll(async()=>(await model(page)).roots.length).toBe(0);
 await input.fill('ex "Rec" 7');await input.evaluate(node=>(node as HTMLInputElement).setSelectionRange(7,7));await input.press('Tab');
 await expect(input).toHaveValue('ex "Rectangle" 7');expect((await model(page)).roots).toHaveLength(0);await input.press('Enter');
 await expect.poll(async()=>(await model(page)).roots.length).toBe(1);const after=await model(page);expect(after.nodes[after.roots[0]].distance).toBe(7);
});
