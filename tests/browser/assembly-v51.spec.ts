// SPDX-License-Identifier: BSD-3-Clause
// Assemblies, document version 51, in the editor by touch (run it on the `ipad` project): a group
// renamed in the Assembly dialog itself (no browser prompt), linked copies of a body placed and one
// unlinked, and a coincident mate added from two faces the exact kernel lists, which moves the lid
// onto the base. No keyboard is needed beyond typing the new name.
import {expect,test} from '@playwright/test';
import type {Locator,Page} from '@playwright/test';
import {createCadSession,createDocument,identityTransform,serializeDocument} from '@brickwright/cad-core';

const STORAGE='brickwright-cad:standalone:v1';
test.describe.configure({timeout:600_000});

function seed(){
 const s=createCadSession(createDocument('Housing test'));
 const base=s.add({kind:'box',size:[40,40,10]},{name:'Base',transform:{...identityTransform(),position:[0,0,5]}});
 const lid=s.add({kind:'box',size:[30,30,4]},{name:'Lid',transform:{...identityTransform(),position:[60,0,25]}});
 s.groupBodies('Housing',[base,lid]);
 return serializeDocument(s.state.document);
}
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
/** The value of the first option whose label contains `text`. */
const optionValue=async(select:Locator,text:string)=>(await select.locator('option',{hasText:text}).first().getAttribute('value'))!;

test('renames a group in place, places linked copies and mates two faces',async({page},info)=>{
 const touch=!!info.project.use.hasTouch,press=async(target:Locator)=>touch?target.tap():target.click();
 const prompts:string[]=[];page.on('dialog',dialog=>{prompts.push(dialog.type());void dialog.dismiss();});
 await page.addInitScript(([key,document])=>{if(!sessionStorage.getItem('seeded')){localStorage.setItem(key,document);sessionStorage.setItem('seeded','1');}},[STORAGE,seed()] as const);
 await page.goto('/');
 const root=page.locator('#cad-root');
 for(let attempt=0;;attempt++){
  await expect(root).toHaveAttribute('data-state',/ready|error/,{timeout:180_000});
  if(await root.getAttribute('data-state')==='ready')break;
  expect(attempt,'the design never built').toBeLessThan(3);
  await page.reload();
 }
 const palette=page.getByRole('dialog',{name:'Command palette'});
 await press(page.getByRole('button',{name:'Command palette',exact:true}));
 await palette.getByRole('combobox',{name:'Search CAD commands'}).fill('groups');
 await press(palette.getByRole('option',{name:'Assembly',exact:true}));
 const dialog=page.getByRole('dialog',{name:'Assembly'}),status=dialog.locator('.assembly-status');
 await expect(dialog.getByRole('button',{name:'▸ Housing (2)'})).toBeVisible();

 // Rename in place: a field with Save and Cancel inside the dialog, no window.prompt.
 await press(dialog.locator('[data-group]').getByRole('button',{name:'Rename'}));
 const field=dialog.getByRole('textbox',{name:'New group name'});
 await expect(field).toBeVisible();
 await expect(field).toHaveValue('Housing');
 await press(dialog.getByRole('button',{name:'Cancel'}));
 await expect(field).toBeHidden();
 await press(dialog.locator('[data-group]').getByRole('button',{name:'Rename'}));
 await field.fill('Enclosure');
 const save=dialog.getByRole('button',{name:'Save',exact:true});
 expect((await save.boundingBox())!.height).toBeGreaterThanOrEqual(44);
 await press(save);
 await expect(status).toHaveText('Renamed the group to Enclosure.');
 await expect(dialog.getByRole('button',{name:'▸ Enclosure (2)'})).toBeVisible();
 expect(prompts).toEqual([]);

 // Two linked copies of the lid, side by side; one of them unlinked again.
 await press(dialog.locator('.assembly-body-row').filter({hasText:'Lid'}).getByRole('button',{name:'Lid',exact:true}));
 await dialog.getByRole('spinbutton',{name:'Linked copies'}).fill('2');
 await press(dialog.getByRole('button',{name:'Linked copies of the selected body'}));
 await expect(status).toHaveText('Placed 2 linked instances of Lid: editing the part changes every instance.');
 await expect(dialog.locator('[data-instance]')).toHaveCount(2);
 await expect(dialog.locator('[data-instance]').first()).toContainText('Lid instance (linked to Lid)');
 await press(dialog.locator('[data-instance]').last().getByRole('button',{name:'Unlink'}));
 await expect(status).toHaveText('Lid instance 2 is now an independent copy of Lid.');
 await expect(dialog.locator('[data-instance]')).toHaveCount(1);

 // A coincident mate: the lid's underside onto the base's top face.
 await press(dialog.getByRole('tab',{name:'Mates'}));
 await expect(dialog.getByText('No mates yet.')).toBeVisible();
 await press(dialog.getByRole('button',{name:'Load faces'}));
 await expect(status).toHaveText(/bodies: choose a face of each\./,{timeout:180_000});
 const firstBody=dialog.getByRole('combobox',{name:'First body'}),secondBody=dialog.getByRole('combobox',{name:'Second body'});
 const firstFace=dialog.getByRole('combobox',{name:'First face'}),secondFace=dialog.getByRole('combobox',{name:'Second face'});
 await firstBody.selectOption({label:'Base'});
 await secondBody.selectOption({label:'Lid'});
 await firstFace.selectOption(await optionValue(firstFace,'↑ 0, 0, 1'));
 await secondFace.selectOption(await optionValue(secondFace,'↑ 0, 0, -1'));
 await press(dialog.getByRole('button',{name:'Add mate'}));
 await expect(status).toContainText('1 mates hold; 1 bodies moved: Lid.',{timeout:180_000});
 await expect(dialog.locator('[data-mate]')).toHaveCount(1);
 await expect(dialog.locator('[data-mate]')).toContainText('Mate 1 (coincident): Base – Lid');

 // The terminal sees the same model: the mate, the renamed group and the instance.
 await press(dialog.getByRole('button',{name:'Close',exact:true}));
 await expect(dialog).toBeHidden();
 const mates=await run(page,'mate',/coincident/);
 expect(mates).toMatch(/1\. coincident: Base [\w-]+:f\d+ – Lid [\w-]+:f\d+/);
 const groups=await run(page,'groups',/Enclosure/);
 expect(groups).toMatch(/Lid instance/);
});
