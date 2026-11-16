// SPDX-License-Identifier: BSD-3-Clause
import {test,expect} from '@playwright/test';
import {adafruitArchive} from '../../packages/editor/src/adafruit-archive-data.js';
test.use({serviceWorkers:'block'});
test('local catalogue browsing stays offline and archive previews load only on explicit demand',async({page,context})=>{
 test.setTimeout(240000);
 await page.goto('/');await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');
 const before=await page.evaluate(()=>localStorage.getItem('brickwright-cad:standalone:v1'));
 let offline=true;const offlineRequests:string[]=[],previewRequests:string[]=[];
 page.on('request',request=>{if(offline)offlineRequests.push(request.url());if(request.url().includes('adafruit-preview-data-'))previewRequests.push(request.url());});
 await context.setOffline(true);
 await page.getByLabel('File menu',{exact:true}).click();await page.getByRole('button',{name:'Model library',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Model library',exact:true});await expect(dialog).toBeVisible();
 await dialog.getByLabel('Search models').fill('Adafruit archive files');
 await dialog.locator('[data-archive-folder]').filter({has:page.getByText('Adafruit archive files',{exact:true})}).click();
 await expect(dialog).toContainText('units and orientation have not been verified');
 await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
 expect(offlineRequests).toEqual([]);expect(previewRequests).toEqual([]);
 expect(await page.evaluate(()=>localStorage.getItem('brickwright-cad:standalone:v1'))).toBe(before);
 offline=false;await context.setOffline(false);
 const folder=adafruitArchive.folders.find(f=>f.name!=='Adafruit archive files')!;
 await dialog.getByLabel('Search models').fill(folder.name);
 await dialog.locator('[data-archive-folder]').filter({has:page.getByText(folder.name,{exact:true})}).click();
 const image=dialog.locator('.model-library-details .model-library-preview img[data-adafruit-preview]');
 await expect(image).toHaveAttribute('src',/^data:image\/png;base64,/);
 await expect(image).toHaveJSProperty('complete',true);await expect(image).toHaveJSProperty('naturalWidth',256);await expect(image).toHaveJSProperty('naturalHeight',192);
 expect(previewRequests).toHaveLength(1);
 expect(await page.evaluate(()=>localStorage.getItem('brickwright-cad:standalone:v1'))).toBe(before);
});
