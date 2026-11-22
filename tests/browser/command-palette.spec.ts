// SPDX-License-Identifier: BSD-3-Clause
import {expect,test} from '@playwright/test';

test('search, navigate and execute CAD commands with selection-aware results',async({page,hasTouch})=>{
 const press=(control:ReturnType<typeof page.getByRole>)=>hasTouch?control.tap():control.click();
 await page.goto('/');
 await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');
 const button=page.getByRole('button',{name:'Command palette',exact:true});
 const dialog=page.getByRole('dialog',{name:'Command palette'});
 const search=dialog.getByRole('combobox',{name:'Search CAD commands'});
 await press(button);
 await expect(search).toBeFocused();
 await search.fill('bolt circle');
 await expect(dialog.getByRole('status')).toHaveText('No available commands match');
 await search.fill('shaft');
 await expect(dialog.getByRole('option')).toHaveText('Revolve');
 await page.keyboard.press('Enter');
 const revolution=page.getByRole('dialog',{name:'Sketch and revolution'});
 await expect(revolution).toBeVisible();
 await revolution.getByLabel('Sketch width (mm)').fill('8');
 await press(revolution.getByRole('button',{name:'Create revolution'}));
 await expect(revolution).toBeHidden();
 await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');

 await button.focus();
 await page.keyboard.press('Control+Shift+P');
 await expect(search).toBeFocused();
 await search.fill('bolt circle');
 const pattern=dialog.getByRole('option',{name:'Pattern body'});
 await expect(pattern).toBeVisible();
 await press(pattern);
 await expect(page.getByRole('dialog',{name:'Pattern body'})).toBeVisible();
 await press(page.getByRole('button',{name:'Close pattern'}));

 await press(button);
 await search.fill('view');
 const options=dialog.getByRole('option');
 await expect(options).toHaveCount(6);
 await page.keyboard.press('ArrowDown');
 await expect(options.nth(1)).toHaveAttribute('aria-selected','true');
 await page.keyboard.press('Enter');
 await expect(dialog).toBeHidden();

 await press(button);
 await page.keyboard.press('Escape');
 await expect(dialog).toBeHidden();
 await expect(button).toBeFocused();
 await page.keyboard.press('Control+k');
 await expect(page.getByLabel('Search shapes',{exact:true})).toBeFocused();
});

test('find localized CAD commands by German task names',async({page,hasTouch})=>{
 const press=(control:ReturnType<typeof page.getByRole>)=>hasTouch?control.tap():control.click();
 await page.addInitScript(()=>localStorage.setItem('brickwright-cad:locale','de'));
 await page.goto('/');
 await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');
 await press(page.getByRole('button',{name:'Befehlspalette',exact:true}));
 const dialog=page.getByRole('dialog',{name:'Befehlspalette'});
 await dialog.getByRole('combobox',{name:'CAD-Befehle suchen'}).fill('welle');
 await press(dialog.getByRole('option',{name:'Drehen',exact:true}));
 await expect(page.getByRole('dialog',{name:'Skizze und Drehkörper'})).toBeVisible();
});
