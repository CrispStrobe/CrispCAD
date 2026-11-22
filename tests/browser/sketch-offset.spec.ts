// SPDX-License-Identifier: BSD-3-Clause
import {expect,test} from '@playwright/test';

test('offset an editable region, reject a collapsed hole, and undo the saved edit',async({page,hasTouch})=>{
 const press=(control:ReturnType<typeof page.getByRole>)=>hasTouch?control.tap():control.click();
 await page.goto('/');
 const ready=()=>expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');
 await ready();
 await press(page.getByRole('button',{name:'Sketch',exact:true}));
 const dialog=page.getByRole('dialog',{name:'Sketch and extrusion'});
 await dialog.getByLabel('Sketch name').fill('Panel with bore');
 await dialog.getByLabel('Profile',{exact:true}).selectOption('region');
 const loops=dialog.getByLabel('Region loops (mm)');
 const original='0, 0 | 40, 0 | 40, 30 | 0, 30\nCIRCLE 12, 15, 4';
 await loops.fill(original);
 await press(dialog.getByRole('button',{name:'Create extrusion'}));
 await expect(dialog).toBeHidden();
 await ready();
 const snapshot=()=>page.evaluate(()=>localStorage.getItem('brickwright-cad:standalone:v1'));
 await expect.poll(async()=>JSON.parse((await snapshot())??'null')?.roots.length).toBe(1);
 const before=await snapshot();

 const edit=page.getByRole('button',{name:'Edit sketch & extrusion'});
 if(!await edit.isVisible())await press(page.getByRole('button',{name:'Properties',exact:true}));
 await press(edit);
 await press(dialog.getByText('Offset profile',{exact:true}));
 const distance=dialog.getByLabel('Offset distance (mm)');
 const offset=dialog.getByRole('button',{name:'Apply offset to draft'});
 await distance.fill('5');
 await press(offset);
 await expect(dialog.getByRole('status',{name:'Sketch status'})).toContainText('region needs');
 await expect(loops).toHaveValue(original);
 await distance.fill('2');
 await press(offset);
 await expect(loops).toHaveValue(/CIRCLE 12, 15, 2$/);
 const outline=(await loops.inputValue()).split('\n')[0];
 expect(outline).toContain('-2, -2');
 expect(outline).toContain('42, 32');
 expect(await snapshot()).toBe(before);
 await press(dialog.getByRole('button',{name:'Apply sketch changes'}));
 await expect(dialog).toBeHidden();
 await ready();
 await expect.poll(snapshot).not.toBe(before);

 await press(page.getByRole('button',{name:'Undo',exact:true}));
 await ready();
 await press(edit);
 await expect(loops).toHaveValue(original);
});

test('offset an arc outline and retain editable arcs after applying the draft',async({page,hasTouch})=>{
 const press=(control:ReturnType<typeof page.getByRole>)=>hasTouch?control.tap():control.click();
 await page.goto('/');
 const ready=()=>expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');
 await ready();
 await press(page.getByRole('button',{name:'Sketch',exact:true}));
 const dialog=page.getByRole('dialog',{name:'Sketch and extrusion'});
 await dialog.getByLabel('Profile',{exact:true}).selectOption('outline');
 const outline=dialog.getByLabel('Outline points X, Y (mm)');
 const original='0, 0, 1\n10, 0\n10, 8\n0, 8';
 await outline.fill(original);
 await press(dialog.getByText('Offset profile',{exact:true}));
 const distance=dialog.getByLabel('Offset distance (mm)');
 const offset=dialog.getByRole('button',{name:'Apply offset to draft',exact:true});
 await distance.fill('-10');
 await press(offset);
 await expect(dialog.getByRole('status',{name:'Sketch status'})).toContainText('collapses an edge');
 await expect(outline).toHaveValue(original);

 await distance.fill('1');
 await press(offset);
 await expect.poll(async()=>(await outline.inputValue()).split('\n').length).toBe(6);
 const draft=await outline.inputValue();
 const rows=draft.split('\n').map(row=>row.split(',').map(Number));
 expect(rows[0][0]).toBeCloseTo(-1);
 expect(rows[1][0]).toBeCloseTo(11);
 expect(rows[0][2]).toBeCloseTo(1);
 expect(rows.filter(row=>row[2]).length).toBe(3);
 await expect(page.getByTestId('object-name')).toHaveCount(0);
 await press(dialog.getByRole('button',{name:'Create extrusion'}));
 await expect(dialog).toBeHidden();
 await ready();
 const edit=page.getByRole('button',{name:'Edit sketch & extrusion'});
 if(!await edit.isVisible())await press(page.getByRole('button',{name:'Properties',exact:true}));
 await press(edit);
 await expect(outline).toHaveValue(draft);
 await dialog.getByLabel('Edit edge curves').check();
 await expect(dialog.locator('[data-resize="curve"]')).toHaveCount(6);
});
