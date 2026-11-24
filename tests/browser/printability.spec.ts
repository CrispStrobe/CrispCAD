// SPDX-License-Identifier: BSD-3-Clause
import {expect,test} from '@playwright/test';
import {createCadSession,serializeDocument,identityTransform} from '@brickwright/cad-core';
test('loads the printability worker analysis on demand without adding history',async({page})=>{
 const analysisRequests:string[]=[];
 page.on('request',request=>{
  const path=new URL(request.url()).pathname;
  if(/\/assets\/printability-[^/]+\.js$/.test(path))analysisRequests.push(path);
 });
 const session=createCadSession();session.add({kind:'box',size:[10,10,30]},{transform:{...identityTransform(),position:[0,0,15]}});session.add({kind:'box',size:[20,10,0.5]},{transform:{...identityTransform(),position:[15,0,25]}});
 await page.addInitScript(document=>localStorage.setItem('brickwright-cad:standalone:v1',document),serializeDocument(session.state.document));
 await page.goto('/');await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');
 expect(analysisRequests).toEqual([]);
 const iterations=await page.getByLabel('Model iteration',{exact:true}).locator('option').count();
 await page.getByLabel('File menu',{exact:true}).click();await page.getByRole('button',{name:'Check printability…',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Check printability',exact:true});
 await expect(dialog.locator('dd[data-status=fail]').first()).toBeVisible();
 await expect(dialog).toContainText('Minimum wall thickness');await expect(dialog).toContainText('0.5 mm (limit 0.8 mm)');
 await expect(dialog).toContainText('Suggested print orientation');
 expect(analysisRequests).toHaveLength(1);
 await dialog.getByLabel('Minimum wall (mm)',{exact:true}).fill('0.4');await dialog.getByRole('button',{name:'Run check',exact:true}).click();
 await expect(dialog).toContainText('(limit 0.4 mm)');
 expect(analysisRequests).toHaveLength(1);
 await dialog.getByRole('button',{name:'Close',exact:true}).click();await expect(dialog).toBeHidden();
 expect(await page.getByLabel('Model iteration',{exact:true}).locator('option').count()).toBe(iterations);
});
