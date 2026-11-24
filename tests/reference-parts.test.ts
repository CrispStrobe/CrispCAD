// SPDX-License-Identifier: BSD-3-Clause
// The 27 kernelCAD reference parts (kernelCAD-web 964fa6c,
// assets/reference-parts/scorecard.json, MIT), rebuilt in Brickwright CAD Script.
// Expected values are analytic closed forms (volume, surface area, bbox).
// kernelCAD boxes are corner-anchored and cylinders start at z=0; ours are
// centred, so each translation below is explicit. Curved parts are faceted by
// Manifold, so they use a faceting tolerance instead of upstream's exact 1e-6.
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createCadSession } from '@brickwright/cad-core';
import { createGeometryKernel, type BodyMesh, type GeometryKernel } from '@brickwright/cad-geometry';

let kernel: GeometryKernel;
beforeAll(async () => { kernel = await createGeometryKernel({ wasmBinary: readFileSync('node_modules/manifold-3d/manifold.wasm') }); });

interface ReferencePart { id: string; source: string; volume: number; area: number; min: number[]; max: number[]; faceted?: number }
const N = 1024; // segments for exact-curve parts
const pin = (x: number, y: number) => `move([${x}, ${y}, 4], cylinder(3, 8, ${N}))`;
const REFERENCE_PARTS: ReferencePart[] = [
  { id: 'rectangular-block', source: 'return move([20, 15, 10], box(40, 30, 20));', volume: 24000, area: 5200, min: [0, 0, 0], max: [40, 30, 20] },
  { id: 'centered-block', source: 'return box(24, 18, 6);', volume: 2592, area: 1368, min: [-12, -9, -3], max: [12, 9, 3] },
  { id: 'cylinder', source: `return move([0, 0, 25], cylinder(10, 50, ${N}));`, volume: 15707.963267948966, area: 3769.911184307752, min: [-10, -10, 0], max: [10, 10, 50], faceted: 1e-5 },
  { id: 'sphere', source: 'return sphere(12, 512);', volume: 7238.229473870883, area: 1809.55736846772, min: [-12, -12, -12], max: [12, 12, 12], faceted: 1.5e-4 },
  { id: 'torus-revolve', source: `return torus(20, 5, 192, 384);`, volume: 9869.604401089358, area: 3947.841760435743, min: [-25, -25, -5], max: [25, 25, 5], faceted: 3e-4 },
  { id: 'cone-frustum-revolve', source: `return revolve(polygon2d([[0, 0], [10, 0], [6, 20], [0, 20]]), 360, ${N});`, volume: 4105.014400690663, area: 1452.475304530714, min: [-10, -10, 0], max: [10, 10, 20], faceted: 1e-5 },
  { id: 'plate-through-hole', source: `return subtract(move([30, 20, 5], box(60, 40, 10)), move([30, 20, 5], cylinder(5, 12, ${N})));`, volume: 23214.601836602553, area: 6957.07963267949, min: [0, 0, 0], max: [60, 40, 10], faceted: 1e-5 },
  { id: 'plate-blind-hole', source: `return subtract(move([20, 15, 6], box(40, 30, 12)), move([20, 15, 10], cylinder(4, 4 + 2, ${N})));`, volume: 14148.672587712817, area: 4205.663706143591, min: [0, 0, 0], max: [40, 30, 12], faceted: 1e-5 },
  { id: 'plate-counterbore', source: `return subtract(move([20, 15, 5], box(40, 30, 10)), move([20, 15, 5], cylinder(3, 12, ${N})), move([20, 15, 9], cylinder(5, 4 + 2, ${N})));`, volume: 11516.194731347172, area: 3982.212373908208, min: [0, 0, 0], max: [40, 30, 10], faceted: 1e-5 },
  { id: 'plate-through-slot', source: 'return subtract(move([25, 15, 5], box(50, 30, 10)), move([25, 15, 5], box(20, 8, 12)));', volume: 13400, area: 4840, min: [0, 0, 0], max: [50, 30, 10] },
  { id: 'annular-cylinder', source: `return move([0, 0, 10], subtract(cylinder(15, 20, ${N}), cylinder(5, 22, ${N})));`, volume: 12566.370614359172, area: 3769.911184307752, min: [-15, -15, 0], max: [15, 15, 20], faceted: 1e-5 },
  { id: 'open-top-shell', source: 'return subtract(move([25, 20, 15], box(50, 40, 30)), move([25, 20, 17], box(44, 34, 28)));', volume: 19608, area: 13612, min: [0, 0, 0], max: [50, 40, 30] },
  { id: 'l-bracket-union', source: 'return union(move([20, 10, 4], box(40, 20, 8)), move([4, 10, 18], box(8, 20, 20)));', volume: 9600, area: 3680, min: [0, 0, 0], max: [40, 20, 28] },
  { id: 'boolean-intersection', source: 'return intersect(move([10, 10, 10], box(20, 20, 20)), move([10, 10, 10], box(10, 30, 20)));', volume: 4000, area: 1600, min: [5, 0, 0], max: [15, 20, 20] },
  // All-edge fillet r=3: the hull of eight corner spheres is the exact rounded box.
  { id: 'rounded-box', source: 'return hull(forValues(x, [3, 37], forValues(y, [3, 27], forValues(z, [3, 17], move([x, y, z], sphere(3, 128))))));', volume: 23340.84937505542, area: 4726.265361880022, min: [0, 0, 0], max: [40, 30, 20], faceted: 1e-4 },
  // Top-face chamfer 2 mm: hull of the full-size body and the inset top.
  { id: 'top-edge-chamfer', source: 'return hull(move([20, 15, 9], box(40, 30, 18)), move([20, 15, 19.5], box(36, 26, 1)));', volume: 23730.666666666664, area: 5029.352380466496, min: [0, 0, 0], max: [40, 30, 20] },
  { id: 'plate-four-holes', source: `return subtract(move([40, 25, 5], box(80, 50, 10)), forValues(u, [-25, 25], forValues(v, [-15, 15], move([40 + u, 25 + v, 5], cylinder(3, 12, ${N})))));`, volume: 38869.02664470767, area: 11127.787565803086, min: [0, 0, 0], max: [80, 50, 10], faceted: 1e-5 },
  { id: 'circular-pattern-pins', source: `return forRange(i, 0, 5, 1, rotate([0, 0, 60 * i], ${pin(20, 0)}));`, volume: 1357.1680263507906, area: 1244.0706908215582, min: [-23, -20.32050807568877, 0], max: [23, 20.32050807568877, 8], faceted: 1e-5 },
  { id: 'linear-pattern-pins', source: `return repeat(4, [10, 0, 0], ${pin(5, 0)});`, volume: 904.7786842338604, area: 829.3804605477054, min: [2, -3, 0], max: [38, 3, 8], faceted: 1e-5 },
  { id: 'grid-pattern-pins', source: `return repeat(2, [0, 10, 0], repeat(3, [10, 0, 0], ${pin(4, 5)}));`, volume: 1357.1680263507906, area: 1244.0706908215582, min: [1, 2, 0], max: [27, 18, 8], faceted: 1e-5 },
  { id: 'mirrored-blocks', source: 'return union(move([15, 5, 5], box(10, 10, 10)), mirror([1, 0, 0], move([15, 5, 5], box(10, 10, 10))));', volume: 2000, area: 1200, min: [-20, 0, 0], max: [20, 10, 10] },
  { id: 'sweep-square-prism', source: 'return extrudeProfile(30, rectangle2d(4, 4, true));', volume: 480, area: 512, min: [-2, -2, 0], max: [2, 2, 30] },
  { id: 'sweep-round-prism', source: `return extrudeProfile(20, circle2d(5, ${N}));`, volume: 1570.7963267948965, area: 785.3981633974483, min: [-5, -5, 0], max: [5, 5, 20], faceted: 1e-5 },
  { id: 'loft-circular-frustum', source: `return move([0, 0, 10], frustum(10, 5, 20, ${N}));`, volume: 3665.1914291880917, area: 1364.1829574548633, min: [-10, -10, 0], max: [10, 10, 20], faceted: 1e-5 },
  { id: 'loft-square-frustum', source: 'return loft([[[-10, -10, 0], [10, -10, 0], [10, 10, 0], [-10, 10, 0]], [[-6, -6, 10], [6, -6, 10], [6, 6, 10], [-6, 6, 10]]]);', volume: 2613.3333333333335, area: 1233.3010953132166, min: [-10, -10, 0], max: [10, 10, 10] },
  { id: 'stepped-shaft-revolve', source: `return revolve(polygon2d([[0, 0], [4, 0], [4, 10], [8, 10], [8, 20], [0, 20]]), 360, ${N});`, volume: 2513.2741228718346, area: 1156.1060965210438, min: [-8, -8, 0], max: [8, 8, 20], faceted: 1e-5 },
  { id: 'rotated-box', source: 'return rotate([0, 0, 30], move([20, 10, 2.5], box(40, 20, 5)));', volume: 4000, area: 2200, min: [-10, 0, 0], max: [34.64101615137755, 37.32050807568877, 5] },
];

