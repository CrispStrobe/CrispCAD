// SPDX-License-Identifier: BSD-3-Clause
// Exact drawing follow-ups in the editor: automatic dimensions on an exact assembly sheet (overall
// size, hole position, the hole's diameter), SVG and DXF export of the sheet (DXF read back: the
// hole a true CIRCLE of radius 5 on paper at 1:1), and the exact-edges choice saved with the sheet.
import {readFileSync} from 'node:fs';
import {expect,test} from '@playwright/test';

test('an exact assembly sheet dimensions itself and exports SVG and DXF',async({page})=>{
 test.setTimeout(300_000);
 await page.goto('/');
 const root=page.locator('#cad-root'),ready=()=>expect(root).toHaveAttribute('data-state','ready',{timeout:120_000});
 await ready();

 // A 40 × 30 × 10 plate with a Ø10 hole at (12, 15), as a sketch extrusion.
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
 const auto=dialog.getByRole('checkbox',{name:'Automatic dimensions'});
 await expect(auto).toBeDisabled();
 await dialog.getByRole('checkbox',{name:'Exact edges (B-rep)'}).tap();
 await expect(preview).toContainText('Edges: exact B-rep (1 body)',{timeout:120_000});
 await expect(auto).toBeEnabled();
 await expect(auto).toBeChecked();
 // Overall size, the hole's position from the left and bottom edges, and its diameter.
 const labels=await preview.locator('text').allTextContents();
 for(const value of ['40','30','10','12','15','Ø10'])expect(labels).toContain(value);
 expect(await preview.locator('text[transform^="rotate(-90"]').count()).toBeGreaterThan(0);

 // SVG and DXF of the sheet.
 const [svgDownload]=await Promise.all([page.waitForEvent('download'),dialog.getByRole('button',{name:'Export drawing SVG'}).tap()]);
 expect(svgDownload.suggestedFilename()).toMatch(/\.svg$/);
 const svg=readFileSync((await svgDownload.path())!,'utf8');
 expect(svg).toContain('viewBox="0 0 297 210"');
 expect(svg).toMatch(/<circle class="visible" [^>]*r="5"\/>/);
 await dialog.getByLabel('DXF version').selectOption('R12');
 const [dxfDownload]=await Promise.all([page.waitForEvent('download'),dialog.getByRole('button',{name:'Export drawing DXF'}).tap()]);
 expect(dxfDownload.suggestedFilename()).toMatch(/\.dxf$/);
 const dxf=readFileSync((await dxfDownload.path())!,'latin1').split(/\r?\n/);
 expect(dxf[dxf.indexOf('$ACADVER')+2]).toBe('AC1009');
 const circles=dxf.flatMap((line,i)=>line==='CIRCLE'&&dxf[i-1].trim()==='0'?[Number(dxf[dxf.indexOf(' 40',i)+1])]:[]);
 expect(circles).toContain(5);
 expect(dxf).toContain('Ø10');

 // Saved with the sheet: reopening it draws exact edges with dimensions again.
 await dialog.getByRole('button',{name:'Save drawing sheet'}).tap();
 await expect(dialog).toBeHidden();
 const saved=page.getByRole('button',{name:/^Drawing: /});
 if(!await saved.isVisible())await page.getByRole('button',{name:'Objects',exact:true}).click();
 await saved.click();
 await expect(dialog.getByRole('checkbox',{name:'Exact edges (B-rep)'})).toBeChecked();
 await expect(preview).toContainText('Edges: exact B-rep (1 body)',{timeout:120_000});
 expect(await preview.locator('text').allTextContents()).toContain('Ø10');
 await expect(root).not.toHaveAttribute('data-state','error');
});
