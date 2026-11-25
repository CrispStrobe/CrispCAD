// SPDX-License-Identifier: BSD-3-Clause
// Exact fillet, chamfer and shell in the editor: the Edit menu dialog builds the feature on the
// lazily loaded exact kernel, the Manifold viewport shows its display mesh, an upstream edit is
// followed by one attributed "Recompute exact features" step, and Undo/Redo and saving keep it.
import {expect,test} from '@playwright/test';
import type {Page} from '@playwright/test';
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

test('chamfer a body from the Edit menu, recompute it after an upstream edit, and keep it through Undo and Redo',async({page})=>{
 test.setTimeout(300_000);
 const session=createCadSession();
 session.add({kind:'box',size:[20,30,10]},{name:'Block',transform:{position:[0,0,5],rotation:[0,0,0],scale:[1,1,1]}});
 await page.addInitScript(([key,document])=>{if(!sessionStorage.getItem('seeded')){localStorage.setItem(key,document);sessionStorage.setItem('seeded','1');}},[STORAGE,serializeDocument(session.state.document)] as const);
 const requests:string[]=[];page.on('request',request=>requests.push(new URL(request.url()).pathname));
 await page.goto('/');
 const root=page.locator('#cad-root'),ready=()=>expect(root).toHaveAttribute('data-state','ready',{timeout:120_000});
 await ready();
 expect(requests.filter(path=>path.includes('/assets/exact/'))).toEqual([]);

 await run(page,'select "Block"',/Select 1 object/);
 const editMenu=page.locator('summary[aria-label="Edit menu"]');
 await editMenu.click();
 await page.getByRole('button',{name:'Fillet, chamfer, shell',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Fillet, chamfer or shell'});
 await dialog.getByRole('combobox',{name:'Operation',exact:true}).selectOption('chamfer');
 await dialog.getByRole('spinbutton',{name:'Distance (mm)',exact:true}).fill('2');
 await dialog.getByRole('combobox',{name:'Edges',exact:true}).selectOption('+z');
 await dialog.getByRole('button',{name:'Apply exact feature'}).click();
 await expect(dialog).toBeHidden({timeout:120_000});
 await ready();
 expect(requests.some(path=>/\/assets\/exact\/smlibwasm-[^/]+\.wasm$/.test(path))).toBe(true);
 await expect(page.getByTestId('object-name').filter({hasText:'Chamfer of Block'})).toBeVisible();
 // A flat-faced result: the display mesh is the exact volume, 6000 − 2²·50 + 4/3·2³.
 expect(await run(page,'measure exact "Chamfer of Block"',/volume/)).toMatch(/volume 5810\.66666667 mm³/);
 await expect(page.getByText('up to date')).toBeVisible();

 // Upstream edit: make the source block taller. The editor recomputes the chamfer once.
 const input=page.getByRole('button',{name:'Block',exact:true});
 if(!await input.isVisible())await page.getByText('Inputs',{exact:true}).first().click();
 await input.click();
 const height=page.getByLabel('Height (mm)',{exact:true});
 await height.fill('14');await height.press('Enter');
 // The terminal transcript shows each accepted commit: the user's edit, then the recompute.
 const {region}=await terminal(page),actions=region.locator('.terminal-entry');
 await expect(actions.filter({hasText:'Recompute exact features'})).toHaveCount(1,{timeout:120_000});
 await expect(actions.filter({hasText:'Edit object'})).toHaveCount(1);
 await ready();
 await expect(root).not.toHaveAttribute('data-state','error');
 expect(await run(page,'measure exact all',/volume/)).toMatch(/volume 8210\.66666667 mm³/);

 // Undo the recompute: the stale mesh is refused with an actionable message, and not recomputed again.
 await page.getByRole('button',{name:'Undo',exact:true}).click();
 await expect(root).toHaveAttribute('data-state','error');
 await expect(page.getByText(/out of date after an upstream change\. Recompute it with the exact kernel/)).toBeVisible();
 await page.getByRole('button',{name:'Redo',exact:true}).click();
 await ready();
 expect(await run(page,'recompute exact',/up to date/)).toContain('Every exact feature is up to date.');
});
