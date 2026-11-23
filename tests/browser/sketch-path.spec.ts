// SPDX-License-Identifier: BSD-3-Clause
import {expect,test} from '@playwright/test';

test('retain and trim an open path, snap to it, then close it and extrude',async({page,hasTouch})=>{
 const press=(control:ReturnType<typeof page.getByRole>)=>hasTouch?control.tap():control.click();
 await page.goto('/');
 const ready=()=>expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');
 await ready();
 await press(page.locator('summary[aria-label="More sketch tools"]'));
 await press(page.getByRole('button',{name:'Sketch path',exact:true}));
 const path=page.getByRole('dialog',{name:'Sketch path',exact:true});
 await path.getByLabel('Sketch name').fill('Arc guide');
 const points=path.getByLabel('Path points X, Y (mm)');
 await points.fill('0, 0, 1\n@10, 0\n@0, 8\n@-10, 0');
 await expect(path.locator('polyline.sketch-path-line')).toBeVisible();
 await press(path.getByRole('button',{name:'Save path',exact:true}));
 await expect(path).toBeHidden();
 await ready();
 await expect(page.getByTestId('object-name')).toHaveCount(0);

 const saved=page.getByRole('button',{name:'Sketch path: Arc guide',exact:true});
 await press(page.getByRole('button',{name:'Sketch',exact:true}));
 const sketch=page.getByRole('dialog',{name:'Sketch and extrusion'});
 await sketch.getByLabel('Profile',{exact:true}).selectOption('outline');
 await press(sketch.getByText('Sketch snap references',{exact:true}));
 await sketch.getByLabel('Reference sketch',{exact:true}).selectOption({label:'Arc guide'});
 await expect(sketch.locator('polyline.sketch-open-reference')).toBeVisible();
 await press(sketch.getByRole('button',{name:'Close sketch',exact:true}));

 await press(saved);
 await press(path.getByText('Trim by line',{exact:true}));
 await path.getByLabel('First trim point X, Y (mm)').fill('5, 7');
 await path.getByLabel('Second trim point X, Y (mm)').fill('5, -4');
 await press(path.getByRole('button',{name:'Trim path draft'}));
 const [x,y,bulge]=(await points.inputValue()).split('\n')[0].split(',').map(Number);
 expect(x).toBeCloseTo(5);
 expect(y).toBeCloseTo(-5);
 expect(bulge).toBeCloseTo(Math.tan(Math.PI/8));
 await press(path.getByRole('button',{name:'Save path',exact:true}));
 await expect(path).toBeHidden();
 await press(saved);
 await press(path.getByRole('button',{name:'Close into outline',exact:true}));
 await expect(path).toBeHidden();
 const extrude=page.getByRole('button',{name:'Extrude sketch: Arc guide',exact:true});
 await expect(extrude).toBeVisible();
 await press(page.getByRole('button',{name:'Undo',exact:true}));
 await expect(saved).toBeVisible();
 await press(page.getByRole('button',{name:'Redo',exact:true}));
 await press(extrude);
 await sketch.getByLabel('Extrusion distance (mm)').fill('4');
 await press(sketch.getByRole('button',{name:'Create extrusion',exact:true}));
 await expect(sketch).toBeHidden();
 await ready();
 await expect(page.getByTestId('object-name')).toHaveCount(1);
});
