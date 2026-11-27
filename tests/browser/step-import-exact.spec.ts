// SPDX-License-Identifier: BSD-3-Clause
// STEP import as exact bodies in the editor: File › Import STEP as exact bodies fetches the exact
// kernel only then, the body is displayed by Manifold from its stored mesh, exact work on it
// (measure, fillet) uses its B-rep, an unreadable file imports nothing, and after a reload the
// saved body opens and displays without the kernel being fetched again.
import {expect,test} from '@playwright/test';
import type {Page} from '@playwright/test';
import {createCadSession} from '@brickwright/cad-core';
import {createExactBackend} from '@brickwright/cad-exact';

async function terminal(page:Page){
 const region=page.getByRole('region',{name:'CAD terminal',exact:true});
 if(!await region.isVisible())await page.getByRole('button',{name:'Terminal',exact:true}).click();
 await expect(region).toBeVisible();
 return {region,input:region.getByRole('combobox',{name:'CAD command'})};
}
async function run(page:Page,command:string,done:RegExp){
 const {region,input}=await terminal(page),entries=region.locator('.terminal-entry'),before=await entries.count();
 await input.fill(command);await input.press('Enter');
 await expect.poll(async()=>(await entries.count())>before&&done.test((await entries.last().textContent())??''),{timeout:120_000}).toBe(true);
 return (await entries.last().textContent())??'';
}

test('import a STEP file as an exact body, work on it exactly, refuse a bad file, reopen without the kernel',async({page})=>{
 test.setTimeout(300_000);
 // The file: a 20×30×10 block written by the exact kernel (in Node, outside the page).
 const source=createCadSession();source.add({kind:'box',size:[20,30,10]},{name:'Block'});
 const step=(await createExactBackend()).exportStep(source.state.document).step;
 const requests:string[]=[];page.on('request',request=>requests.push(new URL(request.url()).pathname));
 await page.goto('/');
 const root=page.locator('#cad-root'),ready=()=>expect(root).toHaveAttribute('data-state','ready',{timeout:120_000});
 await ready();
 expect(requests.filter(path=>path.includes('/assets/exact/'))).toEqual([]);

 // File › Import STEP as exact bodies…
 await page.locator('summary[aria-label="File menu"]').click();
 const chooser=page.waitForEvent('filechooser');
 await page.getByRole('button',{name:'Import STEP as exact bodies…',exact:true}).click();
 await (await chooser).setFiles({name:'block.step',mimeType:'model/step',buffer:Buffer.from(step)});
 const body=page.getByTestId('object-name').filter({hasText:'part'});
 await expect(body).toHaveCount(1,{timeout:120_000});
 await ready();
 expect(requests.some(path=>/\/assets\/exact\/smlibwasm-[^/]+\.wasm$/.test(path))).toBe(true);
 await expect(page.getByText(/Exact body \(STEP B-rep\) from block\.step, body 1 of 1/)).toBeVisible();
 expect(await run(page,'measure exact all',/volume/)).toMatch(/volume 6000 mm³/);

 // An exact fillet of the imported body (closed form 5,804.696… for r = 2 on every edge).
 expect(await run(page,'fillet 2 part',/Exact fillet|triangles/)).toMatch(/exact volume 5804\.69\d+ mm³/);
 await ready();
 expect(await run(page,'measure exact all',/volume/)).toMatch(/volume 5804\.69\d+ mm³/);

 // A file that is not STEP imports nothing; the terminal names the reason.
 const objects=await page.getByTestId('object-name').count();
 const refused=page.waitForEvent('filechooser');
 const {region,input}=await terminal(page);
 await input.fill('import step');await input.press('Enter');
 await (await refused).setFiles({name:'broken.step',mimeType:'model/step',buffer:Buffer.from('solid cube\nendsolid cube\n')});
 await expect(region.locator('.terminal-entry').last()).toContainText('This is not a STEP file',{timeout:120_000});
 expect(await page.getByTestId('object-name').count()).toBe(objects);

 // Reopen: the saved project displays its imported body without fetching the kernel.
 requests.length=0;
 await page.reload();
 await ready();
 await expect(page.getByTestId('object-name').filter({hasText:'Fillet of part'})).toHaveCount(1);
 await expect(root).not.toHaveAttribute('data-state','error');
 expect(requests.filter(path=>path.includes('/assets/exact/'))).toEqual([]);
});
