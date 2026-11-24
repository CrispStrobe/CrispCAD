// SPDX-License-Identifier: BSD-3-Clause
// The OFL-1.1 part of the package (the Lato font) is not needed for modeling or STEP.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('models, shells and round-trips STEP with the bundled font stubbed out', () => {
  const script = fileURLToPath(new URL('../check-no-font.mjs', import.meta.url));
  const out = JSON.parse(execFileSync(process.execPath, [script], { encoding: 'utf8' }).trim().split('\n').at(-1)!);
  expect(out.defaultFontBytes).toBe(0);
  expect(out.volume).toBeGreaterThan(0);
  expect(Math.abs(out.roundTripVolume - out.volume) / out.volume).toBeLessThan(1e-9);
  expect(out.text).toMatch(/^FontError/);
});
