// SPDX-License-Identifier: BSD-3-Clause
// The exact and drawing items of the editor's menu (editor-menu.ts) in the standalone toolbar's
// File and Edit menus, by touch on the `ipad` project: nothing under assets/exact/ is fetched
// until one runs; Measure exactly shows the kernel's volume; Fillet or chamfer chosen edges goes
// straight to picking edges in the 3D view; Export STEP opens the export dialog on STEP; the
// assembly drawing from exact edges opens with "Exact edges (B-rep)" on.
import {expect,test} from '@playwright/test';
import type {Locator,Page} from '@playwright/test';
import {createCadSession,serializeDocument} from '@brickwright/cad-core';

const STORAGE='brickwright-cad:standalone:v1';
async function run(page:Page,command:string,done:RegExp){
 const region=page.getByRole('region',{name:'CAD terminal',exact:true});
 if(!await region.isVisible())await page.getByRole('button',{name:'Terminal',exact:true}).click();
 const input=region.getByRole('combobox',{name:'CAD command'}),entries=region.locator('.terminal-entry'),before=await entries.count();
 await input.fill(command);await input.press('Enter');
 await expect.poll(async()=>(await entries.count())>before&&done.test((await entries.last().textContent())??''),{timeout:120_000}).toBe(true);
 await page.getByRole('button',{name:'Terminal',exact:true}).click();
}

test('exact items of the editor menu run from the File and Edit menus',async({page},info)=>{
 test.setTimeout(600_000);
 const touch=!!info.project.use.hasTouch,press=async(target:Locator)=>touch?target.tap():target.click();
 const session=createCadSession();
 session.add({kind:'box',size:[20,30,10]},{name:'Block',transform:{position:[0,0,5],rotation:[0,0,0],scale:[1,1,1]}});
 await page.addInitScript(([key,document])=>{if(!sessionStorage.getItem('seeded')){localStorage.setItem(key,document);sessionStorage.setItem('seeded','1');}},[STORAGE,serializeDocument(session.state.document)] as const);
 const exactRequests:string[]=[];page.on('request',request=>{if(request.url().includes('/assets/exact/'))exactRequests.push(request.url());});
 await page.goto('/');
 await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready',{timeout:120_000});
 const fileMenu=page.locator('summary[aria-label="File menu"]'),editMenu=page.locator('summary[aria-label="Edit menu"]');
 const item=(name:string)=>page.getByRole('button',{name,exact:true});

 // Present and enabled with a body, before any exact request.
 await press(fileMenu);
 for(const name of ['Import STEP as exact bodies…','Export STEP (exact B-rep)…','Assembly drawing…','Assembly drawing from exact edges…'])await expect(item(name)).toBeEnabled();
 await press(fileMenu);
 expect(exactRequests).toEqual([]);

 // Export STEP: the export dialog, on STEP.
 await press(fileMenu);await press(item('Export STEP (exact B-rep)…'));
 const exportDialog=page.getByRole('dialog',{name:'Export model'});
 await expect(exportDialog.getByRole('combobox',{name:'Export format'})).toHaveValue('step');
 await press(exportDialog.getByRole('button',{name:'Cancel export',exact:true}));
 expect(exactRequests).toEqual([]);

 // Measure exactly (all bodies): the kernel loads now.
 await press(editMenu);await press(item('Measure exactly'));
 const measure=page.getByRole('dialog',{name:'Exact measurements'});
 await expect(measure.locator('.exact-measure-output')).toContainText('volume 6000 mm³',{timeout:180_000});
 expect(exactRequests.some(url=>/smlibwasm-[^/]+\.wasm$/.test(url))).toBe(true);
 await press(measure.getByRole('button',{name:'Done',exact:true}));

 // Fillet or chamfer chosen edges: needs one body; goes on to the 3D view's edge picking.
 await press(editMenu);await expect(item('Fillet or chamfer chosen edges…')).toBeDisabled();await press(editMenu);
 await run(page,'select "Block"',/Select 1 object/);
 await press(editMenu);await press(item('Fillet or chamfer chosen edges…'));
 const bar=page.getByRole('toolbar',{name:'Edge picking'});
 await expect(bar).toBeVisible({timeout:120_000});
 await expect(page.getByTestId('cad-canvas')).toHaveAttribute('data-edge-pick','12');
 await press(bar.getByRole('button',{name:'Done',exact:true}));
 const feature=page.getByRole('dialog',{name:'Fillet, chamfer or shell'});
 await expect(feature.getByRole('combobox',{name:'Edges',exact:true})).toHaveValue('chosen');
 await press(feature.getByRole('button',{name:'Close exact feature',exact:true}));

 // Assembly drawing from exact edges: the drawing opens with the exact option on.
 await press(fileMenu);await press(item('Assembly drawing from exact edges…'));
 const drawing=page.getByRole('dialog',{name:'Drawing sheet'});
 await expect(drawing.getByRole('checkbox',{name:'Exact edges (B-rep)',exact:true})).toBeChecked();
});
