// SPDX-License-Identifier: BSD-3-Clause
import {expect,test} from '@playwright/test';
import {createCadSession} from '@brickwright/cad-core';
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
test('source preview solves dependent outlines and Apply saves the geometry with the source',async({page,hasTouch})=>{
 const session=createCadSession();
 session.setParametric({version:1,parameters:{width:{expression:'40',unit:'mm'},limit:{expression:'40',unit:'mm'}},bindings:[]});
 session.addSketchExtrusion({kind:'outline',id:'outline',points:[[0,0],[40,0],[40,20],[0,20]],vertexIds:['a','b','c','d'],relations:[
  {kind:'horizontal',edge:['a','b']},{kind:'length',edge:['a','b'],length:'width'},{kind:'length',edge:['a','b'],length:'limit'}
 ]},{name:'Source plate'});
 await page.addInitScript(raw=>localStorage.setItem('brickwright-cad:standalone:v1',raw),session.serialize());
 session.dispose();
 await page.goto('/');
 await ready(page);
 const before=await model(page);
 const press=async(name:string)=>{const button=page.getByRole('button',{name,exact:true});if(hasTouch)await button.tap();else await button.click();};
 const file=page.getByLabel('File menu',{exact:true});
 if(hasTouch)await file.tap();else await file.click();
 await press('Model source');
 const input=page.getByLabel('Design source',{exact:true}),status=page.getByRole('status',{name:'Model source status'});
 const draft=(await input.inputValue()).replace('expression: "40"','expression: "60"')+'\n// plate source note\n';
 await input.fill(draft);
 await input.blur();
 await press('Apply model source');
 await expect(status).toContainText('Could not solve');
 expect(await model(page)).toEqual(before);
 await expect(input).toHaveValue(draft);
 const valid=draft.replace('expression: "40"','expression: "60"');
 await input.fill(valid);
 await input.blur();
 await press('Preview model source');
 await expect(status).toContainText('No history entry');
 expect(await model(page)).toEqual(before);
 await press('Apply model source');
 await expect(status).toContainText('one history step');
 await expect.poll(async()=> (await model(page)).parametric.parameters.width.expression).toBe('60');
 const saved=await model(page);
 const sketchId=before.nodes[before.roots[0]].sketchId;
 expect(saved.sketches[sketchId].profile.points[1][0]).toBeCloseTo(60);
 expect(saved.sketches[sketchId].profile.vertexIds).toEqual(['a','b','c','d']);
 expect(saved.modelSource.source).toContain('// plate source note');
 await expect(input).toHaveValue(saved.modelSource.source);
 await press('Undo');
 await expect.poll(async()=>model(page)).toEqual(before);
});
