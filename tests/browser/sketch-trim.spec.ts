// SPDX-License-Identifier: BSD-3-Clause
import {expect,test} from '@playwright/test';

test('pick a trim line and shorten an arc without flattening it',async({page,hasTouch})=>{
 const press=(control:ReturnType<typeof page.getByRole>)=>hasTouch?control.tap():control.click();
 await page.goto('/');
 const ready=()=>expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');
 await ready();
 await press(page.getByRole('button',{name:'Sketch',exact:true}));
 const dialog=page.getByRole('dialog',{name:'Sketch and extrusion'});
 await dialog.getByLabel('Profile',{exact:true}).selectOption('outline');
 const points=dialog.getByLabel('Outline points X, Y (mm)');
 const original='0, 0, 1\n10, 0\n10, 8\n0, 8';
 await points.fill(original);
 await press(dialog.getByText('Trim by line',{exact:true}));
 const first=dialog.getByLabel('First trim point X, Y (mm)');
 const second=dialog.getByLabel('Second trim point X, Y (mm)');
 const trim=dialog.getByRole('button',{name:'Trim draft',exact:true});
 await first.fill('20, 7');
 await second.fill('20, -4');
 await press(trim);
 await expect(dialog.getByRole('status',{name:'Sketch status'})).toContainText('must cross');
 await expect(points).toHaveValue(original);

 await press(dialog.getByRole('button',{name:'Pick trim line',exact:true}));
 const svg=dialog.locator('.sketch-preview svg');
 const pick=async(x:number,y:number)=>{
  await svg.scrollIntoViewIfNeeded();
  const at=await svg.evaluate((node,args)=>{
   const matrix=(node as SVGSVGElement).getScreenCTM()!;
   const point=new DOMPoint(args.x+4.5,-args.y-3.5).matrixTransform(matrix);
   return {x:point.x,y:point.y};
  },{x,y});
  if(hasTouch)await page.touchscreen.tap(at.x,at.y);
  else await page.mouse.click(at.x,at.y);
 };
 await pick(5,7);
 await expect(first).toHaveValue('5, 7');
 await pick(5,-4);
 await expect(second).toHaveValue('5, -4');
 await expect(dialog.locator('.sketch-trim-line')).toBeVisible();
 await expect(dialog.locator('.sketch-trim-side')).toBeVisible();
 await press(trim);
 const [x,y,bulge]=(await points.inputValue()).split('\n')[0].split(',').map(Number);
 expect(x).toBeCloseTo(5);
 expect(y).toBeCloseTo(-5);
 expect(bulge).toBeCloseTo(Math.tan(Math.PI/8));
 await expect(page.getByTestId('object-name')).toHaveCount(0);
 await press(dialog.getByRole('button',{name:'Create extrusion'}));
 await expect(dialog).toBeHidden();
 await ready();
 const edit=page.getByRole('button',{name:'Edit sketch & extrusion'});
 if(!await edit.isVisible())await press(page.getByRole('button',{name:'Properties',exact:true}));
 await press(edit);
 await expect(points).toHaveValue(new RegExp(String(bulge)));
 await press(dialog.getByRole('button',{name:'Close sketch'}));
 await press(page.getByRole('button',{name:'Undo',exact:true}));
 await expect(page.getByTestId('object-name')).toHaveCount(0);
});
