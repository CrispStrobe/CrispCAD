// SPDX-License-Identifier: BSD-3-Clause
import {expect,test} from '@playwright/test';
import {addShape} from './ui.js';
const ready=async(page:any)=>expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');
test('visible file actions save, create and reopen complete projects without a menu',async({page})=>{
 await page.goto('/');await ready(page);await addShape(page,'Box');await ready(page);
 const file=page.waitForEvent('download');await page.getByRole('button',{name:'Save project file',exact:true}).click();const download=await file;expect(download.suggestedFilename()).toMatch(/\.bcad$/);
 await page.getByRole('button',{name:'New project',exact:true}).click();await ready(page);await expect(page.locator('[data-testid=object-name]')).toHaveCount(0);
 const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Open project',exact:true}).click();await (await chooser).setFiles((await download.path())!);await ready(page);await expect(page.locator('[data-testid=object-name]')).toHaveCount(1);
});
test('phone-width file actions remain reachable while modeling tools scroll',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/');await ready(page);
 const controls=page.getByRole('group',{name:'Project actions',exact:true});await expect(page.getByRole('button',{name:'Shapes',exact:true})).toBeInViewport();
 for(const name of ['New project','Open project','Save project file']){const action=controls.getByRole('button',{name,exact:true});await expect(action).toBeInViewport();expect(await action.evaluate(button=>{const r=button.getBoundingClientRect(),root=button.getRootNode() as ShadowRoot;return root.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===button||button.contains(root.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})).toBe(true);}
 const before=await controls.boundingBox();await page.locator('.toolbar').evaluate(node=>node.scrollLeft=node.scrollWidth);expect((await controls.boundingBox())!.x).toBe(before!.x);await expect(page.getByRole('button',{name:'Save project file',exact:true})).toBeInViewport();
 await addShape(page,'Box');await ready(page);await expect(page.locator('[data-testid=object-name]')).toHaveCount(1);
});
test('native desktop keeps the same visible file buttons and routes Open through its host',async({page})=>{
 await page.addInitScript(()=>{const w=window as any;w.brickwrightDesktop=true;w.openRequests=[];w.webkit={messageHandlers:{cadHost:{postMessage:async(request:any)=>{if(request.action==='open'){w.openRequests.push(request.mode);return null;}return true;}}}};});
 await page.goto('/');await ready(page);await expect(page.getByLabel('File menu',{exact:true})).toBeHidden();for(const name of ['New project','Open project','Save project file'])await expect(page.getByRole('button',{name,exact:true})).toBeVisible();await page.getByRole('button',{name:'Open project',exact:true}).click();expect(await page.evaluate(()=>(window as any).openRequests)).toEqual(['project']);
});
