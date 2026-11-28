import {expect} from '@playwright/test';
import type {Page,Locator} from '@playwright/test';
export async function addShape(scope:Page|Locator,name:string,touch=false){
 const trigger=scope.getByRole('button',{name:'Shapes',exact:true});if(touch)await trigger.tap();else await trigger.click();
 const library=scope.getByRole('dialog',{name:'Shape library',exact:true});
 await library.getByLabel('Search shapes',{exact:true}).fill(name);
 const card=library.getByRole('button',{name:`Add ${name}`,exact:true});if(touch)await card.tap();else await card.click();
 // The library closes once the shape is built; a threaded screw takes a while on a loaded machine.
 await expect(library).toBeHidden({timeout:60_000});
}
export async function clickTool(scope:Page|Locator,name:string){
 if(['STL','3MF'].includes(name)){await scope.getByLabel('File menu',{exact:true}).click();await scope.getByRole('button',{name:'Export…',exact:true}).click();const dialog=scope.getByRole('dialog',{name:'Export model',exact:true});await dialog.getByLabel('Export format',{exact:true}).selectOption(name.toLowerCase());await dialog.getByRole('button',{name:'Export',exact:true}).click();return;}
 const menu=['New','Open','Save project','STL','3MF'].includes(name)?'File':['Union','Subtract','Intersect'].includes(name)?'Combine':['Delete','Duplicate'].includes(name)?'Edit':undefined;
 if(menu){const details=scope.getByLabel(`${menu} menu`,{exact:true});await details.click();}
 await (menu?scope.getByLabel(`${menu} menu`,{exact:true}).locator('..'):scope).getByRole('button',{name,exact:true}).click();
}
export async function restoreIteration(page:Page,serial:number){
 const select=page.getByLabel('Model iteration',{exact:true});const option=select.locator('option').filter({hasText:new RegExp(`^#${serial} ·`)});
 await expect(option).toHaveCount(1);await select.selectOption((await option.getAttribute('value'))!);
 await expect(select.locator('option:checked')).toContainText('Restored iteration');
 await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');
}
