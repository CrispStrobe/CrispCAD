// SPDX-License-Identifier: BSD-3-Clause
import {expect,test} from '@playwright/test';
import {addShape} from './ui.js';
const key='brickwright-cad:standalone:v1';
const ready=async(page:any)=>expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');
const model=async(page:any)=>page.evaluate((key:string)=>JSON.parse(localStorage.getItem(key)!),key);
const open=async(page:any)=>{await page.getByLabel('File menu',{exact:true}).click();await page.getByRole('button',{name:'Model source',exact:true}).click();return page.getByLabel('Design source',{exact:true});};
test('GUI edits patch source and a source edit commits one history step without blocking the canvas',async({page})=>{
 await page.goto('/');await ready(page);await addShape(page,'Box');await ready(page);const before=await model(page),id=before.roots[0],field=await open(page);await expect(field).toBeVisible();
 const canvas=page.getByTestId('cad-canvas');expect((await canvas.boundingBox())!.height).toBeGreaterThan(100);expect((await canvas.boundingBox())!.width).toBeGreaterThan(100);
 const prior=before.nodes[id].size,changed=[50,prior[1],prior[2]],source=await field.inputValue();await field.fill(source.replace(`size: [${prior.join(', ')}]`,`size: [${changed.join(', ')}]`)+'\n// keep this design note\n');
 await page.getByRole('button',{name:'Preview model source',exact:true}).click();await expect(page.getByLabel('Model source status',{exact:true})).toContainText('No history entry');expect((await model(page)).nodes[id].size).toEqual(prior);
 await page.getByRole('button',{name:'Apply model source',exact:true}).click();await expect(page.getByLabel('Model source status',{exact:true})).toContainText('one history step');await ready(page);await expect.poll(async()=>(await model(page)).nodes[id].size[0]).toBe(50);
 expect((await model(page)).modelSource.source).toContain('// keep this design note');
 await page.getByRole('button',{name:'Move',exact:true}).click();await page.getByLabel('Position X',{exact:true}).fill('17');await page.getByLabel('Position X',{exact:true}).press('Tab');await ready(page);await expect(field).toHaveValue(/position: \[17,/);await expect(field).toHaveValue(/keep this design note/);
 await addShape(page,'Sphere');await ready(page);await expect(field).toHaveValue(/sphere\(/);expect((await model(page)).roots.length).toBe(2);
 await page.reload();await ready(page);const reopened=await open(page);await expect(reopened).toHaveValue(/keep this design note/);await expect(reopened).toHaveValue(/position: \[17,/);
});
test('dirty source is kept when the GUI changes and invalid drafts never replace saved models',async({page})=>{
 await page.goto('/');await ready(page);await addShape(page,'Box');await ready(page);const field=await open(page),draft=(await field.inputValue())+'\n// my pending draft';await field.fill(draft);
 await addShape(page,'Sphere');await ready(page);await expect(field).toHaveValue(draft);await expect(page.getByLabel('Model source status',{exact:true})).toContainText('changed while editing');const saved=await model(page);
 await page.getByRole('button',{name:'Apply model source',exact:true}).click();await expect(page.getByLabel('Model source status',{exact:true})).toContainText('changed while editing');expect((await model(page)).roots).toEqual(saved.roots);
 await page.getByRole('button',{name:'Merge GUI changes',exact:true}).click();await expect(page.getByLabel('Model source status',{exact:true})).toContainText('merged into the draft');await expect(field).toHaveValue(/my pending draft/);await expect(field).toHaveValue(/sphere\(/);await page.getByRole('button',{name:'Apply model source',exact:true}).click();await expect(page.getByLabel('Model source status',{exact:true})).toContainText('one history step');
 await page.getByRole('button',{name:'Reload model source',exact:true}).click();await field.fill('globalThis.alert("no");');await page.getByRole('button',{name:'Apply model source',exact:true}).click();await expect(page.getByLabel('Model source status',{exact:true})).toContainText('declarative');expect((await model(page)).roots).toEqual(saved.roots);
});
test('Code an object can create once and continue in synchronized model source',async({page})=>{
 await page.goto('/');await ready(page);await page.getByRole('button',{name:'Code',exact:true}).click();await page.getByRole('button',{name:'Create & show model source',exact:true}).click();await ready(page);
 const field=page.getByLabel('Design source',{exact:true});await expect(field).toBeVisible();await expect(field).toHaveValue(/cad`/);expect((await model(page)).roots.length).toBe(1);
});
