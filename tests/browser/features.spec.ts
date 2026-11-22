import {expect,test} from '@playwright/test';
import {clickTool} from './ui.js';
test('sketch dimensions, extrusion inputs and formulas remain editable after reopening',async({page})=>{
 await page.goto('/');const editor=page.locator('#cad-root');const ready=()=>expect(editor).toHaveAttribute('data-state','ready');await ready();
 await page.getByRole('button',{name:'Parameters',exact:true}).click();const parameters=page.getByRole('dialog',{name:'Model parameters',exact:true});await parameters.getByRole('button',{name:'Add parameter',exact:true}).click();await parameters.getByLabel('Parameter name',{exact:true}).fill('width');await parameters.getByLabel('Parameter expression',{exact:true}).fill('40');await parameters.getByRole('button',{name:'Apply parameters',exact:true}).click();await parameters.getByRole('button',{name:'Close parameters',exact:true}).click();
 await page.getByRole('button',{name:'Sketch',exact:true}).click();const sketch=page.getByRole('dialog',{name:'Sketch and extrusion',exact:true});await expect(sketch).toBeVisible();await sketch.getByLabel('Sketch name',{exact:true}).fill('Mounting plate');await sketch.getByLabel('Sketch width (mm)',{exact:true}).fill('width');await sketch.getByLabel('Sketch depth (mm)',{exact:true}).fill('width / 2');await sketch.getByLabel('Extrusion distance (mm)',{exact:true}).fill('width / 8');await expect(sketch.getByLabel('Sketch preview',{exact:true})).toContainText('40 × 20 mm');await sketch.getByRole('button',{name:'Create extrusion',exact:true}).click();await expect(sketch).not.toBeVisible();await ready();
 const edit=page.getByRole('button',{name:'Edit sketch & extrusion',exact:true});if(!await edit.isVisible())await page.getByRole('button',{name:'Properties',exact:true}).click();await edit.click();await sketch.getByLabel('Sketch depth (mm)',{exact:true}).fill('-10');await expect(sketch.getByRole('button',{name:'Apply sketch changes',exact:true})).toBeDisabled();await expect(sketch.getByRole('status',{name:'Sketch status'})).toContainText('Dimension');await expect(sketch).toBeVisible();await sketch.getByLabel('Sketch depth (mm)',{exact:true}).fill('width / 2');await sketch.getByLabel('Extrusion distance (mm)',{exact:true}).fill('8');await sketch.getByRole('button',{name:'Apply sketch changes',exact:true}).click();await ready();await page.getByRole('button',{name:'Undo',exact:true}).click();await ready();
 await page.reload();await ready();await page.getByTestId('object-name').click();if(!await edit.isVisible())await page.getByRole('button',{name:'Properties',exact:true}).click();await edit.click();await expect(sketch.getByLabel('Extrusion distance (mm)',{exact:true})).toHaveValue('width / 8');await sketch.getByRole('button',{name:'Close sketch',exact:true}).click();
 await page.getByRole('button',{name:'Parameters',exact:true}).click();await parameters.getByLabel('Parameter expression',{exact:true}).fill('60');await parameters.getByRole('button',{name:'Apply parameters',exact:true}).click();await ready();await parameters.getByText('Feature dependencies',{exact:true}).click();await expect(parameters.locator('.design-dependencies')).toContainText('Mounting plate ← width');await parameters.getByRole('button',{name:'Close parameters',exact:true}).click();await edit.click();await expect(sketch.getByLabel('Sketch preview',{exact:true})).toContainText('60 × 30 mm');await page.screenshot({path:`test-results/sketch-${test.info().project.name}.png`,fullPage:true});await sketch.getByRole('button',{name:'Close sketch',exact:true}).click();
});
test('circle extrusion can be created on a side plane and deleted immediately from Objects',async({page})=>{
 await page.goto('/');const editor=page.locator('#cad-root');await expect(editor).toHaveAttribute('data-state','ready');await page.getByRole('button',{name:'Sketch',exact:true}).click();const sketch=page.getByRole('dialog',{name:'Sketch and extrusion',exact:true});await sketch.getByLabel('Profile',{exact:true}).selectOption('circle');await sketch.getByLabel('Sketch plane',{exact:true}).selectOption('YZ');await sketch.getByLabel('Sketch radius (mm)',{exact:true}).fill('12');await sketch.getByLabel('Symmetric extrusion',{exact:true}).check();await sketch.getByRole('button',{name:'Create extrusion',exact:true}).click();await expect(sketch).not.toBeVisible();await expect(editor).toHaveAttribute('data-state','ready');const objects=page.locator('.tree');if(!await objects.isVisible())await page.getByRole('button',{name:'Objects',exact:true}).click();await page.getByTestId('object-name').click();await page.keyboard.press('Backspace');await expect(page.getByTestId('object-name')).toHaveCount(0);await expect(editor).toHaveAttribute('data-state','ready');await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.getByTestId('object-name')).toHaveCount(1);
});

test('sketch help, field errors and a real-size DXF are available in the editor',async({page},testInfo)=>{
 await page.goto('/');
 await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');
 await page.getByRole('button',{name:'Sketch',exact:true}).click();
 const sketch=page.getByRole('dialog',{name:'Sketch and extrusion'});
 const info=sketch.getByRole('button',{name:'About sketching and extrusion'});
 await info.click();
 await expect(info).toHaveAttribute('aria-expanded','true');
 await expect(sketch.getByText('Extrusion adds thickness', {exact:false})).toBeVisible();
 await info.click();
 const width=sketch.getByLabel('Sketch width (mm)',{exact:true});
 await width.fill('0');
 await expect(width).toHaveAttribute('aria-invalid','true');
 await expect(sketch.getByRole('status')).toContainText('Sketch width (mm)');
 await width.fill('42');
 await sketch.getByRole('button',{name:'Create extrusion',exact:true}).click();
 await expect(sketch).not.toBeVisible();
 await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');
 const exportButton=page.getByRole('button',{name:'Export sketch as DXF',exact:true});
 if(!await exportButton.isVisible())await page.getByRole('button',{name:'Properties',exact:true}).click();
 const [download]=await Promise.all([page.waitForEvent('download'),exportButton.click()]);
 await download.saveAs(testInfo.outputPath('rectangle.dxf'));
 const {readFile}=await import('node:fs/promises');
 const dxf=await readFile(testInfo.outputPath('rectangle.dxf'),'utf8');
 expect(dxf).toContain('$INSUNITS\r\n70\r\n4');
 expect(dxf).toContain('LWPOLYLINE');
 expect(dxf).toContain('10\r\n-21\r\n20\r\n-15');
 expect(dxf).toContain('10\r\n21\r\n20\r\n15');
});
