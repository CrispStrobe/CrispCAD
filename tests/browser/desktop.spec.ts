import {addShape,clickTool} from './ui.js';
import {expect,test} from '@playwright/test';
test('desktop host exports project and iteration archives through the native save bridge',async({page})=>{
  await page.addInitScript(()=>{
    const host=window as unknown as {brickwrightDesktop:boolean;webkit:unknown;exports:{name:string;data:string}[]};
    host.brickwrightDesktop=true;host.exports=[];
    host.webkit={messageHandlers:{cadSave:{postMessage:async(file:{name:string;data:string})=>{host.exports.push(file);return {saved:true};}}}};
  });
  await page.goto('/');const editor=page.locator('#cad-root');await expect(editor).toHaveAttribute('data-state','ready');
  await addShape(page,'Box');await expect(editor).toHaveAttribute('data-state','ready');
  await clickTool(page,'Save project');
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {exports:unknown[]}).exports.length)).toBe(1);
  const project=await page.evaluate(()=>JSON.parse(atob((window as unknown as {exports:{data:string}[]}).exports[0].data)));
  expect(project.format).toBe('brickwright-cad-history');expect(project.revisions.at(-1).header.roots).toHaveLength(1);
  // Native Quit commits a still-focused inspector field before flushing history.
  const width=page.getByLabel('Width (mm)',{exact:true});if(!await width.isVisible())await page.getByRole('button',{name:'Properties',exact:true}).click();
  await width.fill('42');await page.evaluate(async()=>{await (window as unknown as {brickwrightPrepareToClose:()=>Promise<void>}).brickwrightPrepareToClose();});
  expect(await page.evaluate(()=>{const doc=JSON.parse(localStorage.getItem('brickwright-cad:standalone:v1')!);return doc.nodes[doc.roots[0]].size[0];})).toBe(42);
  await clickTool(page,'Save project');
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {exports:unknown[]}).exports.length)).toBe(2);
  const archive=await page.evaluate(()=>JSON.parse(atob((window as unknown as {exports:{data:string}[]}).exports[1].data)));
  expect(archive.format).toBe('brickwright-cad-history');expect(archive.revisions.length).toBeGreaterThanOrEqual(2);
});

test('native Model Source command opens the synchronized dock without editing the project',async({page})=>{
 await page.addInitScript(()=>{(window as any).brickwrightDesktop=true;(window as any).webkit={messageHandlers:{cadHost:{postMessage:async()=>null}}};});
 await page.goto('/');await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');await addShape(page,'Box');await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');
 const before=await page.evaluate(()=>localStorage.getItem('brickwright-cad:standalone:v1'));
 await page.evaluate(async()=>{await (window as any).brickwrightExecuteCommand('model-source');});await expect(page.getByLabel('File menu',{exact:true})).toBeHidden();await expect(page.getByLabel('Design source',{exact:true})).toBeVisible();await expect(page.getByLabel('Design source',{exact:true})).toHaveValue(/box\(/);
 expect(await page.evaluate(()=>localStorage.getItem('brickwright-cad:standalone:v1'))).toBe(before);
});

test('native Model Library command replaces the duplicate in-window File menu',async({page})=>{
 await page.addInitScript(()=>{(window as any).brickwrightDesktop=true;(window as any).webkit={messageHandlers:{cadHost:{postMessage:async()=>null}}};});
 await page.goto('/');await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');await expect(page.getByLabel('File menu',{exact:true})).toBeHidden();
 await page.evaluate(async()=>{await (window as any).brickwrightExecuteCommand('model-library');});const dialog=page.getByRole('dialog',{name:'Model library',exact:true});await expect(dialog).toBeVisible();await expect(dialog.locator('.model-library-card img')).toHaveCount(36);
});
