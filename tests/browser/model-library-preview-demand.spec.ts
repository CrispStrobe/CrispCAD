// SPDX-License-Identifier: BSD-3-Clause
import {test,expect} from '@playwright/test';
import {adafruitArchive} from '../../packages/editor/src/adafruit-archive-data.js';

test('model and Adafruit previews load near the viewport and work offline after visiting',async({page,context})=>{
 const previewRequests:string[]=[];
 page.on('request',request=>{if(new URL(request.url()).pathname.includes('/previews/'))previewRequests.push(request.url());});
 await page.goto('/');
 await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');
 await page.waitForFunction(()=>navigator.serviceWorker.controller !== null);
 expect(previewRequests).toEqual([]);
 await expect(page.locator('#cad-root .model-library-dialog')).toHaveCount(0);
 const before=await page.evaluate(()=>localStorage.getItem('brickwright-cad:standalone:v1'));
 const open=async()=>{
  await page.getByLabel('File menu',{exact:true}).click();
  await page.getByRole('button',{name:'Model library',exact:true}).click();
 };
 await open();
 const dialog=page.getByRole('dialog',{name:'Model library',exact:true});
 const modelImage=dialog.locator('.model-library-list img').first();
 await expect(modelImage).toHaveJSProperty('naturalWidth',220);
 await expect(page.locator('#cad-root .model-library-dialog')).toHaveCount(1);
 const cards=dialog.locator('.model-library-card'),first=await cards.first().textContent();
 await expect(cards).toHaveCount(36);
 expect(previewRequests.length).toBeLessThan(40);
 await dialog.getByRole('button',{name:'Next page',exact:true}).click();
 await expect(cards.first()).not.toHaveText(first!);
 await expect(cards).toHaveCount(36);
 const folder=adafruitArchive.folders.filter(f=>f.name!=='Adafruit archive files').at(-1)!;
 const chooseFolder=async()=>{
  await dialog.getByLabel('Search models').fill(folder.name);
  await dialog.locator('[data-archive-folder]').filter({has:page.getByText(folder.name,{exact:true})}).click();
 };
 await chooseFolder();
 const image=dialog.locator('.model-library-details img[data-adafruit-preview]');
 await expect(image).toHaveAttribute('src',/\/previews\/[a-f0-9]{64}\.png$/);
 await expect(image).toHaveJSProperty('naturalWidth',256);
 const url=await image.getAttribute('src');
 await page.waitForFunction(async src=>{
  const cache=await caches.open('bw-cad-previews-v1');
  return Boolean((await cache.match(new URL(src!,location.href).href))?.ok);
 },url);
 await context.setOffline(true);
 await dialog.getByRole('button',{name:'Close model library'}).click();
 await page.reload();
 await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');
 await open();
 await chooseFolder();
 await expect(image).toHaveJSProperty('naturalWidth',256);
 expect(await page.evaluate(()=>localStorage.getItem('brickwright-cad:standalone:v1'))).toBe(before);
});
