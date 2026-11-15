// SPDX-License-Identifier: BSD-3-Clause
import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {adafruitArchive} from '../../packages/editor/src/adafruit-archive-data.js';
test.use({serviceWorkers:'block'});
test('browse originals without a request, download verified bytes and reuse offline',async({page,context})=>{
 let requests=0;
 await page.route(adafruitArchive.licenceUrl,async route=>{requests++;await route.fulfill({body:adafruitArchive.licence,headers:{'access-control-allow-origin':'*'}});});
 await page.goto('/');await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');
 await page.getByLabel('File menu',{exact:true}).click();await page.getByRole('button',{name:'Model library',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Model library',exact:true});
 await dialog.getByLabel('Search models').fill('Adafruit archive files');
 await dialog.locator('.model-library-card').filter({hasText:'Adafruit archive files'}).click();
 await expect(dialog).toContainText('units and orientation have not been verified');expect(requests).toBe(0);
 const root=adafruitArchive.folders.find(f=>f.name==='Adafruit archive files')!;
 await dialog.getByLabel('Original file').selectOption(String(root.files.findIndex(f=>f.path==='LICENSE')));
 await dialog.getByText('Original source files',{exact:true}).click();
 const downloading=page.waitForEvent('download');await dialog.getByRole('button',{name:'Download verified original'}).click();
 expect(await readFile((await (await downloading).path())!,'utf8')).toBe(adafruitArchive.licence);expect(requests).toBe(1);
 await context.setOffline(true);await dialog.getByLabel('Use cached files only').check();
 const cached=page.waitForEvent('download');await dialog.getByRole('button',{name:'Download verified original'}).click();
 expect(await readFile((await (await cached).path())!,'utf8')).toBe(adafruitArchive.licence);expect(requests).toBe(1);
});

test('screen and insert a real original only after explicit units and up axis',async({page})=>{
 const path='5128 MacroPad RP2040 Kit/5128 MacroPad RP2040-Keyplate.stl';
 const folder=adafruitArchive.folders.find(f=>f.name==='5128 MacroPad RP2040 Kit')!;
 const original=folder.files.find(f=>f.path===path)!;
 const url=adafruitArchive.baseUrl+path.split('/').map(encodeURIComponent).join('/');
 const bytes=await readFile('tests/fixtures/adafruit/keyplate.stl');
 expect(bytes.length).toBe(original.bytes);
 await page.route(url,route=>route.fulfill({body:bytes,headers:{'access-control-allow-origin':'*'}}));
 await page.goto('/');await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');
 await page.getByLabel('File menu',{exact:true}).click();await page.getByRole('button',{name:'Model library',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Model library',exact:true});await dialog.getByLabel('Search models').fill('5128 MacroPad');
 await dialog.locator('.model-library-card').filter({hasText:'5128 MacroPad RP2040 Kit'}).click();
 await dialog.getByLabel('Original file').selectOption(String(folder.files.indexOf(original)));
 const insert=dialog.getByRole('button',{name:'Screen and insert STL'});await expect(insert).toBeDisabled();
 await dialog.getByLabel('STL source units').selectOption('mm');await dialog.getByLabel('STL source up axis').selectOption('Z');await expect(insert).toBeEnabled();await insert.click();
 await expect(dialog.getByRole('status')).toContainText('STL inserted with provenance');
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('brickwright-cad:standalone:v1')!));
 expect(saved.provenance.records[0].selectedFile.sha256).toBe(original.sha256);
 expect(saved.provenance.records[0].asset.conversion.unitAssumption).toContain('User selected mm and Z up');
 await dialog.getByRole('button',{name:'Close model library'}).click();await page.getByRole('button',{name:'Undo',exact:true}).click();
 await page.getByRole('button',{name:'Redo',exact:true}).click();expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('brickwright-cad:standalone:v1')!))).toEqual(saved);
});
