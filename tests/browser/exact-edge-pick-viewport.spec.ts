// SPDX-License-Identifier: BSD-3-Clause
// Picking edges for an exact chamfer directly on the model in the 3D view, by touch on the `ipad`
// project and by mouse on `chromium`: the dialog steps aside, taps on the canvas toggle edges (the same stable
// references as the dialog's drawing), Done brings the dialog back with the choice, and the
// chamfer is built exactly. No keyboard is used.
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
const volume=(text:string)=>Number(/volume ([\d.]+) mm³/.exec(text)?.[1]);
const press=async(target:Locator,touch:boolean)=>touch?target.tap():target.click();
type Target={index:number;x:number;y:number;picked:boolean};

test('tap edges on the model in the 3D view and chamfer them exactly',async({page},info)=>{
 test.setTimeout(900_000);
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
 await expect(dialog.getByRole('checkbox',{name:/^Edge \d+: /})).toHaveCount(12,{timeout:120_000});
 // The four 30 mm edges (along Y), by their numbers in the listing.
 const labels=await dialog.getByRole('checkbox',{name:/: line, 30 mm$/}).evaluateAll(nodes=>nodes.map(node=>node.getAttribute('aria-label')??''));
 const long=new Set(labels.map(label=>Number(/^Edge (\d+)/.exec(label)![1])-1));
 expect(long.size).toBe(4);

 // Into the 3D view: the dialog steps aside, the edges are drawn on the model.
 await press(dialog.getByRole('button',{name:'Pick in the 3D view',exact:true}),touch);
 await expect(dialog).toBeHidden();
 const bar=page.getByRole('toolbar',{name:'Edge picking'}),canvas=page.getByTestId('cad-canvas');
 await expect(bar).toBeVisible();
 await expect(canvas).toHaveAttribute('data-edge-pick','12');
 const targets=async()=>JSON.parse(await canvas.getAttribute('data-edge-pick-targets')??'[]') as Target[];
 await expect.poll(async()=>(await targets()).length,{timeout:30_000}).toBe(12);
 const box=(await canvas.boundingBox())!;
 const tap=async(target:Target)=>{
  const x=box.x+target.x,y=box.y+target.y;
  if(touch)await page.touchscreen.tap(x,y);else await page.mouse.click(x,y);
 };
 // Tap the long edges until two are chosen (an edge hidden behind the block is not picked).
 const isPicked=async(index:number)=>(await targets()).find(t=>t.index===index)?.picked;
 let chosen=0;
 for(const target of (await targets()).filter(target=>long.has(target.index)&&target.x>0&&target.y>0&&target.x<box.width&&target.y<box.height-100)){
  if(chosen===2)break;
  await tap(target);
  // The targets are published a moment after each draw: wait for this edge to show as chosen.
  if(await expect.poll(()=>isPicked(target.index),{timeout:5_000}).toBe(true).then(()=>true,()=>false)){chosen++;continue;}
  // A hidden edge is never picked; a visible edge next to it may be: tap the same spot to undo that.
  await page.waitForTimeout(500);
  if((await targets()).filter(t=>t.picked).length>chosen)await tap(target);
  await expect.poll(async()=>(await targets()).filter(t=>t.picked).length,{timeout:5_000}).toBe(chosen);
 }
 await expect.poll(async()=>(await targets()).filter(t=>t.picked).length,{timeout:10_000}).toBe(2);
 await expect(bar).toContainText('2 edges chosen');
 const picked=(await targets()).filter(t=>t.picked);
 expect(picked.every(t=>long.has(t.index))).toBe(true);
 // Tapping a chosen edge again takes it off; tap it once more to keep it.
 await tap(picked[0]);
 await expect(bar).toContainText('1 edges chosen');
 await tap(picked[0]);
 await expect(bar).toContainText('2 edges chosen');
 const done=bar.getByRole('button',{name:'Done',exact:true});
 expect((await done.boundingBox())!.height).toBeGreaterThanOrEqual(44);
 await press(done,touch);

 // Back in the dialog: the drawing shows the same two edges chosen.
 await expect(dialog).toBeVisible();
 await expect(bar).toBeHidden();
 await expect(canvas).not.toHaveAttribute('data-edge-pick',/.*/);
 await expect(dialog.getByText('2 edges chosen')).toBeVisible();
 for(const target of picked)await expect(dialog.getByRole('checkbox',{name:new RegExp(`^Edge ${target.index+1}: `)})).toHaveAttribute('aria-checked','true');
 await press(dialog.getByRole('button',{name:'Apply exact feature'}),touch);
 await expect(dialog).toBeHidden({timeout:120_000});
 await ready();
 await expect(page.getByTestId('object-name').filter({hasText:'Chamfer of Block'})).toBeVisible();
 // Two parallel 30 mm edges bevelled by 2: 6000 − 2 · ½ · 2² · 30.
 expect(volume(await run(page,'measure exact "Chamfer of Block"',/volume/))).toBeCloseTo(5880,6);
});
