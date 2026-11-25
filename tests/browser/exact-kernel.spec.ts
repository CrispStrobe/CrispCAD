// SPDX-License-Identifier: BSD-3-Clause
// The optional exact kernel in the browser: lazily loaded on first use (never with the app),
// served through the terminal and the export dialog, with diagnostics naming the feature, and
// the 27 reference parts measured and exported in the browser's worker.
// EXACT_BENCH=1 also writes the timings to experiments/exact-kernel/results/browser-<project>.json.
import {expect,test} from '@playwright/test';
import type {Page} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {createCadSession,serializeDocument} from '@brickwright/cad-core';
import {REFERENCE_PARTS} from '../../experiments/exact-kernel/tests/reference-parts.fixture.ts';

const STORAGE='brickwright-cad:standalone:v1';
async function openTerminal(page:Page){
 await page.getByRole('button',{name:'Terminal',exact:true}).click();
 const terminal=page.getByRole('region',{name:'CAD terminal',exact:true});await expect(terminal).toBeVisible();
 return {terminal,input:terminal.getByRole('combobox',{name:'CAD command'})};
}
/** Submit a terminal command and wait until the newest transcript entry matches `done`. */
async function run(page:Page,command:string,done:RegExp,timeout=120_000){
 const {terminal,input}=await openTerminalOnce(page);
 const entries=terminal.locator('.terminal-entry'),before=await entries.count(),started=Date.now();
 await input.fill(command);await input.press('Enter');
 await expect.poll(async()=>(await entries.count())>before&&done.test((await entries.last().textContent())??''),{timeout}).toBe(true);
 return {text:(await entries.last().textContent())??'',kind:(await entries.last().getAttribute('class'))??'',wallMs:Date.now()-started};
}
const opened=new WeakMap<Page,Awaited<ReturnType<typeof openTerminal>>>();
async function openTerminalOnce(page:Page){let value=opened.get(page);if(!value){value=await openTerminal(page);opened.set(page,value);}return value;}
const timing=(text:string)=>{const m=/load (\d+) ms · run (\d+) ms · WASM memory (\d+) MiB/.exec(text);return m?{loadMs:+m[1],runMs:+m[2],memoryMiB:+m[3]}:undefined;};

test('loads the exact kernel only on first use; measure exact and STEP export never fall back to a mesh',async({page})=>{
 test.setTimeout(240_000);
 const session=createCadSession();
 session.add({kind:'box',size:[10,20,30]},{name:'Block',transform:{position:[0,0,15],rotation:[0,0,0],scale:[1,1,1]}});
 session.add({kind:'cylinder',radius:5,height:10,segments:48},{name:'Pin',transform:{position:[40,0,5],rotation:[0,0,0],scale:[1,1,1]}});
 session.add({kind:'mesh',positions:[0,0,0,10,0,0,0,10,0,0,0,10],indices:[0,2,1,0,1,3,0,3,2,1,2,3]},{name:'Scan',transform:{position:[-40,0,0],rotation:[0,0,0],scale:[1,1,1]}});
 await page.addInitScript(([key,document])=>{if(!sessionStorage.getItem('seeded')){localStorage.setItem(key,document);sessionStorage.setItem('seeded','1');}},[STORAGE,serializeDocument(session.state.document)] as const);
 const requests:string[]=[];page.on('request',request=>requests.push(new URL(request.url()).pathname));
 await page.goto('/');await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');
 expect(requests.filter(path=>path.includes('/assets/exact/'))).toEqual([]);

 const cold=await run(page,'measure exact "Block" "Pin"',/WASM memory/);
 expect(cold.text).toMatch(/Block \([^)]+\): volume 6000 mm³ · area 2200 mm²/);
 expect(cold.text).toMatch(/Pin \([^)]+\): volume 785\.398163397 mm³/);
 expect(requests.some(path=>/\/assets\/exact\/smlibwasm-[^/]+\.wasm$/.test(path))).toBe(true);
 const warm=await run(page,'measure exact "Block"',/WASM memory/);
 expect(timing(warm.text)!.loadMs).toBe(0);

 const failure=await run(page,'measure exact all',/no exact B-rep/);
 expect(failure.kind).toContain('error');
 expect(failure.text).toContain('Scan (mesh): Imported meshes have no exact B-rep');

 // Export dialog: STEP of the selected bodies (none selected: every solid body, so select two).
 await run(page,'select "Block" "Pin"',/Select 2 objects/);
 await page.getByLabel('File menu',{exact:true}).click();await page.getByRole('button',{name:'Export…',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Export model',exact:true});
 await dialog.getByLabel('Export format',{exact:true}).selectOption('step');
 await expect(dialog).toContainText('exact B-rep kernel');
 const pending=page.waitForEvent('download',{timeout:120_000});await dialog.getByRole('button',{name:'Export',exact:true}).click();
 const download=await pending;await expect(dialog).toBeHidden();
 expect(download.suggestedFilename()).toMatch(/\.step$/);
 const step=await readFile((await download.path())!,'utf8');
 expect(step.startsWith('ISO-10303-21;')).toBe(true);
 expect(step).toContain('CYLINDRICAL_SURFACE');
 expect(step).not.toMatch(/TRIANGULATED|TESSELLATED/);
 await run(page,'select "Scan"',/Select 1 object/);
 await page.getByLabel('File menu',{exact:true}).click();await page.getByRole('button',{name:'Export…',exact:true}).click();
 await dialog.getByLabel('Export format',{exact:true}).selectOption('step');
 let downloads=0;page.on('download',()=>downloads++);
 await dialog.getByRole('button',{name:'Export',exact:true}).click();
 await expect(page.getByRole('status',{name:'Editor status'})).toContainText('Imported meshes have no exact B-rep',{timeout:60_000});
 expect(downloads).toBe(0);
});

