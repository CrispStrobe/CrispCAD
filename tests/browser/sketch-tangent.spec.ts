// SPDX-License-Identifier: BSD-3-Clause
import {expect,test} from '@playwright/test';

test('snap a straight outline edge to a circular reference while retaining the adjacent arc',async({page,hasTouch})=>{
 const press=(control:ReturnType<typeof page.getByRole>)=>hasTouch?control.tap():control.click();
 await page.goto('/');
 const ready=()=>expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');
 await ready();
 const open=page.getByRole('button',{name:'Sketch',exact:true});
 const dialog=page.getByRole('dialog',{name:'Sketch and extrusion'});
 const profile=dialog.getByLabel('Profile',{exact:true});
 const create=dialog.getByRole('button',{name:'Create extrusion'});
 await press(open);
 await dialog.getByLabel('Sketch name').fill('Circular guide');
 await profile.selectOption('circle');
 await dialog.getByLabel('Circle center X, Y (mm)').fill('10, 0');
 await dialog.getByLabel('Sketch radius (mm)').fill('6');
 await press(create);
 await expect(dialog).toBeHidden();
 await ready();

 await press(open);
 await profile.selectOption('outline');
 const points=dialog.getByLabel('Outline points X, Y (mm)');
 await points.fill('0, 0\n9, 7, 0.2\n25, 22\n0, 22');
 await press(dialog.getByText('Sketch snap references',{exact:true}));
 const tangent=dialog.getByRole('checkbox',{name:'Snap straight edges tangent to arcs and circles'});
 await expect(tangent).toBeDisabled();
 await dialog.getByLabel('Reference sketch',{exact:true}).selectOption({label:'Circular guide'});
 await expect(tangent).not.toBeChecked();
 await tangent.check();
 const vertex=dialog.locator('[data-resize="vertex"][data-vertex="1"]');
 await vertex.scrollIntoViewIfNeeded();
 const [start,target]=await vertex.evaluate(node=>{
  const handle=node as SVGCircleElement;
  const matrix=handle.getScreenCTM()!,x=handle.cx.baseVal.value,y=handle.cy.baseVal.value;
  return [[x,y],[x-2.4,y+2.1]].map(([x,y])=>{
   const point=new DOMPoint(x,y).matrixTransform(matrix);
   return {x:point.x,y:point.y};
  });
 });
 await page.mouse.move(start.x,start.y);
 await page.mouse.down();
 await page.mouse.move(target.x,target.y,{steps:4});
 await expect(dialog.locator('.sketch-snap-label')).toHaveText('Tangent');
 await expect(dialog.locator('.sketch-tangent-guide')).toBeVisible();
 await page.mouse.up();
 const [x,y,bulge]=(await points.inputValue()).split('\n')[1].split(',').map(Number);
 expect(x).toBeCloseTo(6.4);
 expect(y).toBeCloseTo(4.8);
 expect(bulge).toBe(.2);
 await expect(page.getByTestId('object-name')).toHaveCount(1);
 await press(create);
 await expect(dialog).toBeHidden();
 await ready();
 await expect(page.getByTestId('object-name')).toHaveCount(2);
 await press(page.getByRole('button',{name:'Undo',exact:true}));
 await expect(page.getByTestId('object-name')).toHaveCount(1);
});
