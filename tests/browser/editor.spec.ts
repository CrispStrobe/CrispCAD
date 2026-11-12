import { expect, test } from '@playwright/test';
const ready = async (page: import('@playwright/test').Page, selector = '#cad-root') => { await expect(page.locator(selector)).toHaveAttribute('data-state', 'ready'); };
test('edit dimensions, retain a boolean, export project and STL, reopen after reload', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/'); await ready(page);
  await page.getByRole('button', { name: 'Box', exact: true }).click(); await ready(page);
  await page.getByLabel('Width (mm)', { exact: true }).fill('40'); await page.getByLabel('Width (mm)', { exact: true }).press('Tab'); await ready(page);
  await page.getByRole('button', { name: 'Cylinder', exact: true }).click(); await ready(page);
  await page.getByLabel('Select Box', { exact: true }).check();
  // Selection order determines subtraction: first cylinder, then box. Union is symmetric.
  await page.getByRole('button', { name: 'Union', exact: true }).click(); await ready(page);
  await expect(page.locator('[data-testid="object-name"]')).toHaveCount(3);
  await page.getByRole('button', { name: 'Box', exact: true }).last().click();
  await expect(page.getByLabel('Width (mm)', { exact: true })).toHaveValue('40');
  const fileEvent = page.waitForEvent('download'); await page.getByRole('button', { name: 'Save project', exact: true }).click();
  const file = await fileEvent; expect(file.suggestedFilename()).toMatch(/\.bcad$/); const filePath = await file.path();
  const stlEvent = page.waitForEvent('download'); await page.getByRole('button', { name: 'STL', exact: true }).click(); expect((await stlEvent).suggestedFilename()).toMatch(/\.stl$/);
  await page.reload(); await ready(page); await expect(page.locator('[data-testid="object-name"]')).toHaveCount(3);
  await page.locator('input[type=file]').setInputFiles(filePath!); await ready(page); await expect(page.locator('[data-testid="object-name"]')).toHaveCount(3);
  expect(errors).toEqual([]); await page.screenshot({ path: 'test-results/standalone.png', fullPage: true });
});
test('undo restores a transformed object and invalid import preserves the live project', async ({ page }) => {
  await page.goto('/'); await ready(page); await page.getByRole('button', { name: 'Box', exact: true }).click(); await ready(page);
  await page.getByLabel('Position X', { exact: true }).fill('25'); await page.getByLabel('Position X', { exact: true }).press('Tab'); await ready(page);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await ready(page); await expect(page.getByLabel('Position X', { exact: true })).toHaveValue('0');
  await page.locator('input[type=file]').setInputFiles({ name: 'future.bcad', mimeType: 'application/json', buffer: Buffer.from('{"format":"brickwright-cad","version":99}') });
  await expect(page.locator('#cad-root').getByRole('status')).toContainText('unsupported'); await expect(page.locator('[data-testid="object-name"]')).toHaveCount(1);
});
test('host instances isolate history and preserve project data through embedding and remount', async ({ page }) => {
  await page.goto('/embedded.html'); await ready(page, '#left'); await ready(page, '#right');
  const a = page.locator('#left'), b = page.locator('#right');
  await a.getByRole('button', { name: 'Box', exact: true }).click(); await ready(page, '#left');
  await expect(a.locator('[data-testid="object-name"]')).toHaveCount(1); await expect(b.locator('[data-testid="object-name"]')).toHaveCount(0);
  await b.getByRole('button', { name: 'Undo', exact: true }).isDisabled();
  await page.locator('#copy-left').click(); await ready(page, '#right'); await expect(b.locator('[data-testid="object-name"]')).toHaveCount(1);
  await page.locator('#remount').click(); await ready(page, '#right'); await expect(b.locator('[data-testid="object-name"]')).toHaveCount(1);
  await page.locator('#bundle-test').click(); await expect(page.locator('#host-status')).toContainText('SB3 round-trip passed');
  await a.getByRole('button', { name: 'Undo', exact: true }).click(); await ready(page, '#left'); await expect(a.locator('[data-testid="object-name"]')).toHaveCount(0); await expect(b.locator('[data-testid="object-name"]')).toHaveCount(1);
  await page.screenshot({ path: 'test-results/embedded.png', fullPage: true });
});
test('corrupted autosave is recoverable and is never silently overwritten', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('brickwright-cad:standalone:v1', '{broken'));
  await page.goto('/'); await expect(page.getByText('Your saved project needs recovery')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('brickwright-cad:standalone:v1'))).toBe('{broken');
  await expect(page.getByRole('button', { name: 'Download saved data' })).toBeVisible();
});
test('narrow host panels remain usable and keyboard changes stay inside their editor', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 850 }); await page.goto('/embedded.html'); await ready(page, '#left'); await ready(page, '#right');
  const left = page.locator('#left'), right = page.locator('#right');
  await left.getByRole('button', { name: 'Box', exact: true }).click(); await ready(page, '#left');
  await left.getByRole('button', { name: 'Properties', exact: true }).click(); await expect(left.getByLabel('Width (mm)', { exact: true })).toBeVisible();
  await left.getByRole('button', { name: 'Close properties', exact: true }).click();
  const canvas = left.locator('canvas'); await canvas.focus(); await page.keyboard.press('ArrowRight'); await ready(page, '#left');
  await left.getByRole('button', { name: 'Properties', exact: true }).click(); await expect(left.getByLabel('Position X', { exact: true })).toHaveValue('1');
  await expect(right.locator('[data-testid="object-name"]')).toHaveCount(0);
});
test('touch taps select a solid after orbiting and selection stays usable in a narrow viewport', async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 600, height: 850 } }); const page = await context.newPage();
  try {
    await page.goto('http://127.0.0.1:4317'); await ready(page); await page.getByRole('button', { name: 'Box', exact: true }).tap(); await ready(page);
    await page.getByRole('button', { name: 'Fit', exact: true }).tap();
    const canvas = page.locator('canvas'); const bounds = (await canvas.boundingBox())!;
    await canvas.tap({ position: { x: bounds.width - 25, y: bounds.height - 65 } }); await expect(page.getByLabel('Select Box', { exact: true })).not.toBeChecked();
    await canvas.tap({ position: { x: bounds.width / 2, y: bounds.height / 2 } }); await expect(page.getByLabel('Select Box', { exact: true })).toBeChecked();
    await page.getByRole('button', { name: 'Properties', exact: true }).tap(); await expect(page.getByLabel('Width (mm)', { exact: true })).toHaveValue('30');
  } finally { await context.close(); }
});

