// SPDX-License-Identifier: BSD-3-Clause
import {test,expect,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {createHash} from 'node:crypto';
import {checkModelLibrarySTL} from '@brickwright/cad-geometry';
import type {ModelLibraryCatalogue,ModelLibraryCollisionReport} from '@brickwright/cad-core';
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
// Synthetic metadata exercises presentation, not an assertion that a Jolt run occurred.
async function reportedCatalogue():Promise<ModelLibraryCatalogue>{
 const value=await catalogue(),asset=value.assets[0],screen=await checkModelLibrarySTL(bytes,{toMillimetresZUp:matrix,checkedOn:'2026-11-13'});
 const report:ModelLibraryCollisionReport={format:'brickwright-library-collision-report',version:1,selectedFile:{...asset.original},quality:screen as ModelLibraryCollisionReport['quality'],evidence:{fileSha256:asset.original.sha256,checkedOn:'2026-11-13',toMillimetresZUp:matrix,engine:'Jolt',engineVersion:'1.1.0-bw.9',qualifierVersion:'brickwright-library-collision/1',qualified:true,scope:'rigid-collision-preview',geometrySha256:'b'.repeat(64),sourceVolumeMm3:160,hulls:2,certificate:{sourceSHA256:'b'.repeat(64),algorithm:'manifold-compound/v1',strategy:'bsp',maxHulls:64,missingVolumeMm3:0.01,extraVolumeMm3:0.03,relativeError:0.00025,boundsErrorMm:0.002,tolerance:{volumeFraction:0.001,boundsMm:0.01}},nativeCheck:{build:'debug',ground:false,steps:1,stepSeconds:0.005}}};
 asset.quality!.collisionReport=report;
 return value;
}
async function open(page:Page){await page.getByLabel('File menu',{exact:true}).click();await page.getByRole('button',{name:'Model library',exact:true}).click();return page.getByRole('dialog',{name:'Model library',exact:true});}
async function load(page:Page,value:unknown){await page.getByLabel('Catalogue file',{exact:true}).setInputFiles({name:'catalogue.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});}
async function saved(page:Page){return page.evaluate(()=>JSON.parse(localStorage.getItem('brickwright-cad:standalone:v1')!));}

test('browse without fetching, insert one verified model with provenance, undo and reuse cached bytes offline',async({page})=>{
 let requests=0;await page.route(endpoint,async route=>{requests++;await route.fulfill({body:bytes,contentType:'model/stl',headers:{'access-control-allow-origin':'*'}});});
 await page.goto('/');await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');
 await addShape(page,'Box');await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');
 const before=await saved(page),dialog=await open(page);
 await expect(dialog.getByRole('button',{name:/ · (BSD-3-Clause|CC0-1.0)$/})).toHaveCount(38);const reviewed=await reportedCatalogue();await load(page,reviewed);
 await page.getByLabel('Search models',{exact:true}).fill('missing');await expect(dialog).toContainText('No matching models.');await page.getByLabel('Search models',{exact:true}).fill('fixture');
 await dialog.getByRole('button',{name:'Browser fixture · BSD-3-Clause',exact:true}).click();
 await expect(dialog).toContainText('Selected STL conversion to millimetres, Z up');await expect(dialog).toContainText('Curated limits:');
 await expect(dialog.getByRole('link',{name:'Licence evidence'})).toHaveAttribute('href','https://library-test.example/evidence');
 const insert=dialog.getByRole('button',{name:'Insert selected STL',exact:true});await expect(insert).toBeEnabled();
 await page.getByLabel('Incorporation modification notes',{exact:true}).fill('Applied recorded millimetres/Z-up conversion; no repair.');expect(requests).toBe(0);
 await insert.click();await expect(dialog.getByRole('status')).toContainText('Inserted with provenance');expect(requests).toBe(1);
 const inserted=await saved(page);expect(inserted.roots).toHaveLength(2);expect(inserted.provenance.records[0].asset.id).toBe('test-tetrahedron');expect(inserted.provenance.records[0].asset.quality.collisionReport).toEqual(reviewed.assets[0].quality!.collisionReport);
 await dialog.getByRole('button',{name:'Close model library'}).click();await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await saved(page)).toEqual(before);
 await page.getByRole('button',{name:'Redo',exact:true}).click();expect(await saved(page)).toEqual(inserted);
 const reopened=await open(page);await load(page,reviewed);await reopened.getByRole('button',{name:'Browser fixture · BSD-3-Clause',exact:true}).click();await reopened.getByLabel('Incorporation modification notes',{exact:true}).fill('Reused verified cached model unchanged.');await reopened.getByText('Technical details',{exact:true}).click();await reopened.getByLabel('Use cached files only',{exact:true}).check();await reopened.getByRole('button',{name:'Insert selected STL',exact:true}).click();await expect(reopened.getByRole('status')).toContainText('Inserted with provenance');expect(requests).toBe(1);expect((await saved(page)).roots).toHaveLength(3);
 const reused=await saved(page);await page.reload();await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');expect(await saved(page)).toEqual(reused);
});

test('bad metadata, missing quality, offline misses and corrupt bytes preserve the existing model',async({page})=>{
 let requests=0;await page.route(endpoint,async route=>{requests++;await route.fulfill({body:Buffer.alloc(bytes.length),headers:{'access-control-allow-origin':'*'}});});
 await page.goto('/');await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');const before=await saved(page),dialog=await open(page);
 await load(page,{format:'brickwright-local-example-library',version:1,assets:[]});await expect(dialog.getByRole('status')).toContainText('Unsupported');
 const value=await catalogue();delete value.assets[0].quality;await load(page,value);await dialog.getByRole('button',{name:'Browser fixture · BSD-3-Clause',exact:true}).click();await dialog.getByLabel('Incorporation modification notes',{exact:true}).fill('Unchanged.');await expect(dialog.getByRole('button',{name:'Insert selected STL',exact:true})).toBeDisabled();
 await load(page,await catalogue());await dialog.getByRole('button',{name:'Browser fixture · BSD-3-Clause',exact:true}).click();await dialog.getByLabel('Incorporation modification notes',{exact:true}).fill('Unchanged.');await dialog.getByText('Technical details',{exact:true}).click();await dialog.getByLabel('Use cached files only',{exact:true}).check();await dialog.getByRole('button',{name:'Insert selected STL',exact:true}).click();await expect(dialog.getByRole('status')).toContainText('unavailable offline');expect(requests).toBe(0);
 await dialog.getByLabel('Use cached files only',{exact:true}).uncheck();await dialog.getByRole('button',{name:'Insert selected STL',exact:true}).click();await expect(dialog.getByRole('status')).toContainText('SHA-256 mismatch');expect(requests).toBe(1);expect(await saved(page)).toEqual(before);
});

test('closing an in-flight download cancels insertion',async({page})=>{
 let release!:()=>void,started!:()=>void;const requested=new Promise<void>(resolve=>{started=resolve;});const waiting=new Promise<void>(resolve=>{release=resolve;});
 await page.route(endpoint,async route=>{started();await waiting;await route.fulfill({body:bytes,headers:{'access-control-allow-origin':'*'}}).catch(()=>{});});
 await page.goto('/');await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');const before=await saved(page),dialog=await open(page);await load(page,await catalogue());await dialog.getByRole('button',{name:'Browser fixture · BSD-3-Clause',exact:true}).click();await dialog.getByLabel('Incorporation modification notes',{exact:true}).fill('Unchanged.');await dialog.getByRole('button',{name:'Insert selected STL',exact:true}).click();await requested;await dialog.getByRole('button',{name:'Close model library'}).click();release();await expect(dialog).toBeHidden();await open(page);await expect(dialog.getByRole('button',{name:'Browser fixture · BSD-3-Clause',exact:true})).toBeEnabled();expect(await saved(page)).toEqual(before);
});

test('bundled CAD and OpenSCAD sources insert offline, stay editable through undo/reload and export attribution',async({page,context})=>{
 await page.goto('/');await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');
 const before=await saved(page),dialog=await open(page);
 await expect(dialog.getByRole('button',{name:/ · (BSD-3-Clause|CC0-1.0)$/})).toHaveCount(38);
 let requests=0;page.on('request',()=>requests++);await context.setOffline(true);
 const selected=['10 mm geometric cube fixture · CC0-1.0','Named dependencies · BSD-3-Clause'];
 for(const name of selected){
  await dialog.getByRole('button',{name,exact:true}).click();
  if(name.includes('cube'))await expect(dialog).toContainText('OpenSCAD source is converted');
  const insert=dialog.getByRole('button',{name:'Insert editable source',exact:true});await expect(insert).toBeEnabled();await dialog.getByLabel('Incorporation modification notes',{exact:true}).fill('Default parameters, unchanged coordinates.');await insert.click();await expect(dialog.getByRole('status')).toContainText('Editable source inserted with provenance. Available offline.');
 }
 expect(requests).toBe(0);const inserted=await saved(page);expect(inserted.roots).toHaveLength(before.roots.length+2);expect(inserted.provenance.records).toHaveLength(2);
 for(const record of inserted.provenance.records){expect(record.selectedFile.path).toMatch(/^sources\//);expect(record.selectedFile.url).toBeUndefined();}
 expect(inserted.provenance.records[0].modificationNotes).toContain('OpenSCAD translated');
 const code=inserted.nodes[inserted.roots.at(-1)];expect(code.kind).toBe('code');expect(code.program.source).toContain('let');
 await dialog.getByRole('button',{name:'Close model library'}).click();
 await page.getByRole('button',{name:'Undo',exact:true}).click();await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await saved(page)).toEqual(before);
 await page.getByRole('button',{name:'Redo',exact:true}).click();await page.getByRole('button',{name:'Redo',exact:true}).click();expect(await saved(page)).toEqual(inserted);
 await context.setOffline(false);await page.reload();await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');expect(await saved(page)).toEqual(inserted);
 await page.getByLabel('File menu',{exact:true}).click();await page.getByRole('button',{name:'Export…',exact:true}).click();const exporting=page.getByRole('dialog',{name:'Export model',exact:true});await exporting.getByLabel('Changes since insertion',{exact:true}).fill('Unchanged since source insertion.');await exporting.getByLabel('Export format',{exact:true}).selectOption('stl');
 const pending=page.waitForEvent('download');await exporting.getByRole('button',{name:'Export',exact:true}).click();const download=await pending,entries=unzipSync(new Uint8Array(await readFile((await download.path())!)));const sidecar=JSON.parse(new TextDecoder().decode(entries[Object.keys(entries).find(name=>name.endsWith('.attribution.json'))!]));expect(sidecar.records).toEqual(inserted.provenance.records);
});

test('closing while bundled source hash verification awaits cancels without changing model or redo',async({page})=>{
 await page.goto('/');await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');await addShape(page,'Box');await page.getByRole('button',{name:'Undo',exact:true}).click();const before=await saved(page),dialog=await open(page);
 await dialog.getByRole('button',{name:'10 mm geometric cube fixture · CC0-1.0',exact:true}).click();await dialog.getByLabel('Incorporation modification notes',{exact:true}).fill('Unchanged.');
 await page.evaluate(()=>{const host=window as unknown as {pendingHashes:(()=>void)[]};host.pendingHashes=[];const digest=crypto.subtle.digest.bind(crypto.subtle);crypto.subtle.digest=async(algorithm,data)=>{await new Promise<void>(resolve=>host.pendingHashes.push(resolve));return digest(algorithm,data);};});
 await dialog.getByRole('button',{name:'Insert editable source',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as unknown as {pendingHashes:unknown[]}).pendingHashes.length)).toBe(1);
 await dialog.getByRole('button',{name:'Close model library'}).click();await page.evaluate(()=>(window as unknown as {pendingHashes:(()=>void)[]}).pendingHashes.splice(0).forEach(resolve=>resolve()));
 await open(page);await expect(dialog.getByLabel('Incorporation modification notes',{exact:true})).toBeEnabled();await dialog.getByLabel('Incorporation modification notes',{exact:true}).fill('Retry after canceled verification.');await expect(dialog.getByRole('button',{name:'Insert editable source',exact:true})).toBeEnabled();expect(await saved(page)).toEqual(before);await dialog.getByRole('button',{name:'Close model library'}).click();await expect(page.getByRole('button',{name:'Redo',exact:true})).toBeEnabled();
});

test('reviewed gear inserts offline as a default snapshot and exports its MIT notice',async({page,context})=>{
 await page.goto('/');await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');const before=await saved(page),dialog=await open(page);
 await dialog.getByRole('button',{name:'Parametric Involute Gear · MIT',exact:true}).click();
 await expect(dialog).toContainText('Original JavaScript parameters and face colours are not retained');
 await expect(dialog.getByRole('link',{name:'Original source',exact:true})).toHaveAttribute('href',/720f3688312ed3bad1702fe83906be153b8ab8fc/);
 let requests=0;page.on('request',()=>requests++);await context.setOffline(true);
 await dialog.getByLabel('Incorporation modification notes',{exact:true}).fill('Default gear snapshot; original coordinates preserved.');
 await dialog.getByRole('button',{name:'Insert editable source',exact:true}).click();await expect(dialog.getByRole('status')).toContainText('Editable source inserted with provenance. Available offline.');expect(requests).toBe(0);
 const inserted=await saved(page),record=inserted.provenance.records[0],node=inserted.nodes[inserted.roots.at(-1)];
 expect(inserted.roots).toHaveLength(before.roots.length+1);expect(node.kind).toBe('code');expect(node.program.parameters).toEqual({});expect(node.program.source).toContain('Converted JSCAD snapshot');expect(record.selectedFile.path).toBe('sources/jscad/gear.js');expect(record.modificationNotes).toContain('"numTeeth":10');
 await dialog.getByRole('button',{name:'Close model library'}).click();await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await saved(page)).toEqual(before);await page.getByRole('button',{name:'Redo',exact:true}).click();expect(await saved(page)).toEqual(inserted);
 await context.setOffline(false);await page.reload();await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');expect(await saved(page)).toEqual(inserted);
 await page.getByLabel('File menu',{exact:true}).click();await page.getByRole('button',{name:'Export…',exact:true}).click();const exporting=page.getByRole('dialog',{name:'Export model',exact:true});await exporting.getByLabel('Changes since insertion',{exact:true}).fill('Unchanged since default snapshot insertion.');await exporting.getByLabel('Export format',{exact:true}).selectOption('stl');
 const pending=page.waitForEvent('download');await exporting.getByRole('button',{name:'Export',exact:true}).click();const download=await pending,entries=unzipSync(new Uint8Array(await readFile((await download.path())!)));const sidecar=JSON.parse(new TextDecoder().decode(entries[Object.keys(entries).find(name=>name.endsWith('.attribution.json'))!]));expect(sidecar.records).toEqual(inserted.provenance.records);expect(sidecar.records[0].asset.licence.attribution).toContain((await readFile('library/evidence/jscad-LICENSE.txt','utf8')).replace(/\r?\n/g,' '));
});


test('recorded collision reports expose bindings and limits without qualifying or fetching during browsing',async({page})=>{
 await page.goto('/');await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');
 const before=await saved(page),dialog=await open(page);let requests=0;page.on('request',()=>requests++);
 const value=await reportedCatalogue(),asset=value.assets[0];
 // Same bytes at a different identity do not inherit the first file's full report.
 asset.derivatives.push({...asset.original,url:'https://library-test.example/another.stl'});
 await load(page,value);await dialog.getByRole('button',{name:'Browser fixture · BSD-3-Clause',exact:true}).click();
 await dialog.getByText('Technical details',{exact:true}).click();
 const report=dialog.getByRole('region',{name:'Recorded collision evidence',exact:true});
 await expect(report).toContainText('not a reusable runtime collision proof');await expect(report).toContainText('Changed bytes, conversion, geometry or toolchain require requalification.');
 await report.getByText('Inspect complete recorded collision report',{exact:true}).click();
 for(const text of ['Report version 1; checked 2026-11-13; scope: rigid-collision-preview.','Jolt 1.1.0-bw.9','brickwright-library-collision/1','brickwright-stl-quality/1','debug build; 1 rigid step of 0.005 s; no ground.','Native capacity/error telemetry is unavailable.','hulls: 2 / 64','Missing volume: 0.01 mm³; extra volume: 0.03 mm³','relative error: 0.00025; allowed volume fraction: 0.001','Bounds error: 0.002 mm; allowed bounds error: 0.01 mm.','bounds min: 0, 0, 0 mm; max: 10, 10, 10 mm.'])await expect(report).toContainText(text);
 expect(JSON.parse(await report.locator('pre').innerText())).toEqual(asset.quality!.collisionReport);
 expect(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
 await dialog.getByLabel('Incorporation modification notes',{exact:true}).fill('Reviewing recorded curation evidence.');await expect(report.locator('pre')).toBeVisible();
 await dialog.getByLabel('Selected library STL',{exact:true}).selectOption('1');
 await expect(report).toContainText('different STL selection; it does not apply to this file.');await expect(report.locator('details')).toHaveCount(0);
 await dialog.getByLabel('Selected library STL',{exact:true}).selectOption('0');await expect(report.getByText('Inspect complete recorded collision report',{exact:true})).toBeVisible();
 for(const qualified of [true,false]){
  const legacy=await catalogue();legacy.assets[0].quality!.physics={engine:'Jolt',engineVersion:'historic-engine',qualifierVersion:'historic-qualifier',qualified};
  await load(page,legacy);await dialog.getByRole('button',{name:'Browser fixture · BSD-3-Clause',exact:true}).click();await dialog.getByText('Technical details',{exact:true}).click();
  await expect(report).toContainText('Only a legacy physics summary is recorded.');await expect(report).toContainText(`historic-engine; historic-qualifier; reported qualified: ${qualified}.`);await expect(report.locator('details')).toHaveCount(0);
 }
 await load(page,await catalogue());await dialog.getByRole('button',{name:'Browser fixture · BSD-3-Clause',exact:true}).click();await dialog.getByText('Technical details',{exact:true}).click();await expect(report).toContainText('No complete collision report is recorded for this selection.');
 expect(requests).toBe(0);expect(await saved(page)).toEqual(before);
});

// Gallery acceptance: actual bundled images, a usable primary action and compact details.
test('every bundled model has a preview and inserts without mandatory notes',async({page})=>{
 await page.goto('/');await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');const before=await saved(page),dialog=await open(page);
 const cards=dialog.locator('.model-library-card');await expect(cards).toHaveCount(194);await expect(cards.locator('img')).toHaveCount(194);expect((await cards.first().boundingBox())!.height).toBeGreaterThanOrEqual(170);expect(await cards.first().evaluate(card=>{const outer=card.getBoundingClientRect(),label=card.querySelector('strong')!.getBoundingClientRect();return label.top>=outer.top&&label.bottom<=outer.bottom;})).toBe(true);
 await expect.poll(()=>cards.locator('img').evaluateAll((images:any[])=>images.every(image=>image.complete&&image.naturalWidth>0))).toBe(true);
 expect(await saved(page)).toEqual(before);await expect(dialog.getByRole('button',{name:'Close model library'})).toHaveText('×');
 await cards.filter({hasText:'Named dependencies'}).click();const insert=dialog.getByRole('button',{name:'Insert editable source',exact:true});await expect(insert).toBeEnabled();
 await expect(dialog.locator('.model-library-technical')).not.toHaveAttribute('open');await expect(dialog.getByRole('textbox',{name:'Licence & attribution',exact:true})).toHaveValue(/Copyright/);
 expect(await dialog.evaluate(node=>{const action=node.querySelector('.library-insert')!,licence=node.querySelector('.model-library-licence')!;return !!(action.compareDocumentPosition(licence)&Node.DOCUMENT_POSITION_FOLLOWING);})).toBe(true);
 await insert.click();await expect(dialog.getByRole('status')).toContainText('Editable source inserted');const added=await saved(page);expect(added.roots).toHaveLength(before.roots.length+1);expect(added.provenance.records[0].modificationNotes).toContain('no manual changes');
 await dialog.getByLabel('Model type',{exact:true}).selectOption('mesh');await expect(cards).toHaveCount(41);await dialog.getByLabel('Model type',{exact:true}).selectOption('source');await expect(cards).toHaveCount(153);
 expect(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
});

for(let group=0;group<29;group++)test(`reviewed dependency-complete external sources insert offline: group ${group+1}`,async({page,context})=>{
 const assets=[...JSON.parse(readFileSync('library/editor-corpus-manifest.json','utf8')).assets,...JSON.parse(readFileSync('library/a2d-editor-manifest.json','utf8')).assets,...JSON.parse(readFileSync('library/scon-editor-manifest.json','utf8')).assets,...JSON.parse(readFileSync('library/jscad-editor-manifest.json','utf8')).assets];
 expect(assets).toHaveLength(114);
 await page.goto('/');await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');
 const before=await saved(page);let requests=0;await context.setOffline(true);page.on('request',()=>requests++);
 // Four complete UI cycles per case keep the normal 45-second test budget.
 for(const asset of assets.slice(group*4,group*4+4)){
  const dialog=await open(page);
  await dialog.getByRole('button',{name:`${asset.title} · MIT`,exact:true}).click();
  expect(await dialog.getByRole('textbox',{name:'Licence & attribution',exact:true}).inputValue()).toContain(asset.author);
  await dialog.getByRole('button',{name:'Insert editable source',exact:true}).click();
  await expect(dialog.getByRole('status')).toContainText('Editable source inserted');
  const inserted=await saved(page),record=inserted.provenance.records[0];
  expect(inserted.roots).toHaveLength(before.roots.length+1);expect(record.asset.id).toBe(asset.id);
  expect(record.selectedFile.sha256).toBe(asset.original.sha256);expect(record.asset.sourceRevision.commit).toBe(asset.version);
  if(asset.sourceBundle){expect(record.asset.sourceBundle.dependencies).toHaveLength(asset.sourceBundle.dependencies.length);for(const [index,dependency] of asset.sourceBundle.dependencies.entries()){expect(record.asset.sourceBundle.dependencies[index].path).toBe(dependency.path);expect(record.asset.sourceBundle.dependencies[index].file.sha256).toBe(dependency.file.sha256);expect(record.asset.sourceBundle.dependencies[index].licence.spdx).toBe('MIT');}}
  await dialog.getByRole('button',{name:'Close model library'}).click();
  await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await saved(page)).toEqual(before);
 }
 expect(requests).toBe(0);
});

test('new CC0 frame source inserts offline and survives project serialization',async({page})=>{
 await page.goto('/');await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');const before=await saved(page),dialog=await open(page);await page.context().setOffline(true);
 await dialog.getByRole('button',{name:'Nested open frames · CC0-1.0',exact:true}).click();await dialog.getByRole('button',{name:'Insert editable source',exact:true}).click();await expect(dialog.getByRole('status')).toContainText('Editable source inserted');const after=await saved(page);expect(after.roots).toHaveLength(before.roots.length+1);const node=after.nodes[after.roots.at(-1)];expect(node.kind).toBe('code');expect(node.program.source).toContain('subtract2d');expect(after.provenance.records.at(-1).asset.licence.spdx).toBe('CC0-1.0');
 await dialog.getByRole('button',{name:'Close model library'}).click();await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');await page.context().setOffline(false);
});
