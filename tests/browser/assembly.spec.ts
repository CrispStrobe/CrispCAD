// SPDX-License-Identifier: BSD-3-Clause
// Assemblies in the editor by touch (run it on the `ipad` project): the planetary gear set's group
// in the Assembly dialog, suppressing and restoring a body, a configuration saved, the exploded
// view shown on the slider over the 3D view and played, and the mechanism check sweeping the sun
// gear with its planets and ring. No keyboard is needed.
import {expect,test} from '@playwright/test';
import type {Locator,Page} from '@playwright/test';
import {createPlanetaryDocument,serializeDocument} from '@brickwright/cad-core';

const STORAGE='brickwright-cad:standalone:v1';
// The planetary set's first build (five gears and a ring) and the sweeps take a while on a loaded machine.
test.describe.configure({timeout:600_000});
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

test('groups, suppression, configurations, exploded view and mechanism check of a planetary gear set',async({page},info)=>{
 test.setTimeout(600_000);
 const touch=!!info.project.use.hasTouch,press=async(target:Locator)=>touch?target.tap():target.click();
 await page.addInitScript(([key,document])=>{if(!sessionStorage.getItem('seeded')){localStorage.setItem(key,document);sessionStorage.setItem('seeded','1');}},[STORAGE,serializeDocument(createPlanetaryDocument())] as const);
 await page.goto('/');
 const root=page.locator('#cad-root');
 // On a heavily loaded machine the very first build (worker start, Manifold compile) can exceed the
 // editor's 30 s geometry budget; that is the budget working, so load the page again.
 for(let attempt=0;;attempt++){
  await expect(root).toHaveAttribute('data-state',/ready|error/,{timeout:180_000});
  if(await root.getAttribute('data-state')==='ready')break;
  expect(attempt,'the planetary set never built').toBeLessThan(3);
  await page.reload();
 }
 const canvas=page.getByTestId('cad-canvas');

 // Command palette › Assembly.
 const palette=page.getByRole('dialog',{name:'Command palette'});
 const openPalette=async(search:string,option:string)=>{
  await press(page.getByRole('button',{name:'Command palette',exact:true}));
  await palette.getByRole('combobox',{name:'Search CAD commands'}).fill(search);
  await press(palette.getByRole('option',{name:option,exact:true}));
 };
 await openPalette('groups','Assembly');
 const dialog=page.getByRole('dialog',{name:'Assembly'});
 await expect(dialog).toBeVisible();
 await expect(dialog.getByRole('button',{name:'▸ Planetary gear set (6)'})).toBeVisible();
 for(const control of [dialog.getByRole('tab',{name:'Exploded view'}),dialog.getByRole('button',{name:'Group selected bodies'})])
  expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);

 // Suppress the ring gear: it leaves the model; put it back.
 const ring=dialog.locator('.assembly-body-row').filter({hasText:'Ring gear'});
 await press(ring.getByRole('button',{name:'Suppress'}));
 await expect(dialog.locator('.assembly-status')).toHaveText('Ring gear is suppressed.');
 await expect(ring.getByRole('button',{name:'Unsuppress'})).toBeVisible();

 // Save this as a configuration, put the ring back, and switch to the configuration again.
 await press(dialog.getByRole('tab',{name:'Configurations'}));
 await dialog.getByRole('textbox',{name:'Configuration name'}).fill('Without ring');
 await press(dialog.getByRole('button',{name:'Save current as configuration'}));
 await expect(dialog.locator('[data-configuration="Without ring"]')).toContainText('✓ Without ring');
 await expect(dialog.locator('[data-configuration="Without ring"]')).toContainText('1 suppressed');
 await press(dialog.getByRole('tab',{name:'Groups'}));
 await press(dialog.locator('.assembly-body-row').filter({hasText:'Ring gear'}).getByRole('button',{name:'Unsuppress'}));
 await expect(dialog.locator('.assembly-status')).toHaveText('Ring gear is back in the model.');
 await press(dialog.getByRole('tab',{name:'Configurations'}));
 await press(dialog.locator('[data-configuration="Without ring"]').getByRole('button',{name:'Use'}));
 await expect(dialog.locator('.assembly-status')).toHaveText('Switched to the configuration Without ring.');
 await press(dialog.getByRole('tab',{name:'Groups'}));
 await press(dialog.locator('.assembly-body-row').filter({hasText:'Ring gear'}).getByRole('button',{name:'Unsuppress'}));

 // The exploded view on the bar: shown fully exploded, slid back half way, played, done.
 await press(dialog.getByRole('tab',{name:'Exploded view'}));
 await press(dialog.locator('[data-view]').first().getByRole('button',{name:'Show'}));
 await expect(dialog).toBeHidden();
 const bar=page.getByRole('toolbar',{name:'Assembly presentation'});
 await expect(bar).toBeVisible();
 await expect(bar).toContainText('Exploded view: 100 %');
 await expect(canvas).toHaveAttribute('data-presented','5');
 await bar.getByRole('slider',{name:'Explosion'}).fill('300');
 await expect(bar).toContainText('Exploded view: 30 %');
 // At 30 % only the first of three steps (the ring) has moved.
 await expect(canvas).toHaveAttribute('data-presented','1');
 await press(bar.getByRole('button',{name:'Play'}));
 await expect(bar).toHaveAttribute('data-value','1.000',{timeout:20_000});
 await press(bar.getByRole('button',{name:'Done'}));
 await expect(bar).toBeHidden();
 await expect(canvas).toHaveAttribute('data-presented','0');

 // The mechanism check: the sun (motor A) over one tooth pitch, its planets and ring with it.
 await openPalette('mechanism','Check mechanism');
 await expect(dialog).toBeVisible();
 await dialog.getByRole('spinbutton',{name:'From'}).fill('0');
 await dialog.getByRole('spinbutton',{name:'To'}).fill('30');
 await dialog.getByRole('spinbutton',{name:'Steps'}).fill('3');
 await press(dialog.getByRole('button',{name:'Check mechanism'}));
 await expect(dialog.locator('.assembly-results')).toContainText('No collisions at any sampled pose.',{timeout:180_000});
 await expect(dialog.locator('.assembly-results')).toContainText('4 gears turned through meshes');
 // The pose on the slider: the sun turned, the coupled gears with it.
 await press(dialog.getByRole('button',{name:'Move on a slider'}));
 await bar.getByRole('slider',{name:'Explosion'}).fill('500');
 await expect(bar).toContainText('Joint pose: 15.0°');
 await expect(canvas).toHaveAttribute('data-presented','5');
 await press(bar.getByRole('button',{name:'Done'}));

 // Everything above changed the model through Undo-able steps; the terminal lists the assembly.
 const listing=await run(page,'groups',/Planetary gear set/);
 expect(listing).toMatch(/Exploded views: Exploded view \(3\)/);
 expect(listing).toMatch(/Configurations: Without ring ✓/);
});
