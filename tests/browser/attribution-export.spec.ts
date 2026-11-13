// SPDX-License-Identifier: BSD-3-Clause
import {expect,test} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {createCadSession,serializeDocument} from '@brickwright/cad-core';
import type {ModelLibraryAsset} from '@brickwright/cad-core';
import type {Page} from '@playwright/test';
async function openExport(page:Page){await page.getByLabel('File menu',{exact:true}).click();await page.getByRole('button',{name:'Export…',exact:true}).click();}
async function fixture(){
 const asset=JSON.parse(await readFile('library/seed-catalogue.json','utf8')).assets[0] as ModelLibraryAsset;
 const session=createCadSession();const id=session.add({kind:'box',size:[10,10,10]});
 session.attachProvenance([id],{id:'source',asset,selectedFile:asset.original,modificationNotes:'Inserted at declared scale.'});
 return serializeDocument(session.state.document);
}
test('browser export requires notes, refuses attributed 3MF, cancels safely and downloads STL plus attribution as one ZIP',async({page})=>{
 const document=await fixture();
 await page.addInitScript(document=>localStorage.setItem('brickwright-cad:standalone:v1',document),document);
 await page.goto('/');await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');
 const before=await page.evaluate(()=>localStorage.getItem('brickwright-cad:standalone:v1'));
 await openExport(page);const dialog=page.getByRole('dialog',{name:'Export model',exact:true}),notes=dialog.getByLabel('Changes since insertion',{exact:true});
 await expect(notes).toBeVisible();await expect(dialog).toContainText('one ZIP');
 let downloads=0;page.on('download',()=>downloads++);
 await dialog.getByRole('button',{name:'Export',exact:true}).click();await expect(page.getByRole('status',{name:'Editor status'})).toContainText('Describe changes');await expect(dialog).toBeVisible();expect(downloads).toBe(0);
 await notes.fill('Unchanged since insertion.');await dialog.getByLabel('Export format',{exact:true}).selectOption('3mf');
 await dialog.getByRole('button',{name:'Export',exact:true}).click();await expect(page.getByRole('status',{name:'Editor status'})).toContainText('3MF attribution export is not supported');expect(downloads).toBe(0);
 await dialog.getByRole('button',{name:'Cancel export',exact:true}).click();await expect(dialog).toBeHidden();expect(downloads).toBe(0);
 await openExport(page);await expect(notes).toHaveValue('');await notes.fill('Unchanged since insertion.');await dialog.getByLabel('Export format',{exact:true}).selectOption('stl');
 const pending=page.waitForEvent('download');await dialog.getByRole('button',{name:'Export',exact:true}).click();const download=await pending;await expect(dialog).toBeHidden();
 expect(download.suggestedFilename()).toMatch(/\.stl\.zip$/);const entries=unzipSync(new Uint8Array(await readFile((await download.path())!))),name=download.suggestedFilename().slice(0,-4);
 expect(Object.keys(entries)).toEqual([name,`${name}.attribution.json`]);
 const sidecar=JSON.parse(new TextDecoder().decode(entries[`${name}.attribution.json`]));
 expect(sidecar.output.sha256).toBe(createHash('sha256').update(entries[name]).digest('hex'));expect(sidecar.output.modificationNotes).toBe('Unchanged since insertion.');expect(sidecar.project.sha256).toBe(createHash('sha256').update(document).digest('hex'));expect(sidecar.records[0].id).toBe('source');expect(downloads).toBe(1);
 expect(await page.evaluate(()=>localStorage.getItem('brickwright-cad:standalone:v1'))).toBe(before);
});
test('native paired export keeps the notes dialog open when the save is canceled',async({page})=>{
 const document=await fixture();
 await page.addInitScript(document=>{
  localStorage.setItem('brickwright-cad:standalone:v1',document);
  const host=window as unknown as {brickwrightDesktop:boolean;webkit:unknown;exports:{name:string;data:string}[]};host.brickwrightDesktop=true;host.exports=[];
  host.webkit={messageHandlers:{cadSave:{postMessage:async(file:{name:string;data:string})=>{host.exports.push(file);return {saved:false};}}}};
 },document);
 await page.goto('/');await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');
 await openExport(page);const dialog=page.getByRole('dialog',{name:'Export model',exact:true});await dialog.getByLabel('Changes since insertion',{exact:true}).fill('Unchanged since insertion.');await dialog.getByRole('button',{name:'Export',exact:true}).click();
 await expect(page.getByRole('status',{name:'Editor status'})).toContainText('Save canceled');await expect(dialog).toBeVisible();
 const files=await page.evaluate(()=>(window as unknown as {exports:{name:string;data:string}[]}).exports);expect(files).toHaveLength(1);expect(files[0].name).toMatch(/\.stl\.zip$/);expect(Object.keys(unzipSync(new Uint8Array(Buffer.from(files[0].data,'base64'))))).toHaveLength(2);
});
test('canceling while attribution hashes are pending delivers no partial file',async({page})=>{
 const document=await fixture();await page.addInitScript(document=>localStorage.setItem('brickwright-cad:standalone:v1',document),document);
 await page.goto('/');await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');
 await page.evaluate(()=>{
  const host=window as unknown as {pendingHashes:(()=>void)[]};host.pendingHashes=[];
  const digest=crypto.subtle.digest.bind(crypto.subtle);
  crypto.subtle.digest=async(algorithm,data)=>{await new Promise<void>(resolve=>host.pendingHashes.push(resolve));return digest(algorithm,data);};
 });
 let downloads=0;page.on('download',()=>downloads++);
 await openExport(page);const dialog=page.getByRole('dialog',{name:'Export model',exact:true});await dialog.getByLabel('Changes since insertion',{exact:true}).fill('Unchanged since insertion.');await dialog.getByRole('button',{name:'Export',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as unknown as {pendingHashes:unknown[]}).pendingHashes.length)).toBe(2);
 await dialog.getByRole('button',{name:'Cancel export',exact:true}).click();await expect(dialog).toBeHidden();
 await page.evaluate(()=>(window as unknown as {pendingHashes:(()=>void)[]}).pendingHashes.splice(0).forEach(resolve=>resolve()));
 await expect(page.getByRole('status',{name:'Editor status'})).toContainText('Export canceled');expect(downloads).toBe(0);
});
