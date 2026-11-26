// SPDX-License-Identifier: BSD-3-Clause
// Heavy exact jobs in the editor (the exact-check debug page: a plate with many holes, in memory
// only): the default tablet limits refuse a 200-hole rim fillet and shell before the kernel runs,
// a running job can be cancelled from the status bar, and a worker whose job left memory above
// the recycle threshold is ended and started again lazily. The model is never changed by any of it.
import {expect,test} from '@playwright/test';
import type {Page} from '@playwright/test';

async function open(page:Page,query:string){
 const requests:string[]=[];page.on('request',request=>requests.push(new URL(request.url()).pathname));
 await page.goto(`/exact-check.html?${query}`);
 const root=page.locator('#exact-check-editor');
 // The Manifold preview of a 200-cylinder plate may exceed the editor's 30 s geometry budget on a
 // loaded machine ("error", previous geometry kept); the exact path does not depend on it.
 await expect(root).toHaveAttribute('data-state',/^(ready|error)$/,{timeout:300_000});
 const region=page.getByRole('region',{name:'CAD terminal',exact:true});
 await expect(region).toBeVisible();
 return {root,requests,region,input:region.getByRole('combobox',{name:'CAD command'}),entries:region.locator('.terminal-entry')};
}
async function submit(input:ReturnType<Page['locator']>,command:string){await input.fill(command);await input.press('Enter');}
async function lastEntryMatching(entries:ReturnType<Page['locator']>,pattern:RegExp,timeout=120_000){
 await expect.poll(async()=>pattern.test((await entries.last().textContent())??''),{timeout}).toBe(true);
 return (await entries.last().textContent())??'';
}
const objects=(page:Page)=>page.getByTestId('object-name').allTextContents();

test('the tablet limits refuse a 200-hole rim fillet and shell before the kernel runs, and leave the model alone',async({page})=>{
 test.setTimeout(900_000);
 const {requests,input,entries}=await open(page,'holes=200');
 // Nothing of the exact kernel loads with the page.
 expect(requests.filter(path=>path.includes('/assets/exact/'))).toEqual([]);
 const before=await objects(page);
 await submit(input,'fillet 0.5 Plate --face +z');
 const fillet=await lastEntryMatching(entries,/too much|too large|rror/);
 expect(fillet).toMatch(/Rounding 204 edges \(200 of them curved\) at once is too much for the exact kernel on this device/);
 await submit(input,'shell 0.5 Plate --open +z');
 expect(await lastEntryMatching(entries,/Shelling|rror/)).toMatch(/Shelling a body with 206 faces/);
 expect(await objects(page)).toEqual(before);
 await expect(page.getByRole('button',{name:'Undo',exact:true})).toBeDisabled();
});

test('a running exact job is cancelled from the status bar: the worker ends and the model is unchanged',async({page})=>{
 test.setTimeout(900_000);
 const {input,entries}=await open(page,'holes=200&exact-limits=none');
 const before=await objects(page),workers=()=>page.workers().length,idle=workers();
 await submit(input,'fillet 0.5 Plate --face +z');
 const chip=page.locator('.exact-activity');
 await expect(chip).toBeVisible({timeout:30_000});
 await expect(chip).toContainText(/Exact feature on the exact kernel… \d+ s/);
 await expect.poll(workers,{timeout:30_000}).toBeGreaterThan(idle);
 await chip.getByRole('button',{name:'Cancel exact kernel job'}).click();
 expect(await lastEntryMatching(entries,/cancelled|rror/i,30_000)).toMatch(/Request cancelled/);
 await expect(chip).toBeHidden();
 await expect.poll(workers,{timeout:10_000}).toBe(idle);
 expect(await objects(page)).toEqual(before);
 // The next exact request starts a fresh worker and kernel.
 await submit(input,'measure exact Plate');
 expect(await lastEntryMatching(entries,/volume|rror/)).toMatch(/volume \d/);
});

test('a worker whose job left memory above the recycle threshold is ended and recreated on the next job',async({page})=>{
 test.setTimeout(900_000);
 // recycle-mib=1: every job leaves more than 1 MiB, so the worker ends after each one.
 const {input,entries}=await open(page,'holes=4&recycle-mib=1');
 const idle=page.workers().length;
 for(let round=0;round<2;round++){
  await submit(input,'measure exact Plate');
  expect(await lastEntryMatching(entries,/volume|rror/)).toMatch(/volume \d.*\n?.*WASM memory \d+ MiB/s);
  await expect.poll(()=>page.workers().length,{timeout:10_000}).toBe(idle);
 }
});