function surfaceArea(bodies: readonly BodyMesh[]): number {
  let area = 0;
  for (const b of bodies) for (let t = 0; t < b.indices.length; t += 3) {
    const [a, c, d] = [0, 1, 2].map(k => Array.from(b.positions.subarray(b.indices[t + k] * 3, b.indices[t + k] * 3 + 3)));
    const u = c.map((x, i) => x - a[i]), v = d.map((x, i) => x - a[i]);
    area += Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
  }
  return area;
}

describe('kernelCAD reference parts in CAD Script', () => {
  it('covers all 27 scorecard parts', () => expect(new Set(REFERENCE_PARTS.map(p => p.id)).size).toBe(27));
  for (const part of REFERENCE_PARTS) it(part.id, () => {
    const session = createCadSession();
    session.addCode({ version: 1, language: 'brickwright-cad-script', source: part.source, parameters: {} });
    const result = kernel.evaluate(session.state.document), tolerance = part.faceted ?? 1e-6;
    expect(result.bodies).toHaveLength(1);
    expect(Math.abs(result.volume - part.volume) / part.volume).toBeLessThanOrEqual(tolerance);
    expect(Math.abs(surfaceArea(result.bodies) - part.area) / part.area).toBeLessThanOrEqual(tolerance);
    const { min, max } = result.bodies[0].bounds;
    for (let i = 0; i < 3; i++) { expect(Math.abs(min[i] - part.min[i])).toBeLessThanOrEqual(0.05); expect(Math.abs(max[i] - part.max[i])).toBeLessThanOrEqual(0.05); }
  });
});