test('view cube follows orbit, projection and workplane controls preserve the document', async ({ page }) => {
  await page.goto('/'); await ready(page);
  await page.getByRole('button', { name: 'Box', exact: true }).click(); await ready(page);
  const original = await page.evaluate(() => localStorage.getItem('brickwright-cad:standalone:v1'));
  const canvas = page.locator('[data-testid=cad-canvas]');
  const cube = page.getByRole('group', { name: 'View cube', exact: true });
  await cube.getByRole('button', { name: 'Top', exact: true }).click(); await expect(canvas).toHaveAttribute('data-view', 'top');
  await page.getByRole('button', { name: 'Orthographic view', exact: true }).click(); await expect(canvas).toHaveAttribute('data-projection', 'orthographic');
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click(); await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
  await page.getByLabel('View direction', { exact: true }).selectOption('right'); await expect(canvas).toHaveAttribute('data-view', 'right');
  await expect(cube.getByRole('button', { name: 'Right', exact: true })).toBeVisible();
  await page.getByLabel('View direction', { exact: true }).selectOption('front'); await expect(canvas).toHaveAttribute('data-view', 'front');
  await page.getByRole('button', { name: 'Show workplane', exact: true }).click(); await expect(page.getByRole('button', { name: 'Show workplane', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Show workplane', exact: true }).click();
  await page.getByRole('button', { name: 'Home', exact: true }).click(); await expect(canvas).toHaveAttribute('data-view', 'iso');
  await expect(cube.getByRole('button', { name: 'Front', exact: true })).toBeVisible(); await expect(cube.getByRole('button', { name: 'Right', exact: true })).toBeVisible();
  const points = await cube.locator('polygon').first().getAttribute('points');
  const bounds = (await canvas.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width * .5, bounds.y + bounds.height * .7); await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width * .65, bounds.y + bounds.height * .8, { steps: 8 }); await page.mouse.up();
  await expect(cube.locator('polygon').first()).not.toHaveAttribute('points', points!);
  expect(await page.evaluate(() => localStorage.getItem('brickwright-cad:standalone:v1'))).toBe(original);
  await page.screenshot({ path: `test-results/workbench-${test.info().project.name}.png`, fullPage: true });
});

test('drop to workplane accounts for rotation and is undoable', async ({ page }) => {
  await page.goto('/'); await ready(page); await page.getByRole('button', { name: 'Box', exact: true }).click(); await ready(page);
  for (const [label, value] of [['Rotation Y', '90'], ['Position Z', '50']]) { const field = page.getByLabel(label, { exact: true }); await field.fill(value); await field.press('Tab'); await ready(page); }
  await page.getByRole('button', { name: 'Drop to workplane', exact: true }).click(); await ready(page);
  expect(Number(await page.getByLabel('Position Z', { exact: true }).inputValue())).toBeCloseTo(15, 4);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await ready(page); await expect(page.getByLabel('Position Z', { exact: true })).toHaveValue('50');
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); await ready(page);
  expect(Number(await page.getByLabel('Position Z', { exact: true }).inputValue())).toBeCloseTo(15, 4);
});
