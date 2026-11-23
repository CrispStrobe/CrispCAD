// SPDX-License-Identifier: BSD-3-Clause
import {expect,test} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {sketchDwgFixture} from '../sketch-dwg-fixture.js';

test('imports DWG through the worker and keeps selected model geometry editable',async({page,hasTouch})=>{
 const press=(control:ReturnType<typeof page.getByRole>)=>hasTouch?control.tap():control.click();
 const workers:string[]=[];
 page.on('worker',worker=>workers.push(worker.url()));
 await page.goto('/');
 await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');
 await press(page.getByRole('button',{name:'Sketch',exact:true}));
 const sketch=page.getByRole('dialog',{name:'Sketch and extrusion'});
 await press(sketch.getByText('Import DXF or DWG outline',{exact:true}));
 expect(workers.some(url=>url.includes('sketch-dwg.worker'))).toBe(false);
 const file=sketch.getByLabel('Choose DWG file',{exact:true});
 const status=sketch.getByRole('status',{name:'Sketch status'});
 await file.setInputFiles({name:'damaged.dwg',mimeType:'application/acad',buffer:Buffer.from('AC1032')});
 await expect(status).toContainText('could not be decoded');
 await expect(sketch.getByLabel('Profile',{exact:true})).toHaveValue('rectangle');
 await file.setInputFiles({name:'Inch plate.dwg',mimeType:'application/acad',buffer:Buffer.from(sketchDwgFixture())});
 const layers=sketch.getByRole('group',{name:'DWG layers',exact:true});
 await expect(layers).toBeVisible();
 await expect(sketch.getByText('Paper-space layout entities were skipped.',{exact:true})).toBeVisible();
 await layers.getByRole('checkbox',{name:'GUIDES',exact:true}).uncheck();
 await press(sketch.getByRole('button',{name:'Import selected layers',exact:true}));
 await expect(sketch.getByLabel('Sketch name')).toHaveValue('Inch plate');
 await expect(sketch.getByLabel('Outline points X, Y (mm)')).toHaveValue(/50\.8, 25\.4/);
 await expect(page.getByTestId('object-name')).toHaveCount(0);
 await press(sketch.getByRole('button',{name:'Create extrusion',exact:true}));
 await expect(sketch).toBeHidden();

 const exportDxf=page.getByRole('button',{name:'Export sketch as DXF',exact:true});
 if(!await exportDxf.isVisible())await press(page.getByRole('button',{name:'Properties',exact:true}));
 const [download]=await Promise.all([page.waitForEvent('download'),press(exportDxf)]);
 const dxf=await readFile((await download.path())!,'utf8');
 expect(dxf).toContain('$INSUNITS\r\n70\r\n4');
 expect(dxf).toContain('10\r\n50.8\r\n20\r\n25.4');
});

test('opens a unitless DWG guide after explicit confirmation',async({page,hasTouch})=>{
 const press=(control:ReturnType<typeof page.getByRole>)=>hasTouch?control.tap():control.click();
 await page.goto('/');
 await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');
 await press(page.getByRole('button',{name:'Sketch path',exact:true}));
 const sketch=page.getByRole('dialog',{name:'Sketch path',exact:true});
 await press(sketch.getByText('DXF or DWG path',{exact:true}));
 await sketch.getByLabel('Choose DWG file',{exact:true}).setInputFiles({name:'Guide.dwg',mimeType:'application/acad',
  buffer:Buffer.from(sketchDwgFixture({closed:false,units:0,extraLayers:false}))});
 await expect(sketch.getByRole('status',{name:'Sketch status'})).toContainText('has no units');
 await press(sketch.getByRole('checkbox',{name:'Assume millimetres if the file has no units'}));
 await press(sketch.getByRole('button',{name:'Import selected layers',exact:true}));
 await expect(sketch.getByLabel('Path points X, Y (mm)')).toHaveValue(/2, 1$/);
 await press(sketch.getByRole('button',{name:'Save path',exact:true}));
 await expect(sketch).toBeHidden();
 const saved=page.getByRole('button',{name:'Sketch path: Guide',exact:true});
 await press(saved);
 await expect(sketch.getByLabel('Path points X, Y (mm)')).toHaveValue(/2, 1$/);
});
