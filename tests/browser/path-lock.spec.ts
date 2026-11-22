// SPDX-License-Identifier: BSD-3-Clause
import {expect,test} from '@playwright/test';
import {readFile} from 'node:fs/promises';

test('persist point lock expressions, export their geometry, and unlock without moving the vertex',async({page,hasTouch})=>{
 const press=(control:ReturnType<typeof page.getByRole>)=>hasTouch?control.tap():control.click();
 await page.goto('/');
 await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');
 await press(page.getByRole('button',{name:'Sketch path',exact:true}));
 const path=page.getByRole('dialog',{name:'Sketch path',exact:true});
 await path.getByLabel('Sketch name').fill('Locked guide');
 await press(path.getByText('Point locks',{exact:true}));
 await path.getByRole('combobox',{name:/^Path point/}).selectOption('1');
 const x=path.getByLabel('Locked X (mm)'),y=path.getByLabel('Locked Y (mm)');
 await x.fill('40 / 2');
 await y.fill('5');
 await press(path.getByRole('button',{name:'Lock point',exact:true}));
 const marker=path.locator('.sketch-path-locked');
 await expect(marker).toHaveAttribute('cx','20');
 await expect(marker).toHaveAttribute('cy','-5');
 await press(path.getByRole('button',{name:'Save path',exact:true}));
 await expect(path).toBeHidden();

 await press(page.getByRole('button',{name:'Sketch path: Locked guide',exact:true}));
 await press(path.getByText('Point locks',{exact:true}));
 await path.getByRole('combobox',{name:/^Path point/}).selectOption('1');
 await expect(x).toHaveValue('40 / 2');
 await expect(y).toHaveValue('5');
 await press(path.getByText('DXF path',{exact:true}));
 const [download]=await Promise.all([
  page.waitForEvent('download'),press(path.getByRole('button',{name:'Export path as DXF'}))
 ]);
 expect(await readFile((await download.path())!,'utf8')).toContain('10\r\n20\r\n20\r\n5');
 await press(path.getByRole('button',{name:'Unlock point',exact:true}));
 await expect(marker).toHaveCount(0);
 await expect(path.getByLabel('Path points X, Y (mm)')).toHaveValue('0, 0\n20, 5\n30, 20');
 await press(path.getByRole('button',{name:'Save path',exact:true}));
 await expect(path).toBeHidden();
});
