// SPDX-License-Identifier: BSD-3-Clause
import{expect,test}from'@playwright/test';
import{addShape,clickTool}from'./ui.js';
const ready=async(page:any)=>expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');
const model=(page:any)=>page.evaluate(()=>JSON.parse(localStorage.getItem('brickwright-cad:standalone:v1')!));
test('Hole is retained on reload, Union cuts it and undo restores the editable cutters',async({page})=>{
 await page.goto('/');await ready(page);await addShape(page,'Box');await ready(page);await addShape(page,'Cylinder');await ready(page);
 const hole=page.getByTestId('role-hole');if(!await hole.isVisible())await page.getByRole('button',{name:'Properties',exact:true}).click();await hole.click();await ready(page);await expect(page.getByTestId('role-hole')).toHaveAttribute('aria-pressed','true');let d=await model(page);const cutter=d.roots.find((id:string)=>d.nodes[id].role==='hole');expect(cutter).toBeTruthy();
 await page.reload();await ready(page);await page.getByTestId('cad-canvas').focus();await page.keyboard.press('ControlOrMeta+a');await clickTool(page,'Union');await ready(page);d=await model(page);expect(d.roots).toHaveLength(1);expect(d.nodes[d.roots[0]].useHoleRoles).toBe(true);
 await page.getByRole('button',{name:'Undo',exact:true}).click();await ready(page);d=await model(page);expect(d.roots).toHaveLength(2);expect(d.nodes[cutter].role).toBe('hole');
});
test('dragging a selection rectangle selects multiple bodies without moving them and Escape cancels',async({page})=>{
 await page.goto('/');await ready(page);await addShape(page,'Box');await ready(page);await addShape(page,'Sphere');await ready(page);const before=await model(page);
 await page.getByRole('button',{name:'Select',exact:true}).click();await page.getByLabel('View direction',{exact:true}).selectOption('top');await page.getByRole('button',{name:'Fit',exact:true}).click();const canvas=page.getByTestId('cad-canvas'),b=(await canvas.boundingBox())!;
 await page.mouse.move(b.x+b.width*.3,b.y+b.height*.25);await page.mouse.down();await page.mouse.move(b.x+b.width*.7,b.y+b.height*.75,{steps:8});await expect(page.locator('.cad-selection-rectangle')).toBeVisible();await page.mouse.up();await expect(canvas).toHaveAttribute('data-selected','2');expect((await model(page)).nodes).toEqual(before.nodes);
 await page.mouse.move(b.x+b.width*.3,b.y+b.height*.25);await page.mouse.down();await page.mouse.move(b.x+b.width*.45,b.y+b.height*.4,{steps:3});await page.keyboard.press('Escape');await page.mouse.up();await expect(page.locator('.cad-selection-rectangle')).toBeHidden();await expect(canvas).toHaveAttribute('data-selected','2');
});
