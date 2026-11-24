// SPDX-License-Identifier: BSD-3-Clause
// The ExactKernel interface directly: fillet/chamfer/shell against closed forms (CAD Script has
// no such features yet), explicit "unsupported" errors, and clean rejection of malformed input.
import { beforeAll, describe, expect, it } from 'vitest';
import { createSmlibKernel } from '../src/smlib-kernel.ts';
import { cadScript, evaluateCadScript, lowerCodeShape } from '../src/lower-cad-script.ts';
import { ExactKernelError, type ExactKernel, type ExactSolid } from '../src/exact-kernel.ts';

let k: ExactKernel;
beforeAll(async () => { k = await createSmlibKernel(); });
const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);
const measured = (s: ExactSolid) => { try { return { volume: k.volume(s), area: k.area(s), valid: k.isValid(s) }; } finally { s.dispose(); } };
const rejects = (fn: () => unknown, code: ExactKernelError['code'], pattern?: RegExp) => {
  let error: unknown;
  try { const r = fn() as { dispose?: () => void } | undefined; r?.dispose?.(); } catch (e) { error = e; }
  expect(error, 'expected an ExactKernelError').toBeInstanceOf(ExactKernelError);
  expect((error as ExactKernelError).code).toBe(code);
  if (pattern) expect((error as Error).message).toMatch(pattern);
};

describe('fillet, chamfer, shell (closed forms from the kernelCAD scorecard)', () => {
  it('fillets every edge of a 40x30x20 box at r = 3', () => {
    const m = measured(k.scope(() => k.fillet(k.box([40, 30, 20]), 3)));
    expect(m.valid).toBe(true);
    expect(rel(m.volume, 23340.84937505542)).toBeLessThanOrEqual(1e-8);
    expect(rel(m.area, 4726.265361880022)).toBeLessThanOrEqual(1e-8);
  });
  it('chamfers the top edges by 2', () => {
    const m = measured(k.scope(() => k.chamfer(k.box([40, 30, 20]), 2, { faceNormal: [0, 0, 1] })));
    expect(rel(m.volume, 23730.666666666664)).toBeLessThanOrEqual(1e-8);
    expect(rel(m.area, 5029.352380466496)).toBeLessThanOrEqual(1e-8);
  });
  it('shells a 50x40x30 box to 3 mm with the top open', () => {
    const m = measured(k.scope(() => k.shell(k.box([50, 40, 30]), 3, [0, 0, 1])));
    expect(rel(m.volume, 19608)).toBeLessThanOrEqual(1e-8);
    expect(rel(m.area, 13612)).toBeLessThanOrEqual(1e-8);
  });
  it('fillets a cylinder rim exactly (torus quarter)', () => {
    // r=10, h=20, top rim r=2: Pappus on the removed spandrel, area (1 - pi/4) r_f^2.
    const rf = 2, R = 10, cross = rf * rf * (1 - Math.PI / 4), xbar = R - rf * (10 - 3 * Math.PI) / (12 - 3 * Math.PI); // spandrel centroid
    const expected = Math.PI * R * R * 20 - 2 * Math.PI * xbar * cross;
    const m = measured(k.scope(() => k.fillet(k.cylinder(R, 20), rf, { faceNormal: [0, 0, 1] })));
    expect(rel(m.volume, expected)).toBeLessThanOrEqual(1e-8);
  });
  it('builds a filleted, shelled box (the qualification stress case)', () => {
    const m = measured(k.scope(() => k.shell(k.fillet(k.box([60, 40, 30]), 4), 2, [0, 0, 1])));
    expect(m.valid).toBe(true);
    expect(m.volume).toBeCloseTo(14950.678, 2); // fork's qualification: SMLib and WASMLib agree to 1e-11
  });
});

