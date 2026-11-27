// SPDX-License-Identifier: BSD-3-Clause
// Fillet and chamfer of individual edges in the editor, by touch (run it on the `ipad` project):
// the Fillet, chamfer, shell dialog lists the body's B-rep edges from the exact kernel, two edges
// are tapped in the edge drawing, the chamfer is built, and after an upstream edit the stable edge
// references resolve again in the automatic "Recompute exact features" step. No keyboard is used
// for the picking itself.
import {expect,test} from '@playwright/test';
import type {Locator,Page} from '@playwright/test';
import {createCadSession,serializeDocument} from '@brickwright/cad-core';

const STORAGE='brickwright-cad:standalone:v1';
async function terminal(page:Page){
 const region=page.getByRole('region',{name:'CAD terminal',exact:true});
 if(!await region.isVisible())await page.getByRole('button',{name:'Terminal',exact:true}).click();
 await expect(region).toBeVisible();
 return {region,input:region.getByRole('combobox',{name:'CAD command'})};
}
async function run(page:Page,command:string,done:RegExp){
 const {region,input}=await terminal(page),entries=region.locator('.terminal-entry'),before=await entries.count();
 await input.fill(command);await input.press('Enter');
 await expect.poll(async()=>(await entries.count())>before&&done.test((await entries.last().textContent())??''),{timeout:120_000}).toBe(true);
 return (await entries.last().textContent())??'';
}
const press=async(target:Locator,touch:boolean)=>touch?target.tap():target.click();

test('tap two edges, chamfer them exactly, and keep them through an upstream edit',async({page},info)=>{
 test.setTimeout(300_000);
 const touch=!!info.project.use.hasTouch;
 const session=createCadSession();
 session.add({kind:'box',size:[20,30,10]},{name:'Block',transform:{position:[0,0,5],rotation:[0,0,0],scale:[1,1,1]}});
 await page.addInitScript(([key,document])=>{if(!sessionStorage.getItem('seeded')){localStorage.setItem(key,document);sessionStorage.setItem('seeded','1');}},[STORAGE,serializeDocument(session.state.document)] as const);
 await page.goto('/');
 const root=page.locator('#cad-root'),ready=()=>expect(root).toHaveAttribute('data-state','ready',{timeout:120_000});
 await ready();

 await run(page,'select "Block"',/Select 1 object/);
 await press(page.locator('summary[aria-label="Edit menu"]'),touch);
 await press(page.getByRole('button',{name:'Fillet, chamfer, shell',exact:true}),touch);
 const dialog=page.getByRole('dialog',{name:'Fillet, chamfer or shell'});
 await dialog.getByRole('combobox',{name:'Operation',exact:true}).selectOption('chamfer');
 await dialog.getByRole('spinbutton',{name:'Distance (mm)',exact:true}).fill('2');
 await dialog.getByRole('combobox',{name:'Edges',exact:true}).selectOption('chosen');
 // The exact kernel lists the 12 edges; each is a tap target in the drawing.
 const edges=dialog.getByRole('checkbox',{name:/^Edge \d+: /});
 await expect(edges).toHaveCount(12,{timeout:120_000});
 const long=dialog.getByRole('checkbox',{name:/: line, 30 mm$/});
 await expect(long).toHaveCount(4);
 // Turn the drawing to the front view and back: the targets stay tappable.
 await press(dialog.getByRole('button',{name:'Front',exact:true}),touch);
 await press(dialog.getByRole('button',{name:'Iso',exact:true}),touch);
 await press(long.nth(0),touch);
 await press(long.nth(1),touch);
 await expect(long.nth(0)).toHaveAttribute('aria-checked','true');
 await expect(dialog.getByText('2 edges chosen')).toBeVisible();
 // Tapping a chosen edge again takes it off; tap it once more to keep it.
 await press(long.nth(1),touch);
 await expect(dialog.getByText('1 edges chosen')).toBeVisible();
 await press(long.nth(1),touch);
 const box=await dialog.locator('.edge-picker-views button').first().boundingBox();
 expect(box!.height).toBeGreaterThanOrEqual(44);
 await press(dialog.getByRole('button',{name:'Apply exact feature'}),touch);
 await expect(dialog).toBeHidden({timeout:120_000});
 await ready();
 await expect(page.getByTestId('object-name').filter({hasText:'Chamfer of Block'})).toBeVisible();
 // Two parallel 30 mm edges bevelled by 2: 6000 − 2 · ½ · 2² · 30.
 expect(await run(page,'measure exact "Chamfer of Block"',/volume/)).toMatch(/volume 5880 mm³/);

 // Upstream edit: make the block taller. The stable references resolve on the new B-rep.
 const input=page.getByRole('button',{name:'Block',exact:true});
 if(!await input.isVisible())await page.getByText('Inputs',{exact:true}).first().click();
 await input.click();
 const height=page.getByLabel('Height (mm)',{exact:true});
 await height.fill('14');await height.press('Enter');
 const {region}=await terminal(page),actions=region.locator('.terminal-entry');
 await expect(actions.filter({hasText:'Recompute exact features'})).toHaveCount(1,{timeout:120_000});
 await ready();
 expect(await run(page,'measure exact all',/volume/)).toMatch(/volume 8280 mm³/);

 // The terminal lists the edges the same way, and the dialog of the feature shows the choice.
 expect(await run(page,'edges "Chamfer of Block"',/edges/)).toMatch(/Chamfer of Block \(.+\): \d+ edges/);
 await run(page,'select "Chamfer of Block"',/Select 1 object/);
 await page.getByRole('button',{name:'Edit exact feature'}).click();
 const edit=page.getByRole('dialog',{name:'Edit exact feature'});
 await expect(edit.getByRole('checkbox',{name:/^Edge \d+: /})).toHaveCount(12,{timeout:120_000});
 await expect(edit.getByText('2 edges chosen')).toBeVisible();
});
