// SPDX-License-Identifier: BSD-3-Clause
// STEP import on a tablet: while the exact worker reads a many-body file, the status bar's exact
// chip says how far it has got (reading the file, then body k of n) and offers Cancel (44 px, by
// touch); cancelling imports nothing and leaves the model and its history as they were, and a
// second import of a smaller file completes with every body.
import {readFileSync} from 'node:fs';
import {expect,test} from '@playwright/test';

const FEATHER='library/sources/adafruit-electronics/4884 Feather RP2040.step';
const MPM='library/sources/adafruit-electronics/4739 MPM3610 5V Buck.step';

test('STEP import shows its progress, can be cancelled by touch, and imports every body',async({page},info)=>{
 test.setTimeout(600_000);
 const touch=!!info.project.use.hasTouch;
 await page.goto('/');
 const root=page.locator('#cad-root');
 await expect(root).toHaveAttribute('data-state','ready',{timeout:120_000});
 const iterations=await page.getByLabel('Model iteration',{exact:true}).locator('option').count();
 const choose=async(file:string)=>{
  const menu=page.locator('summary[aria-label="File menu"]');
  if(touch)await menu.tap();else await menu.click();
  const chooser=page.waitForEvent('filechooser');
  const item=page.getByRole('button',{name:'Import STEP as exact bodies…',exact:true});
  if(touch)await item.tap();else await item.click();
  await (await chooser).setFiles({name:file.split('/').pop()!,mimeType:'model/step',buffer:readFileSync(file)});
 };
 const chip=page.locator('.exact-activity');

 // The 58-body board: cancel once the worker is storing bodies.
 await choose(FEATHER);
 await expect(chip).toBeVisible({timeout:60_000});
 await expect(chip).toHaveAttribute('data-progress',/^(read|body) /,{timeout:120_000});
 await expect(chip).toHaveAttribute('data-progress',/^body \d+\/58$/,{timeout:300_000});
 await expect(chip).toContainText(/body \d+ of 58/);
 const cancel=chip.getByRole('button',{name:'Cancel exact kernel job',exact:true});
 expect((await cancel.boundingBox())!.height).toBeGreaterThanOrEqual(touch?44:20);
 if(touch)await cancel.tap();else await cancel.click();
 await expect(chip).toBeHidden({timeout:30_000});
 await expect(page.getByText('Request cancelled')).toBeVisible();
 await expect(page.getByTestId('object-name')).toHaveCount(0);
 expect(await page.getByLabel('Model iteration',{exact:true}).locator('option').count()).toBe(iterations);

 // The 23-body regulator board imports whole, with its progress seen on the way.
 await choose(MPM);
 await expect(chip).toHaveAttribute('data-progress',/^(read|body) /,{timeout:120_000});
 await expect(page.getByTestId('object-name')).toHaveCount(23,{timeout:300_000});
 await expect(chip).toBeHidden({timeout:60_000});
 await expect(root).toHaveAttribute('data-state','ready',{timeout:120_000});
});
