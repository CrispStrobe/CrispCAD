// SPDX-License-Identifier: BSD-3-Clause
import {expect,test} from '@playwright/test';

test('optional terminal uses session history, prompts, aliases, recall and GUI edits',async({page,hasTouch})=>{
  const press=(control:ReturnType<typeof page.getByRole>)=>hasTouch?control.tap():control.click();
  await page.goto('/');
  await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');
  const toggle=page.getByRole('button',{name:'CAD terminal',exact:true});
  const terminal=page.getByRole('region',{name:'CAD terminal'});
  const input=terminal.getByRole('textbox',{name:'Terminal command'});
  const log=terminal.getByRole('log');
  const prompt=terminal.getByRole('status',{name:'Terminal prompt'});
  const send=async(line:string)=>{await input.fill(line);await input.press('Enter');};
  await expect(terminal).toBeHidden();
  await press(toggle);await expect(input).toBeFocused();
  await input.fill('bo');await input.press('Tab');await expect(input).toHaveValue('box');
  await input.press('Enter');await expect(prompt).toContainText('Box width');
  await input.press('Escape');await expect(prompt).toContainText('Enter a command');
  await send('box 12,18,4');await expect(log).toContainText('apply-edit · Add box');
  await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');
  await send('m');await expect(prompt).toContainText('Target');
  await send('@10,0,2');await expect(log).toContainText('apply-edit · Transform selection');
  const edit=log.locator('.terminal-row').filter({hasText:'apply-edit · Transform selection'}).getByRole('button');
  await send('u');await expect(log.locator('.terminal-row').filter({hasText:/^undo/})).toHaveCount(1);
  await press(edit);await expect(input).toHaveValue(/^apply-edit \{/);
  await input.press('Enter');await expect(log.locator('.terminal-row').filter({hasText:'apply-edit · Transform selection'})).toHaveCount(2);
  await press(page.getByRole('button',{name:'Undo',exact:true}));await expect(log.locator('.terminal-row').filter({hasText:/^undo/})).toHaveCount(2);
  await press(terminal.getByRole('button',{name:'Close CAD terminal'}));await expect(terminal).toBeHidden();
  await press(toggle);await expect(log).toContainText('Transform selection');
  await input.press('ArrowUp');await expect(input).toHaveValue(/^apply-edit \{/);
});
