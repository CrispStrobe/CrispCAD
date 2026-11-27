// SPDX-License-Identifier: BSD-3-Clause
// Phase 6.5 smaller tools in the editor by touch (run it on the `ipad` project): Split body with
// the plane picked by one tap on a face, then Materials and mass, Inspect surface blends (a blend
// marked in the 3D view) and STEP evidence (a round trip of the model, and a chosen file). The
// inspections read the model and add no history entry.
import {expect,test} from '@playwright/test';
import type {Locator,Page} from '@playwright/test';
import {createCadSession,serializeDocument} from '@brickwright/cad-core';
import {createExactBackend} from '@brickwright/cad-exact';

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

test('split a body by tapping a face, then inspect materials, blends and STEP evidence',async({page},info)=>{
 test.setTimeout(600_000);
 const touch=!!info.project.use.hasTouch,press=async(target:Locator)=>touch?target.tap():target.click();
 const session=createCadSession();
 session.add({kind:'box',size:[40,30,20]},{name:'Block',transform:{position:[0,0,10],rotation:[0,0,0],scale:[1,1,1]}});
 const insert=session.add({kind:'box',size:[10,10,10]},{name:'Insert',color:'#aa3333',transform:{position:[60,0,5],rotation:[0,0,0],scale:[1,1,1]}});
 session.applyPhysicsMaterial('steel',[insert]);
 await page.addInitScript(([key,document])=>{if(!sessionStorage.getItem('seeded')){localStorage.setItem(key,document);sessionStorage.setItem('seeded','1');}},[STORAGE,serializeDocument(session.state.document)] as const);
 await page.goto('/');
 const root=page.locator('#cad-root'),ready=()=>expect(root).toHaveAttribute('data-state','ready',{timeout:120_000});
 await ready();
 await run(page,'select "Block"',/Select 1 object/);
 const palette=page.getByRole('dialog',{name:'Command palette'});
 const openPalette=async(search:string,option:string)=>{
  await press(page.getByRole('button',{name:'Command palette',exact:true}));
  await palette.getByRole('combobox',{name:'Search CAD commands'}).fill(search);
  await press(palette.getByRole('option',{name:option}));
 };

 // Split body: pick the plane on the top face, move it down to z = 8, split.
 await run(page,'top',/./).catch(()=>undefined);
 await run(page,'fit',/./).catch(()=>undefined); // frames the selected block
 await openPalette('split','Split body');
 const split=page.getByRole('dialog',{name:'Split body'});
 await expect(split).toBeVisible();
 for(const control of [split.getByRole('button',{name:'Pick the plane on a face'}),split.getByRole('button',{name:'Split body'}),split.getByRole('combobox',{name:'Plane normal'})])
  expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
 await press(split.getByRole('button',{name:'Pick the plane on a face'}));
 await expect(split).toBeHidden();
 const canvas=page.getByTestId('cad-canvas'),box=(await canvas.boundingBox())!;
 if(touch)await page.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);else await page.mouse.click(box.x+box.width/2,box.y+box.height/2);
 await expect(split).toBeVisible();
 await expect(split.getByRole('combobox',{name:'Plane normal'})).toHaveValue('z');
 await expect(split.getByRole('textbox',{name:'Offset along the normal (mm)'})).toHaveValue('20');
 await split.getByRole('textbox',{name:'Offset along the normal (mm)'}).fill('8');
 await press(split.getByRole('button',{name:'Split body'}));
 await expect(split).toBeHidden({timeout:120_000});
 await ready();
 const listed=await run(page,'list',/Block \(\+ side\)/);
 expect(listed).toContain('Block (− side)');
 const measured=await run(page,'measure exact all',/Exact measures/);
 expect(measured).toMatch(/Block \(\+ side\) .*volume 14400 mm³/);
 expect(measured).toMatch(/Block \(− side\) .*volume 9600 mm³/);
 const iterations=await page.getByLabel('Model iteration',{exact:true}).locator('option').count();

 // Materials and mass: the steel insert weighs 7.8 g.
 await openPalette('filament','Materials and mass');
 const materials=page.getByRole('dialog',{name:'Materials and mass'});
 await expect(materials).toContainText('Steel',{timeout:60_000});
 await expect(materials).toContainText('7.8');
 await expect(materials.locator('table').first().locator('tbody tr')).toHaveCount(3);
 await press(materials.getByRole('button',{name:'Close',exact:true}));
 await expect(materials).toBeHidden();

 // Surface blends: round the insert's edges, then mark a round in the 3D view.
 await run(page,'fillet 1 Insert',/Exact fillet/);
 await ready();
 const afterFillet=await page.getByLabel('Model iteration',{exact:true}).locator('option').count();
 expect(afterFillet).toBeGreaterThan(iterations);
 await openPalette('tangency','Inspect surface blends');
 const blends=page.getByRole('dialog',{name:'Inspect surface blends'});
 const rounds=blends.locator('button.manufacturing-finding[data-kind="round"]');
 await expect(rounds.first()).toBeVisible({timeout:120_000});
 await expect(rounds.first()).toContainText('Round R1');
 await expect(blends).toContainText(/Modelled fillet .* R1: \d+ matching blends/);
 await press(rounds.first());
 await expect(blends).toBeHidden();
 const bar=page.getByRole('toolbar',{name:'Surface blend'});
 await expect(bar).toContainText('1/');
 await expect(page.locator('canvas[data-finding]')).toHaveCount(1);
 await press(bar.getByRole('button',{name:'Done',exact:true}));
 await expect(page.locator('canvas[data-finding]')).toHaveCount(0);

 // STEP evidence: a round trip of the model, then a chosen file.
 await openPalette('round trip','STEP evidence');
 const evidence=page.getByRole('dialog',{name:'STEP evidence'});
 await press(evidence.getByRole('button',{name:'Round trip of the model'}));
 await expect(evidence).toContainText('Round trip: every body reads back within',{timeout:120_000});
 await expect(evidence).toContainText('SHA-256');
 const backend=await createExactBackend(),lone=createCadSession();
 lone.add({kind:'cylinder',radius:5,height:10,segments:48},{name:'Pin'});
 const step=backend.exportStep(lone.state.document).step;
 const chooser=page.waitForEvent('filechooser');
 await press(evidence.getByRole('button',{name:'Choose a STEP file…'}));
 await (await chooser).setFiles({name:'pin.step',mimeType:'model/step',buffer:Buffer.from(step)});
 await expect(evidence).toContainText('pin.step',{timeout:120_000});
 await expect(evidence).toContainText('cylinder');
 await expect(evidence).toContainText('valid solid');
 await press(evidence.getByRole('button',{name:'Close',exact:true}));

 // The inspections added no history entry.
 expect(await page.getByLabel('Model iteration',{exact:true}).locator('option').count()).toBe(afterFillet);
 await expect(root).not.toHaveAttribute('data-state','error');
});
