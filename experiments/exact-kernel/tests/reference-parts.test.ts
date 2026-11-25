// SPDX-License-Identifier: BSD-3-Clause
// Acceptance gate: the 27-part kernelCAD scorecard on the exact kernel at 1e-6 relative.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cadScript, evaluateCadScript } from '../src/lower-cad-script.ts';
import { createSmlibKernel, type ExactKernel } from '@crispcad/exact-kernel';
import { REFERENCE_PARTS } from './reference-parts.fixture.ts';

const TOLERANCE = 1e-6, BBOX_MM = 1e-6;
/** Parts whose analytic answer is several disjoint bodies. */
const COMPONENTS: Record<string, number> = { 'circular-pattern-pins': 6, 'linear-pattern-pins': 4, 'grid-pattern-pins': 6, 'mirrored-blocks': 2 };
let kernel: ExactKernel;
const worst = { volume: 0, area: 0, bbox: 0 };
beforeAll(async () => { kernel = await createSmlibKernel(); });
afterAll(() => { console.log(`reference parts: worst relative volume ${worst.volume.toExponential(2)}, area ${worst.area.toExponential(2)}, bbox ${worst.bbox.toExponential(2)} mm`); });

describe('kernelCAD reference parts on SMLib (exact)', () => {
  it('covers all 27 scorecard parts', () => expect(new Set(REFERENCE_PARTS.map(p => p.id)).size).toBe(27));
  for (const part of REFERENCE_PARTS) it(part.id, () => {
    const solid = evaluateCadScript(kernel, cadScript(part.source));
    try {
      expect(kernel.isValid(solid)).toBe(true);
      expect(kernel.solidCount(solid)).toBe(COMPONENTS[part.id] ?? 1);
      const volume = Math.abs(kernel.volume(solid) - part.volume) / part.volume;
      const area = Math.abs(kernel.area(solid) - part.area) / part.area;
      const { min, max } = kernel.bbox(solid);
      const bbox = Math.max(...[0, 1, 2].flatMap(i => [Math.abs(min[i] - part.min[i]), Math.abs(max[i] - part.max[i])]));
      worst.volume = Math.max(worst.volume, volume); worst.area = Math.max(worst.area, area); worst.bbox = Math.max(worst.bbox, bbox);
      expect(volume).toBeLessThanOrEqual(TOLERANCE);
      expect(area).toBeLessThanOrEqual(TOLERANCE);
      expect(bbox).toBeLessThanOrEqual(BBOX_MM);
    } finally { solid.dispose(); }
  });
});
