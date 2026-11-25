// SPDX-License-Identifier: BSD-3-Clause
// STEP out of the exact kernel, back in through (a) the editor's own STEP importer
// (tools/step-wasm -> packages/editor/assets/step-tessellator.wasm, decodeStep) and (b) SMLib's
// exact STEP reader. (a) tessellates, so it is compared at a faceting tolerance; (b) must be exact.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decodeStep, type StepMesh } from '../../../packages/editor/src/decode-step.ts';
import { cadScript, evaluateCadScript } from '../src/lower-cad-script.ts';
import { createSmlibKernel, type ExactKernel } from '@crispcad/exact-kernel';
import { REFERENCE_PARTS } from './reference-parts.fixture.ts';

/** Parts the editor importer (oxideav-step 0.0.1) cannot mesh; recorded so a fix shows up. */
const IMPORTER_GAPS: Record<string, RegExp> = { 'torus-revolve': /could not be meshed/ };
/** The importer facets circles coarsely (about 32 segments: 6.4e-3 relative volume on a
 * cylinder), so curved parts are held to 1e-2 there; planar parts must match exactly. */
const MESH_TOLERANCE = 1e-2;
const STEP_WASM = fileURLToPath(new URL('../../../packages/editor/assets/step-tessellator.wasm', import.meta.url));
let k: ExactKernel, wasm: ArrayBuffer;
const worst = { meshVolume: 0, meshBbox: 0, exactVolume: 0, exactBbox: 0 };
beforeAll(async () => { k = await createSmlibKernel(); wasm = Uint8Array.from(readFileSync(STEP_WASM)).buffer; });
afterAll(() => console.log(`STEP round trip worst: editor importer volume ${worst.meshVolume.toExponential(2)} rel, bbox ${worst.meshBbox.toExponential(2)} mm; SMLib reader volume ${worst.exactVolume.toExponential(2)} rel, bbox ${worst.exactBbox.toExponential(2)} mm`));

/** Signed volume and bounds of closed triangle meshes. */
function meshMeasure(meshes: StepMesh[]) {
  let volume = 0;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const { positions: p, indices: t } of meshes) {
    for (let i = 0; i < p.length; i++) { min[i % 3] = Math.min(min[i % 3], p[i]); max[i % 3] = Math.max(max[i % 3], p[i]); }
    for (let i = 0; i < t.length; i += 3) {
      const [a, b, c] = [t[i] * 3, t[i + 1] * 3, t[i + 2] * 3];
      volume += (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) / 6;
    }
  }
  return { volume, min, max };
}

describe('STEP round trip of the 27 reference parts', () => {
  for (const part of REFERENCE_PARTS) it(part.id, async () => {
    const solid = evaluateCadScript(k, cadScript(part.source));
    try {
      const step = k.exportStep(solid), volume = k.volume(solid), box = k.bbox(solid);
      expect(step.startsWith('ISO-10303-21;')).toBe(true);
      // (a) the editor's importer: faceted, so the curved parts lose up to its chord error.
      const bytes = new TextEncoder().encode(step);
      if (IMPORTER_GAPS[part.id]) {
        await expect(decodeStep(wasm, bytes)).rejects.toThrow(IMPORTER_GAPS[part.id]);
      } else {
        const imported = meshMeasure(await decodeStep(wasm, bytes));
        const dv = Math.abs(imported.volume - volume) / volume;
        const db = Math.max(...[0, 1, 2].flatMap(i => [Math.abs(imported.min[i] - box.min[i]), Math.abs(imported.max[i] - box.max[i])]));
        worst.meshVolume = Math.max(worst.meshVolume, dv); worst.meshBbox = Math.max(worst.meshBbox, db);
        expect(dv).toBeLessThanOrEqual(part.faceted ? MESH_TOLERANCE : 1e-9);
        expect(db).toBeLessThanOrEqual(part.faceted ? 0.05 : 1e-9);
      }
      // (b) SMLib's own reader: exact.
      const back = k.importStep(step);
      try {
        const ev = Math.abs(k.volume(back) - volume) / volume, b2 = k.bbox(back);
        const eb = Math.max(...[0, 1, 2].flatMap(i => [Math.abs(b2.min[i] - box.min[i]), Math.abs(b2.max[i] - box.max[i])]));
        worst.exactVolume = Math.max(worst.exactVolume, ev); worst.exactBbox = Math.max(worst.exactBbox, eb);
        expect(ev).toBeLessThanOrEqual(1e-9);
        expect(eb).toBeLessThanOrEqual(1e-6);
      } finally { back.dispose(); }
    } finally { solid.dispose(); }
  });

  it('the editor importer rejects a truncated export', async () => {
    const solid = k.box([10, 10, 10]);
    const step = k.exportStep(solid); solid.dispose();
    await expect(decodeStep(wasm, new TextEncoder().encode(step.slice(0, step.length / 2)))).rejects.toThrow();
  });
});
