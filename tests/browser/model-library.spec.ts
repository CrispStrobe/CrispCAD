// SPDX-License-Identifier: BSD-3-Clause
import {test,expect,type Page} from '@playwright/test';
import {createHash} from 'node:crypto';
import {checkModelLibrarySTL} from '@brickwright/cad-geometry';
import type {ModelLibraryCatalogue} from '@brickwright/cad-core';
import {addShape} from './ui.js';
// Keep synthetic HTTPS interception outside the app-shell service worker.
test.use({serviceWorkers:'block'});
const matrix=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
// Synthetic test endpoint, intercepted below. This is not a published catalogue asset.
const endpoint='https://library-test.example/fixture.stl';
const points=[[0,0,0],[10,0,0],[0,10,0],[0,0,10]],faces=[[0,2,1],[0,1,3],[0,3,2],[1,2,3]];
const bytes=Buffer.from(`solid test\n${faces.map(face=>`facet normal 0 0 0\nouter loop\n${face.map(i=>`vertex ${points[i].join(' ')}`).join('\n')}\nendloop\nendfacet`).join('\n')}\nendsolid test`);
async function catalogue():Promise<ModelLibraryCatalogue>{
 const quality=await checkModelLibrarySTL(bytes,{toMillimetresZUp:matrix,checkedOn:'2026-11-13'});
 return {format:'brickwright-model-library',version:1,assets:[{id:'test-tetrahedron',version:'1',title:'Browser fixture',author:'Test author',sourceUrl:'https://library-test.example/source',licence:{spdx:'BSD-3-Clause',scope:'asset',attribution:'Synthetic test geometry',evidenceUrl:'https://library-test.example/evidence',capturedOn:'2026-11-13',review:'accepted',reviewer:'Test curator'},original:{url:endpoint,format:'stl',sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length},derivatives:[],modificationNotes:'Original test mesh.',conversion:{sourceUnits:'mm',unitAssumption:'Test geometry is in millimetres.',sourceUpAxis:'Z',toMillimetresZUp:matrix},quality:quality.quality}]};
}
async function open(page:Page){await page.getByLabel('File menu',{exact:true}).click();await page.getByRole('button',{name:'Model library',exact:true}).click();return page.getByRole('dialog',{name:'Model library',exact:true});}
async function load(page:Page,value:unknown){await page.getByLabel('Open catalogue JSON',{exact:true}).setInputFiles({name:'catalogue.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});}
async function saved(page:Page){return page.evaluate(()=>JSON.parse(localStorage.getItem('brickwright-cad:standalone:v1')!));}

test('browse without fetching, insert one verified model with provenance, undo and reuse cached bytes offline',async({page})=>{
 let requests=0;await page.route(endpoint,async route=>{requests++;await route.fulfill({body:bytes,contentType:'model/stl',headers:{'access-control-allow-origin':'*'}});});
 await page.goto('/');await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');
 await addShape(page,'Box');await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');
 const before=await saved(page),dialog=await open(page);
 await expect(dialog).toContainText('No published catalogue is bundled');await load(page,await catalogue());
 await page.getByLabel('Search models',{exact:true}).fill('missing');await expect(dialog).toContainText('No matching models.');await page.getByLabel('Search models',{exact:true}).fill('fixture');
 await dialog.getByRole('button',{name:'Browser fixture · BSD-3-Clause',exact:true}).click();
 await expect(dialog).toContainText('Selected STL conversion to millimetres, Z up');await expect(dialog).toContainText('Curated limits:');
 await expect(dialog.getByRole('link',{name:'Licence evidence'})).toHaveAttribute('href','https://library-test.example/evidence');
 const insert=dialog.getByRole('button',{name:'Insert selected STL',exact:true});await expect(insert).toBeDisabled();
 await page.getByLabel('Incorporation modification notes',{exact:true}).fill('Applied recorded millimetres/Z-up conversion; no repair.');expect(requests).toBe(0);
 await insert.click();await expect(dialog.getByRole('status')).toContainText('Inserted with provenance');expect(requests).toBe(1);
 const inserted=await saved(page);expect(inserted.roots).toHaveLength(2);expect(inserted.provenance.records[0].asset.id).toBe('test-tetrahedron');
 await dialog.getByRole('button',{name:'Close model library'}).click();await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await saved(page)).toEqual(before);
 await page.getByRole('button',{name:'Redo',exact:true}).click();expect(await saved(page)).toEqual(inserted);
 const reopened=await open(page);await load(page,await catalogue());await reopened.getByRole('button',{name:'Browser fixture · BSD-3-Clause',exact:true}).click();await reopened.getByLabel('Incorporation modification notes',{exact:true}).fill('Reused verified cached model unchanged.');await reopened.getByLabel('Use cached files only',{exact:true}).check();await reopened.getByRole('button',{name:'Insert selected STL',exact:true}).click();await expect(reopened.getByRole('status')).toContainText('Inserted with provenance');expect(requests).toBe(1);expect((await saved(page)).roots).toHaveLength(3);
 const reused=await saved(page);await page.reload();await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');expect(await saved(page)).toEqual(reused);
});

test('bad metadata, missing quality, offline misses and corrupt bytes preserve the existing model',async({page})=>{
 let requests=0;await page.route(endpoint,async route=>{requests++;await route.fulfill({body:Buffer.alloc(bytes.length),headers:{'access-control-allow-origin':'*'}});});
 await page.goto('/');await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');const before=await saved(page),dialog=await open(page);
 await load(page,{format:'brickwright-local-example-library',version:1,assets:[]});await expect(dialog.getByRole('status')).toContainText('Unsupported');
 const value=await catalogue();delete value.assets[0].quality;await load(page,value);await dialog.getByRole('button',{name:'Browser fixture · BSD-3-Clause',exact:true}).click();await dialog.getByLabel('Incorporation modification notes',{exact:true}).fill('Unchanged.');await expect(dialog.getByRole('button',{name:'Insert selected STL',exact:true})).toBeDisabled();
 await load(page,await catalogue());await dialog.getByRole('button',{name:'Browser fixture · BSD-3-Clause',exact:true}).click();await dialog.getByLabel('Incorporation modification notes',{exact:true}).fill('Unchanged.');await dialog.getByLabel('Use cached files only',{exact:true}).check();await dialog.getByRole('button',{name:'Insert selected STL',exact:true}).click();await expect(dialog.getByRole('status')).toContainText('unavailable offline');expect(requests).toBe(0);
 await dialog.getByLabel('Use cached files only',{exact:true}).uncheck();await dialog.getByRole('button',{name:'Insert selected STL',exact:true}).click();await expect(dialog.getByRole('status')).toContainText('SHA-256 mismatch');expect(requests).toBe(1);expect(await saved(page)).toEqual(before);
});

test('closing an in-flight download cancels insertion',async({page})=>{
 let release!:()=>void,started!:()=>void;const requested=new Promise<void>(resolve=>{started=resolve;});const waiting=new Promise<void>(resolve=>{release=resolve;});
 await page.route(endpoint,async route=>{started();await waiting;await route.fulfill({body:bytes,headers:{'access-control-allow-origin':'*'}}).catch(()=>{});});
 await page.goto('/');await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');const before=await saved(page),dialog=await open(page);await load(page,await catalogue());await dialog.getByRole('button',{name:'Browser fixture · BSD-3-Clause',exact:true}).click();await dialog.getByLabel('Incorporation modification notes',{exact:true}).fill('Unchanged.');await dialog.getByRole('button',{name:'Insert selected STL',exact:true}).click();await requested;await dialog.getByRole('button',{name:'Close model library'}).click();release();await expect(dialog).toBeHidden();await open(page);await expect(dialog.getByRole('button',{name:'Browser fixture · BSD-3-Clause',exact:true})).toBeEnabled();expect(await saved(page)).toEqual(before);
});
