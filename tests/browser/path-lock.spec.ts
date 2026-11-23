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

test('chain segment constraints through a parameter, DXF export, and Undo',async({page,hasTouch})=>{
 const press=(control:ReturnType<typeof page.getByRole>)=>hasTouch?control.tap():control.click();
 await page.goto('/');
 await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');
 const openParameters=page.getByRole('button',{name:'Parameters',exact:true});
 const parameters=page.getByRole('dialog',{name:'Model parameters'});
 const expression=parameters.getByLabel('Parameter expression',{exact:true});
 const apply=parameters.getByRole('button',{name:'Apply parameters'});
 const close=parameters.getByRole('button',{name:'Close parameters'});
 await press(openParameters);
 await press(parameters.getByRole('button',{name:'Add parameter'}));
 await parameters.getByLabel('Parameter name',{exact:true}).fill('reach');
 await expression.fill('40');
 await press(apply);
 await press(close);

 const path=page.getByRole('dialog',{name:'Sketch path',exact:true});
 const segment=path.getByRole('combobox',{name:'Path segment'});
 const distance=path.getByLabel('Endpoint distance (mm)'),direction=path.getByLabel('Direction (deg)');
 const markers=path.locator('[data-driven]');
 const save=path.getByRole('button',{name:'Save path',exact:true});
 const constrain=(length:string,angle:string)=>distance.fill(length).then(()=>direction.fill(angle))
  .then(()=>press(path.getByRole('button',{name:'Constrain segment',exact:true})));
 await press(page.getByRole('button',{name:'Sketch path',exact:true}));
 await path.getByLabel('Sketch name').fill('Driven guide');
 await press(path.getByText('Segment constraints',{exact:true}));
 await constrain('reach','0');
 await segment.selectOption('1');
 await constrain('15','90');
 await expect(markers).toHaveCount(2);
 await expect(markers.last()).toHaveAttribute('cx','40');
 await expect(markers.last()).toHaveAttribute('cy','-15');
 await distance.fill('0');
 await press(path.getByRole('button',{name:'Update segment constraint',exact:true}));
 await expect(path.getByRole('status',{name:'Sketch status'})).toContainText('Dimension must be');
 await expect(markers.last()).toHaveAttribute('cy','-15');
 await press(save);
 await expect(path).toBeHidden();

 await press(openParameters);
 await expression.fill('50');
 await press(apply);
 await press(close);
 const reopen=page.getByRole('button',{name:'Sketch path: Driven guide',exact:true});
 await press(reopen);
 await press(path.getByText('Segment constraints',{exact:true}));
 await expect(distance).toHaveValue('reach');
 await expect(markers.last()).toHaveAttribute('cx','50');
 await press(path.getByText('DXF path',{exact:true}));
 const [download]=await Promise.all([
  page.waitForEvent('download'),press(path.getByRole('button',{name:'Export path as DXF'}))
 ]);
 expect(await readFile((await download.path())!,'utf8')).toContain('10\r\n50\r\n20\r\n15');
 await segment.selectOption('1');
 await press(path.getByRole('button',{name:'Remove segment constraint',exact:true}));
 await expect(path.getByLabel('Path points X, Y (mm)')).toHaveValue('0, 0\n30, 0\n50, 15');
 await press(save);
 await expect(path).toBeHidden();
 await press(page.getByRole('button',{name:'Undo',exact:true}));
 await press(reopen);
 await expect(markers).toHaveCount(2);
 await expect(markers.last()).toHaveAttribute('cx','50');
});
