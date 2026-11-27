// SPDX-License-Identifier: BSD-3-Clause
// Hole-driven fastening in the editor by touch (run it on the `ipad` project): the Standard hole
// dialog from the command palette, "Pick on a face" drills where a finger taps the top of a plate
// and reads the wall thickness for a through hole, the exact kernel measures the counterbored
// plate, Fasten holes places an ISO 4762 screw with washer and nut, and Standard parts inserts an
// ISO 4032 nut. No keyboard is needed for the dialogs.
import {expect,test} from '@playwright/test';
import type {Locator,Page} from '@playwright/test';
import {COUNTERBORE_4762,HOLE_ENTRY_MM,createCadSession,holeCutterVolume,serializeDocument,standardHole} from '@brickwright/cad-core';

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

test('drill a counterbored hole by tapping a face, fasten it and insert a standard part',async({page},info)=>{
 test.setTimeout(600_000);
 const touch=!!info.project.use.hasTouch,press=async(target:Locator)=>touch?target.tap():target.click();
 const session=createCadSession();
 session.add({kind:'box',size:[40,40,10]},{name:'Plate',transform:{position:[0,0,5],rotation:[0,0,0],scale:[1,1,1]}});
 await page.addInitScript(([key,document])=>{if(!sessionStorage.getItem('seeded')){localStorage.setItem(key,document);sessionStorage.setItem('seeded','1');}},[STORAGE,serializeDocument(session.state.document)] as const);
 await page.goto('/');
 const root=page.locator('#cad-root'),ready=()=>expect(root).toHaveAttribute('data-state','ready',{timeout:120_000});
 await ready();
 await run(page,'top',/./).catch(()=>undefined);
 await run(page,'select "Plate"',/Select 1 object/);

 // Command palette › Standard hole.
 const palette=page.getByRole('dialog',{name:'Command palette'});
 const openPalette=async(search:string,option:string)=>{
  await press(page.getByRole('button',{name:'Command palette',exact:true}));
  await palette.getByRole('combobox',{name:'Search CAD commands'}).fill(search);
  await press(palette.getByRole('option',{name:option}));
 };
 await openPalette('counterbore','Standard hole');
 const dialog=page.getByRole('dialog',{name:'Standard hole'});
 await expect(dialog).toBeVisible();
 await dialog.getByRole('combobox',{name:'Hole type',exact:true}).selectOption('counterbore');
 await dialog.getByRole('combobox',{name:'Thread',exact:true}).selectOption('M3');
 await expect(dialog.getByText(/M3 counterbored hole, normal fit, Ø3\.4/)).toBeVisible();
 // Every control is large enough for a finger.
 for(const control of [dialog.getByRole('button',{name:'Pick on a face'}),dialog.getByRole('button',{name:'Add hole'}),dialog.getByRole('combobox',{name:'Hole type',exact:true})])
  expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);

 // Pick on a face: the dialog steps aside, one tap on the plate's top places the hole.
 await press(dialog.getByRole('button',{name:'Pick on a face'}));
 await expect(dialog).toBeHidden();
 await run(page,'top',/./).catch(()=>undefined);
 const canvas=page.getByTestId('cad-canvas'),box=(await canvas.boundingBox())!;
 if(touch)await page.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);else await page.mouse.click(box.x+box.width/2,box.y+box.height/2);
 await expect(dialog).toBeVisible();
 await expect(dialog.getByRole('spinbutton',{name:'Z',exact:true})).toHaveValue('10');
 await expect(dialog.getByRole('spinbutton',{name:'Depth (mm)',exact:true})).toHaveValue('10');
 await expect(dialog.getByRole('checkbox',{name:'Through (depth is the wall thickness)'})).toBeChecked();
 await expect(dialog.getByRole('combobox',{name:'Axis into the material'})).toHaveValue('picked');
 await expect(dialog.getByRole('combobox',{name:'Cut body'})).not.toHaveValue('');
 await press(dialog.getByRole('button',{name:'Add hole'}));
 await expect(dialog).toBeHidden({timeout:120_000});
 await ready();

 // The exact kernel sees the counterbored plate: true cylinders, the exact removed volume.
 const hole=standardHole({type:'counterbore',thread:'M3',depth:10,through:true});
 const expected=16000-(holeCutterVolume({...hole,through:undefined})-Math.PI*(COUNTERBORE_4762.M3.diameter/2)**2*HOLE_ENTRY_MM);
 const measured=Number(/volume ([\d.]+) mm³/.exec(await run(page,'measure exact all',/volume/))![1]);
 expect(measured).toBeCloseTo(expected,3);

 // Fasten holes: the screw the counterbore is made for, with washer and nut under the plate.
 await openPalette('fasten','Fasten holes');
 const fasten=page.getByRole('dialog',{name:'Fasten holes'});
 await expect(fasten.getByText(/ISO 4762 M3×12 \+ ISO 7089 3 \+ ISO 4032 M3/)).toBeVisible();
 await fasten.getByRole('combobox',{name:'Detail',exact:true}).selectOption('envelope');
 await press(fasten.getByRole('button',{name:'Insert fasteners'}));
 await expect(fasten).toBeHidden({timeout:120_000});
 await ready();
 const names=page.getByTestId('object-name');
 await expect(names.filter({hasText:'ISO 4762 M3×12'})).toHaveCount(1);
 await expect(names.filter({hasText:'ISO 4032 M3'})).toHaveCount(1);

 // Standard parts: an ISO 4032 M8 nut.
 await openPalette('nut','Standard parts');
 const parts=page.getByRole('dialog',{name:'Standard parts'});
 await parts.getByRole('combobox',{name:'Part',exact:true}).selectOption('hex-nut');
 await parts.getByRole('combobox',{name:'Thread',exact:true}).selectOption('M8');
 await parts.getByRole('spinbutton',{name:'X',exact:true}).fill('40');
 await press(parts.getByRole('button',{name:'Insert part'}));
 await expect(parts).toBeHidden({timeout:120_000});
 await ready();
 await expect(names.filter({hasText:'ISO 4032 M8'})).toHaveCount(1);
 expect(await run(page,'measure exact "ISO 4032 M8"',/volume/)).toMatch(/volume 653\.\d+ mm³/);
});
