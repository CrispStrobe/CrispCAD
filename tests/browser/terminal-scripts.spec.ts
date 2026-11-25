// SPDX-License-Identifier: BSD-3-Clause
import {expect,test} from '@playwright/test';
import type {Locator,Page} from '@playwright/test';

const model=(page:Page)=>page.evaluate(()=>JSON.parse(localStorage.getItem('brickwright-cad:standalone:v1')!));
/** Pastes text as the clipboard would; a single-line input would otherwise drop the line breaks. */
const paste=(input:Locator,text:string)=>input.evaluate((element,value)=>{
 const data=new DataTransfer();data.setData('text/plain',value);
 element.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
},text);

test('a pasted multi-line script commits as one Undo step, repeats, and changes nothing when a line fails',async({page})=>{
 await page.goto('/');const root=page.locator('#cad-root');await expect(root).toHaveAttribute('data-state','ready');
 await page.getByRole('button',{name:'Terminal',exact:true}).click();
 const terminal=page.getByRole('region',{name:'CAD terminal',exact:true}),input=terminal.getByRole('combobox',{name:'CAD command'});
 await expect(terminal).toBeVisible();await input.focus();
 await paste(input,'// two parts\nbox 20,10,5 0,0,2.5\ncylinder 3 8 30,0,4\n\nselect all\nmove 0,0,0 @0,10,0\n');
 await expect(terminal.locator('.terminal-entry.output').last()).toHaveText('Script: 4 commands, committed as one Undo step.');
 await expect(input).toHaveValue('');await expect(input).toBeFocused();
 await expect.poll(async()=>(await model(page)).roots.length).toBe(2);
 const placed=await model(page);
 expect(Object.values(placed.nodes).map((node:any)=>node.transform.position[1])).toEqual([10,10]);
 await expect(terminal.locator('.terminal-entry.action').last()).toContainText('Run command script');
 // Undo removes the whole script; Redo restores it.
 await page.getByRole('button',{name:'Undo',exact:true}).click();await expect.poll(async()=>(await model(page)).roots.length).toBe(0);
 await page.getByRole('button',{name:'Redo',exact:true}).click();await expect.poll(async()=>(await model(page)).roots.length).toBe(2);
 // Empty Enter repeats the script as one more step.
 await input.press('Enter');await expect.poll(async()=>(await model(page)).roots.length).toBe(4);
 await input.fill('undo');await input.press('Enter');await expect.poll(async()=>(await model(page)).roots.length).toBe(2);
 await expect(root).toHaveAttribute('data-state','ready');
 const before=await model(page);
 await paste(input,'box 5,5,5\nfrobnicate 3');
 await expect(terminal.locator('.terminal-entry.error').last()).toHaveText('Line 2: Unknown command: frobnicate. Type help. The script changed nothing.');
 expect(await model(page)).toEqual(before);
 // Single-line input keeps prompting as before.
 await input.fill('box');await input.press('Enter');await expect(terminal.getByRole('status')).toContainText('Box dimensions');
 await input.press('Escape');expect(await model(page)).toEqual(before);
});
