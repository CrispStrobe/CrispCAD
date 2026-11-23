// SPDX-License-Identifier: BSD-3-Clause
import {expect,test} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {readPortableHistory} from '@brickwright/cad-history';

const motor='library/sources/adafruit-motors/3777 TT Motor/3777 TT Motor.step';
test('imports a STEP motor as editable placement references with one Undo',async({page,hasTouch})=>{
 const press=(locator:ReturnType<typeof page.getByRole>)=>hasTouch?locator.tap():locator.click();
 const root=page.locator('#cad-root');
 const workers:string[]=[];
 page.on('worker',worker=>workers.push(worker.url()));
 await page.goto('/');
 await expect(root).toHaveAttribute('data-state','ready');
 const fileMenu=()=>press(page.getByLabel('File menu',{exact:true}));
 const chooser=async()=>{
  await fileMenu();
  const [picker]=await Promise.all([
   page.waitForEvent('filechooser'),press(page.getByRole('button',{name:'Import STL or STEP…',exact:true}))
  ]);
  return picker;
 };
 await (await chooser()).setFiles({name:'invalid.step',mimeType:'application/step',buffer:Buffer.from('invalid')});
 await expect(root.getByRole('status',{name:'Editor status'})).toContainText('Could not read STEP geometry');
 await expect(page.getByTestId('object-name')).toHaveCount(0);
 await (await chooser()).setFiles(motor);
 await expect(page.getByTestId('object-name')).toHaveCount(8);
 await expect(root).toHaveAttribute('data-state','ready');
 expect(workers.some(url=>url.includes('step-import.worker'))).toBe(true);
 await expect(page.getByTestId('object-name').filter({hasText:/body A/})).toHaveCount(1);
 await fileMenu();
 const [save]=await Promise.all([page.waitForEvent('download'),press(page.getByRole('button',{name:'Save project',exact:true}))]);
 const bytes=await readFile((await save.path())!);
 const history=await readPortableHistory(bytes);
 const doc=history.readDocument(history.project.headId);
 expect(doc.version).toBe(30);
 expect(doc.roots).toHaveLength(8);
 expect(doc.roots.map((id:string)=>doc.nodes[id]).every((node:{surface:boolean;reference:boolean})=>node.surface&&node.reference)).toBe(true);
 await press(page.getByRole('button',{name:'Undo',exact:true}));
 await expect(page.getByTestId('object-name')).toHaveCount(0);
 await page.getByLabel('Open CAD project or geometry',{exact:true}).setInputFiles((await save.path())!);
 await expect(page.getByTestId('object-name')).toHaveCount(8);
 await expect(root).toHaveAttribute('data-state','ready');
});
