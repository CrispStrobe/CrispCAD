// SPDX-License-Identifier: BSD-3-Clause
// Lowering semantics: CAD Script features outside the scorecard, evaluated on SMLib and on the
// product's Manifold evaluator (packages/geometry). Agreement of volume and bounding box pins the
// conventions (Euler order, mirror planes, signed scale, revolve direction and sign, profile
// holes, hulls); analytic values are checked where a closed form exists.
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createCadSession } from '@brickwright/cad-core';
import { createGeometryKernel, type GeometryKernel } from '@brickwright/cad-geometry';
import { cadScript, evaluateCadScript, lowerCodeShape } from '../src/lower-cad-script.ts';
import { createSmlibKernel, type ExactKernel } from '@crispcad/exact-kernel';

let exact: ExactKernel, manifold: GeometryKernel;
beforeAll(async () => {
  exact = await createSmlibKernel();
  const wasm = createRequire(import.meta.url).resolve('manifold-3d/manifold.wasm');
  manifold = await createGeometryKernel({ wasmBinary: readFileSync(wasm) });
});

function viaManifold(source: string) {
  const session = createCadSession();
  session.addCode({ version: 1, language: 'brickwright-cad-script', source, parameters: {} });
  const result = manifold.evaluate(session.state.document);
  const min = [0, 1, 2].map(i => Math.min(...result.bodies.map(b => b.bounds.min[i]))), max = [0, 1, 2].map(i => Math.max(...result.bodies.map(b => b.bounds.max[i])));
  return { volume: result.volume, min, max };
}

const S = 256; // segments: Manifold faceting only; SMLib is exact either way
const CASES: { id: string; source: string; volume?: number; faceted?: number }[] = [
  { id: 'euler-rotation-order', source: 'return rotate([30, 45, 60], move([10, 5, 2], box(4, 6, 8)));', volume: 192 },
  { id: 'axis-rotate', source: 'return axisRotate([1, 1, 0], 40, move([5, 0, 0], box(2, 3, 4)));', volume: 24 },
  { id: 'mirror-oblique', source: 'return mirror([1, 1, 0], move([10, 2, 3], box(2, 3, 4)));', volume: 24 },
  { id: 'signed-scale', source: 'return scale([2, -1, 0.5], move([3, 4, 5], box(2, 3, 4)));', volume: 24 },
  { id: 'affine-rigid', source: 'return affine([0, -1, 0, 5, 1, 0, 0, 6, 0, 0, 1, 7], move([3, 1, 0], box(2, 4, 6)));', volume: 48 },
  { id: 'affine-orthogonal-scale', source: 'return affine([0, -2, 0, 5, 3, 0, 0, 6, 0, 0, -1, 7], move([3, 1, 0], box(2, 4, 6)));', volume: 288 },
  { id: 'revolve-partial', source: `return revolve(polygon2d([[5, 0], [10, 0], [10, 10]]), 90, ${S});`, volume: 0.25 * 2 * Math.PI * (25 / 3) * 25 },
  { id: 'revolve-negative-sweep', source: `return revolve(polygon2d([[5, 0], [10, 0], [10, 10]]), -120, ${S});` },
  { id: 'revolve-negative-profile', source: `return revolve(polygon2d([[-5, 0], [-10, 0], [-10, 10]]), 90, ${S});` },
  { id: 'profile-with-hole', source: `return extrudeProfile(5, subtract2d(rectangle2d(20, 10, false), move2d(5, 5, circle2d(2, ${S}))));`, volume: 5 * (200 - 4 * Math.PI) },
  { id: 'polygon-points', source: 'return extrude(4, [[0, 0], [20, 0], [20, 10], [0, 10]]);', volume: 800 },
  { id: 'polygon-even-odd', source: 'return extrudeProfile(4, polygon2d([[0, 0], [20, 0], [20, 20], [0, 20], [5, 5], [15, 5], [15, 15], [5, 15]], [[0, 1, 2, 3], [4, 5, 6, 7]]));', volume: 4 * 300 },
  { id: 'hull-of-boxes', source: 'return hull(box(10, 10, 10), move([0, 0, 10], box(2, 2, 2)));' },
  { id: 'cone-to-point', source: `return frustum(10, 0, 20, ${S});`, volume: Math.PI * 100 * 20 / 3 },
  { id: 'partial-torus', source: `return torus(20, 5, ${S}, ${S}, 0, 90, 45);`, volume: 2 * Math.PI ** 2 * 20 * 25 / 4 },
  { id: 'resize-sphere', source: `return resize([20, 0, 0], sphere(5, ${S}));`, volume: 4 / 3 * Math.PI * 10 * 5 * 5 },
  { id: 'offset-round', source: `return extrudeProfile(2, offset2d(1, true, ${S}, rectangle2d(10, 10, true)));`, volume: 2 * (100 + 40 + Math.PI) },
  { id: 'hull2d-lever', source: `return extrudeProfile(3, hull2d(circle2d(3, ${S}), move2d(10, 0, circle2d(3, ${S}))));`, volume: 3 * (Math.PI * 9 + 60) },
  { id: 'repeat-rotated', source: `return repeat(3, [0, 0, 10], rotate([90, 0, 0], cylinder(2, 6, ${S})));`, volume: 3 * Math.PI * 4 * 6 },
  { id: 'intersect-curved', source: `return intersect(sphere(10, ${S}), box(12, 12, 12));` },
  { id: 'subtract-to-empty-branch', source: `return subtract(box(10, 10, 10), empty(), move([0, 0, 5], cylinder(2, 4, ${S})));`, volume: 1000 - Math.PI * 4 * 2 },
];

describe('CAD Script lowering agrees with Manifold and closed forms', () => {
  for (const c of CASES) it(c.id, () => {
    const solid = evaluateCadScript(exact, cadScript(c.source));
    try {
      expect(exact.isValid(solid)).toBe(true);
      const volume = exact.volume(solid), { min, max } = exact.bbox(solid), ref = viaManifold(c.source);
      if (c.volume !== undefined) expect(Math.abs(volume - c.volume) / c.volume).toBeLessThanOrEqual(1e-6);
      // Manifold is faceted (256 segments): agreement to 1e-3 relative / 0.05 mm.
      expect(Math.abs(volume - ref.volume) / ref.volume).toBeLessThanOrEqual(1e-3);
      for (let i = 0; i < 3; i++) { expect(Math.abs(min[i] - ref.min[i])).toBeLessThanOrEqual(0.05); expect(Math.abs(max[i] - ref.max[i])).toBeLessThanOrEqual(0.05); }
    } finally { solid.dispose(); }
  });

  it('builds a non-convex polyhedron (L prism) face by face', () => {
    const L: [number, number][] = [[0, 0], [20, 0], [20, 5], [5, 5], [5, 15], [0, 15]], h = 4;
    const points = [...L.map(([x, y]) => [x, y, 0] as const), ...L.map(([x, y]) => [x, y, h] as const)];
    const n = L.length, faces = [[...Array(n).keys()].reverse(), [...Array(n).keys()].map(i => i + n), ...[...Array(n).keys()].map(i => [i, (i + 1) % n, (i + 1) % n + n, i + n])];
    const solid = exact.scope(() => lowerCodeShape(exact, { kind: 'polyhedron', points: points as never, faces }))!;
    expect(exact.volume(solid)).toBeCloseTo((100 + 50) * h, 9);
    solid.dispose();
  });
});