describe('unsupported CAD Script is an explicit error, never a Manifold fallback', () => {
  const cases: [string, string, RegExp][] = [
    ['minkowski', 'return minkowski(box(10, 10, 10), sphere(1, 48));', /minkowski/],
    ['text', 'return extrudeProfile(2, text2d("A", 10, "sans", "left", "baseline", 1, 4));', /text2d/],
    ['twist', 'return extrudeProfile(10, rectangle2d(4, 4, true), 45, 8, 1, 1);', /Twisted/],
    ['taper', 'return extrudeProfile(10, rectangle2d(4, 4, true), 0, 1, 0.5, 0.5);', /Tapered/],
    ['hexagon idiom', 'return cylinder(5, 10, 6);', /6 segments/],
    ['tessellated ellipsoid', 'return ellipsoid(10, 6, 4, 48);', /polyhedron of \d+ faces/],
    ['hull of cylinders', 'return hull(cylinder(2, 4, 48), move([10, 0, 0], cylinder(2, 4, 48)));', /hull of 'cylinder'/],
    ['hull of unequal spheres', 'return hull(sphere(2, 48), move([10, 0, 0], sphere(3, 48)));', /different radii/],
  ];
  for (const [id, source, pattern] of cases) it(id, () => rejects(() => evaluateCadScript(k, cadScript(source)), 'unsupported', pattern));
  it('sheared affine', () => rejects(() => k.scope(() => lowerCodeShape(k, { kind: 'affine', matrix: [1, 0.5, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0], shape: { kind: 'box', size: [1, 1, 1] } })), 'unsupported', /shear/));
});

describe('malformed input is rejected cleanly and the kernel stays usable', () => {
  it('rejects bad CAD Script', () => {
    rejects(() => evaluateCadScript(k, cadScript('return box(10, 10;')), 'invalid-input', /CAD Script/);
    rejects(() => evaluateCadScript(k, { version: 1, language: 'javascript', source: 'return box(1,1,1);', parameters: {} } as never), 'invalid-input');
    rejects(() => evaluateCadScript(k, cadScript('return box(1, 1, 1); '.repeat(3000))), 'invalid-input');
    rejects(() => evaluateCadScript(k, cadScript('return empty();')), 'invalid-input', /no solid/);
  });
  it('rejects invalid dimensions before calling the kernel', () => {
    rejects(() => k.box([10, -1, 10]), 'invalid-input');
    rejects(() => k.sphere(Number.NaN), 'invalid-input');
    rejects(() => k.cylinder(Infinity, 1), 'invalid-input');
    rejects(() => k.torus(5, 5), 'invalid-input');
    rejects(() => k.profile.polygon([[[0, 0], [1, 1]]]), 'invalid-input');
    rejects(() => k.polyhedron([[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]], [[0, 1, 2], [0, 1, 9], [0, 2, 3], [1, 2, 3]]), 'invalid-input');
    rejects(() => k.revolve(k.profile.circle(1), 400), 'invalid-input');
    rejects(() => evaluateCadScript(k, cadScript('return revolve(polygon2d([[-5, 0], [5, 0], [5, 5]]), 360, 64);')), 'invalid-input', /one side/);
  });
  it('turns kernel failures into errors', () => {
    rejects(() => k.scope(() => k.fillet(k.box([10, 10, 10]), 6)), 'kernel-failure');
    rejects(() => k.scope(() => k.shell(k.box([10, 10, 10]), 6, [0, 0, 1])), 'kernel-failure');
    rejects(() => k.importStep('ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\n#1=FOO(;\nENDSEC;\nEND-ISO-10303-21;'), 'kernel-failure');
    rejects(() => k.importStep('not a step file'), 'kernel-failure');
    rejects(() => k.importStep(''), 'invalid-input');
    rejects(() => k.volume({} as never), 'invalid-input');
  });
  it('still computes correctly after the failures, with no kernel crash', () => {
    const m = measured(k.scope(() => k.subtract(k.box([10, 10, 10]), k.cylinder(2, 12))));
    expect(rel(m.volume, 1000 - Math.PI * 4 * 10)).toBeLessThanOrEqual(1e-12);
  });
});
