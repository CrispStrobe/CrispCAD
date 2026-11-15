// SPDX-License-Identifier: BSD-3-Clause
import {expect,test} from '@playwright/test';
import {addShape} from './ui.js';
const ready=async(page:any)=>expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');
const stored=(page:any)=>page.evaluate(()=>JSON.parse(localStorage.getItem('brickwright-cad:standalone:v1')!));
async function setup(page:any){await page.goto('/');await ready(page);await addShape(page,'Box');await ready(page);await page.getByLabel('View direction',{exact:true}).selectOption('top');await page.getByRole('button',{name:'Fit',exact:true}).click();}
async function dragStart(page:any){const b=(await page.getByRole('button',{name:'Resize X+',exact:true}).boundingBox())!;await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();return {x:b.x+b.width/2,y:b.y+b.height/2};}
test('selection handles resize in mm with live values and a single committed edit; Escape cancels',async({page})=>{
 await setup(page);await expect(page.getByLabel('Resize X (mm)',{exact:true})).toHaveValue('30');const before=await stored(page),versions=await page.getByLabel('Model iteration',{exact:true}).locator('option').count();
 const p=await dragStart(page);await page.mouse.move(p.x+46,p.y,{steps:8});const live=Number(await page.getByLabel('Resize X (mm)',{exact:true}).inputValue());expect(live).toBeGreaterThan(30);expect(live).toBeCloseTo(Math.round(live));expect(await stored(page)).toEqual(before);
 await page.mouse.up();await ready(page);await expect.poll(()=>page.getByLabel('Model iteration',{exact:true}).locator('option').count()).toBe(versions+1);const after=await stored(page),pose=after.nodes[after.roots[0]].transform;expect(pose.scale[0]*30).toBeCloseTo(live);expect(pose.position[0]-live/2).toBeCloseTo(before.nodes[before.roots[0]].transform.position[0]-15);
 const q=await dragStart(page);await page.mouse.move(q.x+20,q.y);await page.keyboard.press('Escape');await page.mouse.up();expect(await stored(page)).toEqual(after);await page.screenshot({path:`test-results/dimension-resize-${test.info().project.name}.png`,fullPage:true});
});
test('exact dimension entry, proportional and centre toggles work on touch layouts and survive undo/reload',async({page})=>{
 await setup(page);const before=await stored(page);await page.getByRole('button',{name:'Resize about center',exact:true}).click();const x=page.getByLabel('Resize X (mm)',{exact:true});await x.fill('42.125');await x.press('Enter');await ready(page);let d=await stored(page);expect(d.nodes[d.roots[0]].transform.position).toEqual(before.nodes[before.roots[0]].transform.position);expect(d.nodes[d.roots[0]].transform.scale[0]*30).toBeCloseTo(42.125);
 await page.getByRole('button',{name:'Keep proportions',exact:true}).click();await x.fill('84.25');await x.press('Enter');await ready(page);await expect(page.getByLabel('Resize Y (mm)',{exact:true})).toHaveValue('60');await expect(page.getByLabel('Resize Z (mm)',{exact:true})).toHaveValue('40');
 await page.getByRole('button',{name:'Undo',exact:true}).click();await ready(page);await expect(x).toHaveValue('42.125');await page.reload();await ready(page);await page.getByTestId('object-name').click();await expect(x).toHaveValue('42.125');
});
test('Shift links dimensions while Alt keeps the centre during a real handle drag',async({page})=>{
 await setup(page);const before=await stored(page);await page.keyboard.down('Shift');await page.keyboard.down('Alt');const p=await dragStart(page);await page.mouse.move(p.x+32,p.y,{steps:6});await page.mouse.up();await page.keyboard.up('Alt');await page.keyboard.up('Shift');await ready(page);const d=await stored(page),pose=d.nodes[d.roots[0]].transform;expect(pose.scale[0]).toBeGreaterThan(1);expect(pose.scale[1]).toBeCloseTo(pose.scale[0]);expect(pose.scale[2]).toBeCloseTo(pose.scale[0]);expect(pose.position).toEqual(before.nodes[before.roots[0]].transform.position);
});
test('fine resize uses fractional millimetres and grid Off does not quantize',async({page})=>{
 await setup(page);await page.getByLabel('Fine adjustments',{exact:true}).check();const p=await dragStart(page);await page.mouse.move(p.x+43,p.y,{steps:8});const fine=Number(await page.getByLabel('Resize X (mm)',{exact:true}).inputValue());expect(fine).toBeGreaterThan(30);expect(fine).toBeLessThan(31);expect(fine*10).toBeCloseTo(Math.round(fine*10));await page.mouse.up();await ready(page);
 await page.getByLabel('Fine adjustments',{exact:true}).uncheck();await page.getByLabel('Grid spacing',{exact:true}).selectOption('0');const q=await dragStart(page);await page.mouse.move(q.x+37,q.y,{steps:8});const free=Number(await page.getByLabel('Resize X (mm)',{exact:true}).inputValue());expect(Math.abs(free-Math.round(free))).toBeGreaterThan(.001);await page.mouse.up();await ready(page);
});
