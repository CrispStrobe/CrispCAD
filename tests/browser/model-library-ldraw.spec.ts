// SPDX-License-Identifier: BSD-3-Clause
import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createLocalModelLibraryCatalogue} from '@brickwright/cad-core';
test.use({serviceWorkers:'block'});
const manifest=JSON.parse(readFileSync('library/ldraw-editor-manifest.json','utf8')),asset=manifest.assets[0];
async function saved(page:any){return page.evaluate(()=>JSON.parse(localStorage.getItem('brickwright-cad:standalone:v1')!));}
async function open(page:any){await page.getByLabel('File menu',{exact:true}).click();await page.getByRole('button',{name:'Model library',exact:true}).click();return page.getByRole('dialog',{name:'Model library',exact:true});}
test('authored LDraw tile preview and verified mesh insert offline with provenance and history',async({page,context})=>{
 await page.goto('/');await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');const before=await saved(page),dialog=await open(page);
 await dialog.getByRole('button',{name:`${asset.title} · CC-BY-4.0`,exact:true}).click();
 const image=dialog.locator('.model-library-preview img');await expect(image).toBeVisible();expect(await image.evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth===220&&img.naturalHeight===180)).toBe(true);
 expect(await image.evaluate((img:HTMLImageElement)=>{const c=document.createElement('canvas');c.width=220;c.height=180;const ctx=c.getContext('2d')!;ctx.drawImage(img,0,0);return Array.from(ctx.getImageData(0,0,220,180).data).filter((v,i)=>i%4===3&&v>0).length;})).toBeGreaterThan(100);
 const attribution=await dialog.getByRole('textbox',{name:'Licence & attribution',exact:true}).inputValue();expect(attribution).toContain('Tore Eriksson');expect(attribution).toContain('James Jessiman');
 await context.setOffline(true);let requests=0;page.on('request',()=>requests++);
 await expect(dialog.getByRole('button',{name:'Insert selected STL',exact:true})).toBeEnabled();await dialog.getByRole('button',{name:'Insert selected STL',exact:true}).click();await expect(dialog.getByRole('status')).toContainText('Inserted with provenance');
 const after=await saved(page);expect(after.roots).toHaveLength(before.roots.length+1);const record=after.provenance.records.at(-1);expect(record.selectedFile.sha256).toBe(asset.derivatives[0].sha256);expect(record.asset.original.sha256).toBe(asset.original.sha256);expect(record.asset.sourceBundle.dependencies[0].file.sha256).toBe(asset.sourceBundle.dependencies[0].file.sha256);expect(record.asset.conversion.sourceUnits).toBe('ldu');
 await dialog.getByRole('button',{name:'Close model library'}).click();await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');expect(after.nodes[after.roots.at(-1)].kind).toBe('mesh');
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await saved(page)).toEqual(before);await page.getByRole('button',{name:'Redo',exact:true}).click();expect(await saved(page)).toEqual(after);expect(requests).toBe(0);
});
test('local STL hash mismatch preserves the project before insertion',async({page})=>{
 await page.goto('/');await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');const before=await saved(page),dialog=await open(page),catalogue=createLocalModelLibraryCatalogue(manifest),bad=catalogue.assets[0];
 bad.derivatives[0].sha256='0'.repeat(64);bad.quality!.fileSha256='0'.repeat(64);
 await dialog.getByLabel('Catalogue file',{exact:true}).setInputFiles({name:'bad-local.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(catalogue))});
 await dialog.getByRole('button',{name:`${asset.title} · CC-BY-4.0`,exact:true}).click();await expect(dialog.getByRole('button',{name:'Insert selected STL',exact:true})).toBeEnabled();await dialog.getByRole('button',{name:'Insert selected STL',exact:true}).click();await expect(dialog.getByRole('status')).toContainText('SHA-256 mismatch');expect(await saved(page)).toEqual(before);
});
