// SPDX-License-Identifier: BSD-3-Clause
// Assembly drawings from exact edges (Phase 6.1) in the editor: the exact kernel is fetched only
// when the sheet asks for exact edges; the hole is then a true circle of the exact radius, the
// sheet names its edge source and adds the isometric view and exact measures, the PDF draws Bézier
// arcs, and switching back draws the mesh projection again.
import {expect,test} from '@playwright/test';

test('an assembly sheet switches to exact B-rep edges and exports them',async({page})=>{
 test.setTimeout(300_000);
 const requests:string[]=[];page.on('request',request=>requests.push(new URL(request.url()).pathname));
 await page.goto('/');
 const root=page.locator('#cad-root'),ready=()=>expect(root).toHaveAttribute('data-state','ready',{timeout:120_000});
 await ready();

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
 await expect(preview).toContainText('Assembly · 1 body');
 await expect(preview).not.toContainText('Edges: exact B-rep');
 expect(requests.filter(path=>path.includes('/assets/exact/'))).toEqual([]);
 // The mesh projection draws the hole as chords, so the preview has no circle element.
 await expect(preview.locator('circle')).toHaveCount(0);

 const exact=dialog.getByRole('checkbox',{name:'Exact edges (B-rep)'});
 await exact.check();
 await expect(preview).toContainText('Edges: exact B-rep (1 body)',{timeout:120_000});
 expect(requests.some(path=>/\/assets\/exact\/smlibwasm-[^/]+\.wasm$/.test(path))).toBe(true);
 await expect(preview).toContainText('Exact overall size 40 × 30 × 10 mm · Holes 1 × Ø10 mm');
 await expect(preview).toContainText('Isometric view');
 // The top view's hole: one true circle of radius 5 mm at 1:1.
 const radii=await preview.locator('circle').evaluateAll(circles=>circles.map(circle=>Number(circle.getAttribute('r'))));
 expect(radii).toContain(5);
 // Hidden lines of the hole wall in the front and right views.
 await expect(preview.locator('.drawing-hidden').first()).toBeVisible();

 if(process.env.EXACT_DRAWING_SHOT)await preview.screenshot({path:process.env.EXACT_DRAWING_SHOT});
 const [download]=await Promise.all([page.waitForEvent('download'),dialog.getByRole('button',{name:'Export drawing PDF'}).click()]);
 const pdf=(await import('node:fs')).readFileSync((await download.path())!,'latin1');
 expect(pdf).toMatch(/ c /);

 // Back to the mesh projection: the preference is this editor's, not saved with the model.
 await exact.uncheck();
 await expect(preview).not.toContainText('Edges: exact B-rep',{timeout:60_000});
 await expect(preview.locator('circle')).toHaveCount(0);
 await expect(root).not.toHaveAttribute('data-state','error');
});
