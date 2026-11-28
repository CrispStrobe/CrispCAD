// SPDX-License-Identifier: BSD-3-Clause
// Datums and tolerances on an exact assembly sheet (document version 52): tap the plate's top face
// in the front view, place datum A; then a flatness frame on the same face; the DXF (R2000) carries
// the automatic dimensions as DIMENSION entities and the frame's text; saved with the sheet, the
// datum is drawn again on reopening.
import {readFileSync} from 'node:fs';
import {expect,test} from '@playwright/test';

test('datums and tolerance frames attach to exact faces and are saved with the sheet',async({page})=>{
 test.setTimeout(300_000);
 await page.goto('/');
 const root=page.locator('#cad-root'),ready=()=>expect(root).toHaveAttribute('data-state','ready',{timeout:120_000});
 await ready();
 const hasTouch=await page.evaluate(()=>navigator.maxTouchPoints>0);
 const press=async(locator:ReturnType<typeof page.locator>)=>{if(hasTouch)await locator.tap();else await locator.click();};

 // A 40 × 30 × 10 plate with a Ø10 hole, as a sketch extrusion.
 await page.getByRole('button',{name:'Sketch',exact:true}).click();
 const sketch=page.getByRole('dialog',{name:'Sketch and extrusion'});
 await sketch.getByLabel('Profile',{exact:true}).selectOption('region');
 await sketch.getByLabel('Region loops (mm)').fill('0, 0 | 40, 0 | 40, 30 | 0, 30\nCIRCLE 12, 15, 5');
 await sketch.getByLabel('Extrusion distance (mm)',{exact:true}).fill('10');
 await sketch.getByRole('button',{name:'Create extrusion'}).click();
 await ready();

 const open=page.getByRole('button',{name:'Create assembly drawing',exact:true});
 if(!await open.isVisible())await page.getByRole('button',{name:'Objects',exact:true}).click();
 await open.click();
 const dialog=page.getByRole('dialog',{name:'Drawing sheet',exact:true});
 const preview=dialog.getByRole('img',{name:'Drawing preview'});
 await dialog.getByLabel('Drawing scale').selectOption('1:1');
 await press(dialog.getByRole('checkbox',{name:'Exact edges (B-rep)'}));
 await expect(preview).toContainText('Edges: exact B-rep (1 body)',{timeout:120_000});

 // Paper points to screen: the front view sits at (24, 47) at 1:1, so the plate's top face is the line y = 57.
 const screen=(x:number,y:number)=>preview.evaluate((svg,[px,py])=>{
  const point=new DOMPoint(px,210-py).matrixTransform((svg as unknown as SVGSVGElement).getScreenCTM()!);
  return {x:point.x,y:point.y};
 },[x,y] as const);
 const tap=async(x:number,y:number)=>{const p=await screen(x,y);if(hasTouch)await page.touchscreen.tap(p.x,p.y);else await page.mouse.click(p.x,p.y);};

 const gdt=dialog.locator('details.drawing-gdt');
 await press(gdt.locator('summary'));
 const add=gdt.getByRole('button',{name:'Add datum or tolerance'});
 const box=await add.boundingBox();
 expect(box!.height).toBeGreaterThanOrEqual(40);
 await expect(gdt.getByLabel('Datum letter')).toHaveValue('A');
 await press(add);
 await preview.scrollIntoViewIfNeeded();
 await tap(44,57.2);
 await expect(preview.locator('.drawing-gdt-marker')).toHaveCount(1);
 await expect(gdt.getByLabel('Attached to')).toContainText('face');
 await tap(44,72);
 await expect(gdt.getByRole('button',{name:'Datum A',exact:true})).toBeVisible({timeout:60_000});
 await expect(preview.locator('text').filter({hasText:/^A$/})).toHaveCount(1);

 // A flatness frame on the same face.
 await gdt.getByLabel('Symbol').selectOption('tolerance');
 await gdt.getByLabel('Characteristic').selectOption('flatness');
 await gdt.getByLabel('Tolerance (mm)').fill('0.05');
 await press(add);
 await tap(30,57.2);
 await expect(preview.locator('.drawing-gdt-marker')).toHaveCount(1);
 await tap(70,80);
 await expect(gdt.getByRole('button',{name:/^Tolerance 1 · Flatness$/})).toBeVisible({timeout:60_000});
 await expect(preview.locator('text').filter({hasText:/^0\.05$/})).toHaveCount(1);
 await expect(dialog.getByRole('button',{name:'Export drawing DXF'})).toBeEnabled();

 // DXF R2000: DIMENSION entities for the automatic dimensions, the frame's value as text.
 await dialog.getByLabel('DXF version').selectOption('R2000');
 const [download]=await Promise.all([page.waitForEvent('download'),press(dialog.getByRole('button',{name:'Export drawing DXF'}))]);
 const dxf=readFileSync((await download.path())!,'latin1').split(/\r?\n/);
 expect(dxf[dxf.indexOf('$ACADVER')+2]).toBe('AC1015');
 expect(dxf.filter((line,i)=>line==='DIMENSION'&&dxf[i-1].trim()==='0').length).toBeGreaterThan(0);
 expect(dxf).toContain('*D1');
 expect(dxf).toContain('0.05');

 // Saved with the sheet and drawn again when it is reopened.
 await press(dialog.getByRole('button',{name:'Save drawing sheet'}));
 await expect(dialog).toBeHidden();
 const saved=page.getByRole('button',{name:/^Drawing: /});
 if(!await saved.isVisible())await page.getByRole('button',{name:'Objects',exact:true}).click();
 await saved.click();
 await expect(preview).toContainText('Edges: exact B-rep (1 body)',{timeout:120_000});
 await expect(preview.locator('text').filter({hasText:/^A$/})).toHaveCount(1);
 await expect(preview.locator('text').filter({hasText:/^0\.05$/})).toHaveCount(1);
 await expect(dialog.getByText('Reference lost')).toHaveCount(0);
 await expect(dialog.getByRole('button',{name:'Export drawing DXF'})).toBeEnabled();
 await expect(root).not.toHaveAttribute('data-state','error');
});