test('measures and exports the 27 reference parts with the exact kernel in the browser',async({page},testInfo)=>{
 test.setTimeout(600_000);
 const session=createCadSession();
 REFERENCE_PARTS.forEach((part,i)=>session.addCode({version:1,language:'brickwright-cad-script',parameters:{},source:part.source},part.id,{position:[(i%9)*400,Math.floor(i/9)*400,0]}));
 const document=session.state.document;
 await page.addInitScript(([key,value])=>{if(!sessionStorage.getItem('seeded')){localStorage.setItem(key,value);sessionStorage.setItem('seeded','1');}},[STORAGE,serializeDocument(document)] as const);
 await page.goto('/');await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready',{timeout:300_000});
 const cold=await run(page,'measure exact all',/WASM memory/,300_000);
 const volumes=[...cold.text.matchAll(/volume ([0-9.e+-]+) mm³/g)].map(m=>Number(m[1]));
 expect(volumes).toHaveLength(27);
 REFERENCE_PARTS.forEach((part,i)=>expect(Math.abs(volumes[i]-part.volume)/part.volume,part.id).toBeLessThan(1e-6));
 const warm=await run(page,'measure exact all',/WASM memory/,300_000);
 const pending=page.waitForEvent('download',{timeout:300_000});
 const exported=await run(page,'export step all',/WASM memory/,300_000);
 const step=await readFile((await (await pending).path())!,'utf8');
 expect(step.match(/MANIFOLD_SOLID_BREP/g)?.length).toBeGreaterThanOrEqual(27);
 const result={
  project:testInfo.project.name,userAgent:await page.evaluate(()=>navigator.userAgent),date:new Date().toISOString(),
  parts:27,
  coldMeasure:{wallMs:cold.wallMs,...timing(cold.text)},
  warmMeasure:{wallMs:warm.wallMs,...timing(warm.text)},
  exportStep:{wallMs:exported.wallMs,...timing(exported.text),stepBytes:Buffer.byteLength(step)},
 };
 console.log(JSON.stringify(result));
 await testInfo.attach('exact-kernel-browser.json',{body:JSON.stringify(result,null,2),contentType:'application/json'});
 if(process.env.EXACT_BENCH)await writeFile(`experiments/exact-kernel/results/browser-${testInfo.project.name}.json`,JSON.stringify(result,null,2)+'\n');
});
