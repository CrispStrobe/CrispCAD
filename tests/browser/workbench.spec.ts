import {expect,test} from '@playwright/test';
import {addShape,clickTool} from './ui.js';
test('compact workbench exposes shape controls, numeric transforms, selection and normal dragging',async({page})=>{
 await page.goto('/');const root=page.locator('#cad-root');await expect(root).toHaveAttribute('data-state','ready');
 await addShape(page,'Screw');await expect(root).toHaveAttribute('data-state','ready');
 const properties=page.getByLabel('Thread pitch (mm)',{exact:true});if(!await properties.isVisible())await page.getByRole('button',{name:'Properties',exact:true}).click();
 await expect(page.locator('[data-testid=object-name]')).toHaveCount(1);await expect(page.locator('[data-testid=object-name]')).toHaveAttribute('aria-pressed','true');
 await properties.fill('2.5');await properties.press('Tab');await page.getByRole('button',{name:'Apply shape parameters',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>{const d=JSON.parse(localStorage.getItem('brickwright-cad:standalone:v1')!);return d.nodes[d.roots[0]].generator?.values.pitch;})).toBe(2.5);
 await page.getByRole('button',{name:'Rotate',exact:true}).click();await page.getByLabel('Rotation Z',{exact:true}).fill('45');await page.getByLabel('Rotation Z',{exact:true}).press('Tab');await expect(root).toHaveAttribute('data-state','ready');
 await page.getByRole('button',{name:'Scale',exact:true}).click();await page.getByLabel('Scale X',{exact:true}).fill('1.5');await page.getByLabel('Scale X',{exact:true}).press('Tab');await expect(root).toHaveAttribute('data-state','ready');
 const canvas=page.locator('[data-testid=cad-canvas]');await canvas.focus();await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Select',exact:true})).toHaveAttribute('aria-pressed','true');await expect(canvas).toHaveAttribute('data-selected','1');
 await page.getByLabel('View direction',{exact:true}).selectOption('top');await page.getByRole('button',{name:'Fit',exact:true}).click();
 const box=(await canvas.boundingBox())!;const prior=await page.evaluate(()=>{const d=JSON.parse(localStorage.getItem('brickwright-cad:standalone:v1')!);return d.nodes[d.roots[0]].transform.position;});
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+40,box.y+box.height/2+24,{steps:8});await page.mouse.up();await expect(root).toHaveAttribute('data-state','ready');
 expect(await page.evaluate(()=>{const d=JSON.parse(localStorage.getItem('brickwright-cad:standalone:v1')!);return d.nodes[d.roots[0]].transform.position;})).not.toEqual(prior);
 const bar=await page.locator('.design-bar').boundingBox();expect(bar!.height).toBeLessThanOrEqual(52);expect((await canvas.boundingBox())!.y).toBeLessThan(60);
 await page.screenshot({path:`test-results/compact-workbench-${test.info().project.name}.png`,fullPage:true});
 await page.getByLabel('Application menu',{exact:true}).click();await page.getByRole('button',{name:'About Brickwright CAD',exact:true}).click();await expect(page.getByRole('dialog',{name:'About Brickwright CAD',exact:true})).toContainText('Brickwright-lite');
});
test('heart generators retain editable bending through save and reload',async({page})=>{
 await page.goto('/');await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');await addShape(page,'Heart');
 const bend=page.getByLabel('Bend angle (°)',{exact:true});if(!await bend.isVisible())await page.getByRole('button',{name:'Properties',exact:true}).click();
 await bend.fill('30');await bend.press('Tab');await page.getByRole('button',{name:'Apply shape parameters',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>{const d=JSON.parse(localStorage.getItem('brickwright-cad:standalone:v1')!);return d.nodes[d.roots[0]].generator?.values.bend;})).toBe(30);
 await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');await page.reload();await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');
 if(!await page.locator('[data-testid=object-name]').isVisible())await page.getByRole('button',{name:'Objects',exact:true}).click();await page.locator('[data-testid=object-name]').click();
 if(!await bend.isVisible())await page.getByRole('button',{name:'Properties',exact:true}).click();await expect(bend).toHaveValue('30');
});
