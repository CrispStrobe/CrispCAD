// SPDX-License-Identifier: BSD-3-Clause
import {expect,test} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {readPortableHistory} from '@brickwright/cad-history';

test('pattern a sketch into a row and bolt circle, then Undo and reopen',async({page,hasTouch},info)=>{
 const press=(control:ReturnType<typeof page.getByRole>)=>hasTouch?control.tap():control.click();
 await page.goto('/');
 const ready=()=>expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');
 await ready();
 const pattern=page.getByRole('button',{name:'Pattern',exact:true});
 await expect(pattern).toBeDisabled();
 await press(page.getByRole('button',{name:'Sketch',exact:true}));
 const sketch=page.getByRole('dialog',{name:'Sketch and extrusion'});
 await sketch.getByLabel('Profile',{exact:true}).selectOption('circle');
 await sketch.getByLabel('Sketch radius (mm)').fill('2');
 await sketch.getByLabel('Circle center X, Y (mm)').fill('14, 2');
 await press(sketch.getByRole('button',{name:'Create extrusion'}));
 await expect(sketch).toBeHidden();
 await ready();

 await press(pattern);
 const create=page.getByRole('dialog',{name:'Pattern body'});
 await create.getByLabel('Total instances').fill('2.5');
 await press(create.getByRole('button',{name:'Create pattern'}));
 await expect(create.getByRole('status')).toContainText('whole number');
 await create.getByLabel('Total instances').fill('3');
 await create.getByLabel('Spacing (mm)').fill('12');
 await press(create.getByRole('button',{name:'Create pattern'}));
 await expect(create).toBeHidden();
 await ready();

 const edit=page.getByRole('button',{name:'Edit pattern',exact:true});
 if(!await edit.isVisible())await press(page.getByRole('button',{name:'Properties',exact:true}));
 await press(edit);
 const dialog=page.getByRole('dialog',{name:'Edit pattern'});
 const mode=dialog.getByLabel('Pattern type');
 const axis=dialog.getByRole('combobox',{name:'Pattern axis'});
 await mode.selectOption('circular');
 await expect(axis).toHaveValue('Z');
 await dialog.getByLabel('Center X (mm)').fill('4');
 await dialog.getByLabel('Center Y (mm)').fill('2');
 await dialog.getByLabel('Total instances').fill('4');
 await mode.selectOption('linear');
 await expect(dialog.getByLabel('Spacing (mm)')).toHaveValue('12');
 await mode.selectOption('circular');
 await expect(dialog.getByLabel('Center X (mm)')).toHaveValue('4');
 await press(dialog.getByRole('button',{name:'Apply pattern changes'}));
 await expect(dialog).toBeHidden();
 await ready();
 await press(page.getByRole('button',{name:'Undo',exact:true}));
 await ready();
 await press(edit);
 await expect(mode).toHaveValue('linear');
 await expect(dialog.getByLabel('Total instances')).toHaveValue('3');
 await press(dialog.getByRole('button',{name:'Close pattern'}));
 await press(page.getByRole('button',{name:'Redo',exact:true}));
 await ready();

 const [download]=await Promise.all([
  page.waitForEvent('download'),press(page.getByRole('button',{name:'Save project file',exact:true}))
 ]);
 const project=info.outputPath('bolt-circle.bcad');
 await download.saveAs(project);
 const history=await readPortableHistory(await readFile(project));
 const saved=history.readDocument(history.project.headId);
 const node=saved.nodes[saved.roots[0]];
 if(node.kind!=='pattern')throw Error('Expected a retained Pattern');
 expect(node.pattern).toEqual({mode:'circular',axis:'Z',count:4,center:[4,2],sweep:360});
 expect(saved.nodes[node.source].kind).toBe('extrusion');

 await press(page.getByRole('button',{name:'New project',exact:true}));
 await expect(page.getByTestId('object-name')).toHaveCount(0);
 const chooser=page.waitForEvent('filechooser');
 await press(page.getByRole('button',{name:'Open project',exact:true}));
 await (await chooser).setFiles(project);
 await ready();
 await press(page.getByTestId('object-name').filter({hasText:'Pattern of Extrusion'}));
 if(!await edit.isVisible())await press(page.getByRole('button',{name:'Properties',exact:true}));
 await press(edit);
 await expect(mode).toHaveValue('circular');
 await expect(dialog.getByLabel('Center X (mm)')).toHaveValue('4');
 await expect(dialog.getByLabel('Total instances')).toHaveValue('4');
});
