import {expect,test} from '@playwright/test';
test('desktop host exports project and iteration archives through the native save bridge',async({page})=>{
  await page.addInitScript(()=>{
    const host=window as unknown as {brickwrightDesktop:boolean;webkit:unknown;exports:{name:string;data:string}[]};
    host.brickwrightDesktop=true;host.exports=[];
    host.webkit={messageHandlers:{cadSave:{postMessage:async(file:{name:string;data:string})=>{host.exports.push(file);return {saved:true};}}}};
  });
  await page.goto('/');const editor=page.locator('#cad-root');await expect(editor).toHaveAttribute('data-state','ready');
  await page.getByRole('button',{name:'Box',exact:true}).click();await expect(editor).toHaveAttribute('data-state','ready');
  await page.getByRole('button',{name:'Save project',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {exports:unknown[]}).exports.length)).toBe(1);
  const project=await page.evaluate(()=>JSON.parse(atob((window as unknown as {exports:{data:string}[]}).exports[0].data)));
  expect(project.format).toBe('brickwright-cad');expect(project.roots).toHaveLength(1);
  await page.getByRole('button',{name:'Models and version history',exact:true}).click();
  await page.getByRole('button',{name:'Back up model + history',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {exports:unknown[]}).exports.length)).toBe(2);
  const archive=await page.evaluate(()=>JSON.parse(atob((window as unknown as {exports:{data:string}[]}).exports[1].data)));
  expect(archive.format).toBe('brickwright-cad-history');expect(archive.revisions.length).toBeGreaterThanOrEqual(2);
});
