// SPDX-License-Identifier: BSD-3-Clause
import {test,expect} from '@playwright/test';
import {createPresetDocument} from '../../packages/editor/src/shapes.js';
test('hinge motor preview runs, pauses and resets without changing saved design',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');
 const doc=structuredClone(createPresetDocument('hinge'));for(const id of doc.roots)doc.nodes[id].transform.position[2]=70;
 await page.getByLabel('Open CAD project or STL',{exact:true}).setInputFiles({name:'hinge.bcad',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(doc))});
 await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');
 await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('brickwright-cad:standalone:v1')||'{}').title)).toBe('Hinge');
 const before=await page.evaluate(()=>localStorage.getItem('brickwright-cad:standalone:v1'));
 await page.getByRole('button',{name:'Simulate',exact:true}).click();
 const panel=page.getByRole('region',{name:'Assembly simulation'});
 // A labelled section is exposed as a region in both WebKit and Chromium.
 await expect(panel).toBeVisible();
 const speed=panel.getByRole('spinbutton',{name:/Speed \(degrees\/s\)/});await speed.fill('90');await speed.press('Tab');
 await panel.getByRole('button',{name:'Run simulation',exact:true}).click();
 await expect(panel).toHaveAttribute('data-state','running',{timeout:60000});
 await expect.poll(async()=>Number(await panel.getAttribute('data-time'))).toBeGreaterThan(.2);
 await panel.getByRole('button',{name:'Pause simulation',exact:true}).click();await expect(panel).toHaveAttribute('data-state','paused');
 await expect.poll(async()=>Math.abs(parseFloat(await panel.getByRole('status',{name:/Joint angle/}).textContent()??'0'))).toBeGreaterThan(1);
 await panel.getByRole('button',{name:'Stop motors',exact:true}).click();await expect(speed).toHaveValue('0');
 await panel.getByRole('button',{name:'Reset simulation',exact:true}).click();await expect(panel).toHaveAttribute('data-state','idle');
 expect(await page.evaluate(()=>localStorage.getItem('brickwright-cad:standalone:v1'))).toBe(before);expect(errors).toEqual([]);
});
