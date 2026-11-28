import {expect,test} from '@playwright/test';
import {addShape,clickTool} from './ui.js';
test('object rows are bodies, Delete works immediately after a row click, and duplicates are distinct',async({page})=>{
 // Three threaded screws are built in turn; on a loaded machine each takes several seconds.
 test.setTimeout(120_000);
 await page.goto('/');const root=page.locator('#cad-root');await expect(root).toHaveAttribute('data-state','ready');await addShape(page,'Screw');
 await expect(page.locator('[data-testid=object-name]')).toHaveCount(1);await expect(page.getByRole('button',{name:'Show construction',exact:true})).toHaveCount(0);
 await clickTool(page,'Duplicate');await expect(root).toHaveAttribute('data-state','ready');await expect(page.locator('[data-testid=object-name]')).toHaveCount(2);
 await clickTool(page,'Duplicate');await expect(root).toHaveAttribute('data-state','ready');
 const names=await page.locator('[data-testid=object-name]').allTextContents();expect(names).toEqual(['Screw','Screw copy','Screw copy 2']);
 await page.getByRole('button',{name:'Screw copy',exact:true}).click();await page.keyboard.press('Delete');
 await expect(page.locator('[data-testid=object-name]')).toHaveCount(2);await expect(page.getByRole('button',{name:'Screw copy',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.locator('[data-testid=object-name]')).toHaveCount(3);
});
test('native command bridge copies models, pastes, cuts, imports geometry and requests native file open',async({page})=>{
 await page.addInitScript(()=>{
  const w=window as any;w.brickwrightDesktop=true;w.testClipboard='';w.nativeExports=[];w.nativeOpen=null;w.nativeRequests=[];
  w.webkit={messageHandlers:{cadSave:{postMessage:async(file:any)=>{w.nativeExports.push(file);return {saved:true};}},cadHost:{postMessage:async(request:any)=>{
   if(Object.values(request).some(value=>value===undefined))throw Error('Undefined native message field');
   if(request.action==='state'){w.nativeState=JSON.parse(request.data);return true;}
   if(request.action==='clipboard-write'){w.testClipboard=request.data;return true;}
   if(request.action==='clipboard-read')return w.testClipboard;
   if(request.action==='open'){w.nativeRequests.push(request.mode);return w.nativeOpen;}
   throw Error('Unexpected native request');
  }}}};
 });
 await page.goto('/');const root=page.locator('#cad-root');await expect(root).toHaveAttribute('data-state','ready');await addShape(page,'Box');
 const command=(name:string)=>page.evaluate(async name=>{await (window as any).brickwrightExecuteCommand(name);},name);
 await command('copy');await command('paste');await expect(page.locator('[data-testid=object-name]')).toHaveCount(2);
 await command('cut');await expect(page.locator('[data-testid=object-name]')).toHaveCount(1);
 await command('export');const exportDialog=page.getByRole('dialog',{name:'Export model',exact:true});await exportDialog.getByRole('button',{name:'Export',exact:true}).click();await expect(exportDialog).toBeHidden();
 await expect.poll(()=>page.evaluate(()=>(window as any).nativeExports.length)).toBe(1);
 await command('undo');await expect(page.locator('[data-testid=object-name]')).toHaveCount(2);
 await page.evaluate(()=>{const w=window as any;w.nativeOpen={name:'part.stl',data:w.nativeExports[0].data};});await command('import');await expect(page.locator('[data-testid=object-name]')).toHaveCount(3);
 await page.evaluate(()=>{const w=window as any;w.nativeOpen={name:'saved.bcad',data:btoa(localStorage.getItem('brickwright-cad:standalone:v1')!)};});await command('open');await expect(root).toHaveAttribute('data-state','ready');
 expect(await page.evaluate(()=>(window as any).nativeRequests)).toEqual(['geometry','project']);
 await expect.poll(()=>page.evaluate(()=>(window as any).nativeState.ready)).toBe(true);
});
