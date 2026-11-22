// SPDX-License-Identifier: BSD-3-Clause
import {expect,test} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {readPortableHistory} from '@brickwright/cad-history';

test('mirror an editable bracket, handle invalid input, and reopen the retained feature',async({page,hasTouch},info)=>{
 const press=(control:ReturnType<typeof page.getByRole>)=>hasTouch?control.tap():control.click();
 await page.goto('/');
 const root=page.locator('#cad-root');
 const ready=()=>expect(root).toHaveAttribute('data-state','ready');
 const mirror=page.getByRole('button',{name:'Mirror',exact:true});
 await ready();
 await expect(mirror).toBeDisabled();
 await press(page.getByRole('button',{name:'Sketch',exact:true}));
 const sketch=page.getByRole('dialog',{name:'Sketch and extrusion'});
 await sketch.getByLabel('Sketch name').fill('Bracket section');
 await sketch.getByLabel('Profile',{exact:true}).selectOption('outline');
 await sketch.getByLabel('Outline points X, Y (mm)').fill('5, 0\n15, 0\n15, 4\n9, 4\n9, 10\n5, 10');
 await press(sketch.getByRole('button',{name:'Create extrusion'}));
 await expect(sketch).toBeHidden();
 await ready();
 await press(mirror);
 const dialog=page.getByRole('dialog',{name:'Mirror body'});
 const offset=dialog.getByLabel('Plane offset (mm)');
 const apply=dialog.getByRole('button',{name:'Mirror body'});
 await offset.fill('10 deg');
 await press(apply);
 await expect(dialog.getByRole('status')).toContainText('Expression must produce mm');
 await expect(page.getByTestId('object-name')).toHaveText('Extrusion');
 await offset.fill('20');
 await press(apply);
 await expect(dialog).toBeHidden();
 await ready();
 const mirrored=page.getByTestId('object-name').filter({hasText:'Mirror of Extrusion'});
 await expect(mirrored).toBeVisible();

 const edit=page.getByRole('button',{name:'Edit mirror',exact:true});
 if(!await edit.isVisible())await press(page.getByRole('button',{name:'Properties',exact:true}));
 await press(edit);
 const editDialog=page.getByRole('dialog',{name:'Edit mirror'});
 await editDialog.getByLabel('Mirror plane').selectOption('XZ');
 await editDialog.getByLabel('Plane offset (mm)').fill('14');
 await press(editDialog.getByRole('button',{name:'Apply mirror changes'}));
 await expect(editDialog).toBeHidden();
 await ready();
 await press(page.getByRole('button',{name:'Undo',exact:true}));
 await ready();
 await press(edit);
 await expect(editDialog.getByLabel('Plane offset (mm)')).toHaveValue('20');
 await press(editDialog.getByRole('button',{name:'Close mirror'}));
 await press(page.getByRole('button',{name:'Redo',exact:true}));
 await ready();

 const [download]=await Promise.all([
  page.waitForEvent('download'),press(page.getByRole('button',{name:'Save project file',exact:true}))
 ]);
 const project=info.outputPath('mirror.bcad');
 await download.saveAs(project);
 const history=await readPortableHistory(await readFile(project));
 const saved=history.readDocument(history.project.headId),node=saved.nodes[saved.roots[0]];
 if(node.kind!=='mirror')throw Error('Expected a retained Mirror');
 expect(node).toMatchObject({plane:'XZ',offset:14});
 expect(saved.nodes[node.source].kind).toBe('extrusion');
 await press(page.getByRole('button',{name:'New project',exact:true}));
 await expect(page.getByTestId('object-name')).toHaveCount(0);
 const chooser=page.waitForEvent('filechooser');
 await press(page.getByRole('button',{name:'Open project',exact:true}));
 await (await chooser).setFiles(project);
 await ready();
 await press(mirrored);
 if(!await edit.isVisible())await press(page.getByRole('button',{name:'Properties',exact:true}));
 await press(edit);
 await expect(editDialog.getByLabel('Plane offset (mm)')).toHaveValue('14');
 await expect(editDialog.getByLabel('Mirror plane')).toHaveValue('XZ');
});
