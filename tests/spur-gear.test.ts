import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { compileCode, createCadSession, exportOpenSCAD, externalCenterDistanceMm, meshAlignDeg, spurGearPolygon, spurGearRadii, internalSpurGearPolygon } from '@brickwright/cad-core';
import { createGeometryKernel, type GeometryKernel } from '@brickwright/cad-geometry';

let kernel: GeometryKernel;
beforeAll(async () => { kernel = await createGeometryKernel({ wasmBinary: readFileSync('node_modules/manifold-3d/manifold.wasm') }); });
const program = (source: string) => ({ version: 1 as const, language: 'brickwright-cad-script' as const, source, parameters: {} });
const evaluate = (source: string) => { const s = createCadSession(); s.addCode(program(source)); return kernel.evaluate(s.state.document); };
const area = (p: [number, number][]) => p.reduce((sum, a, i) => { const b = p[(i + 1) % p.length]; return sum + a[0] * b[1] - b[0] * a[1]; }, 0) / 2;
function selfIntersects(p: [number, number][]): boolean {
  const cross = (a: number[], b: number[], c: number[]) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (let i = 0; i < p.length; i++) for (let j = i + 2; j < p.length; j++) {
    if (i === 0 && j === p.length - 1) continue;
    const [a, b, c, d] = [p[i], p[(i + 1) % p.length], p[j], p[(j + 1) % p.length]];
    if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) return true;
  }
  return false;
}

describe('ported involute spur gear', () => {
  for (const [module, teeth] of [[1, 20], [2, 8], [0.5, 60]] as const) it(`module ${module}, ${teeth} teeth gives a simple CCW profile between root and tip`, () => {
    const polygon = spurGearPolygon({ module, teeth, pressureAngleDeg: 20, backlash: 0 }), radii = spurGearRadii(module, teeth, 20);
    const r = polygon.map(([x, y]) => Math.hypot(x, y));
    expect(area(polygon)).toBeGreaterThan(Math.PI * radii.root ** 2);
    expect(area(polygon)).toBeLessThan(Math.PI * radii.tip ** 2);
    expect(Math.max(...r)).toBeCloseTo(radii.tip, 6);
    expect(Math.min(...r)).toBeCloseTo(radii.root, 6);
    expect(selfIntersects(polygon)).toBe(false);
  });

  it('extrudes through CAD Script and exports as an evaluated polygon', () => {
    const source = 'param gearModule: mm = 1;\nparam teeth: scalar = 20;\nreturn extrudeProfile(6, spurGear2d(gearModule, teeth));';
    const result = evaluate(source), polygon = spurGearPolygon({ module: 1, teeth: 20, pressureAngleDeg: 20, backlash: 0 });
    expect(result.bodies).toHaveLength(1);
    expect(result.volume).toBeCloseTo(area(polygon) * 6, 3);
    expect(result.bodies[0].bounds.max[0]).toBeCloseTo(11, 4);
    expect(exportOpenSCAD(program(source))).toContain('polygon(');
  });

  it('meshes without overlap at the pitch centre distance with backlash', () => {
    const [z1, z2] = [12, 20], distance = externalCenterDistanceMm(1, z1, 1, z2);
    // An empty intersection is refused as having no printable solid.
    expect(() => evaluate(`return intersect(extrudeProfile(5, spurGear2d(1, ${z1}, 20, 0.1)), move([${distance}, 0, 0], rotate([0, 0, ${meshAlignDeg(z2)}], extrudeProfile(5, spurGear2d(1, ${z2}, 20, 0.1)))));`)).toThrow(/no printable solid/);
    // Misaligned by half a tooth, the same pair collides.
    const clash = evaluate(`return intersect(extrudeProfile(5, spurGear2d(1, ${z1}, 20, 0.1)), move([${distance}, 0, 0], extrudeProfile(5, spurGear2d(1, ${z2}, 20, 0.1))));`);
    expect(clash.volume).toBeGreaterThan(0.5);
  });

  it('builds a ring gear from the internal tooth-space cutter', () => {
    const cutter = internalSpurGearPolygon({ module: 1, teeth: 40, pressureAngleDeg: 20, backlash: 0 });
    expect(selfIntersects(cutter)).toBe(false);
    const ring = evaluate('return extrudeProfile(4, subtract2d(circle2d(26, 256), internalSpurGear2d(1, 40)));');
    expect(ring.bodies).toHaveLength(1);
    expect(ring.volume).toBeGreaterThan(0);
    expect(ring.volume).toBeLessThan(Math.PI * (26 ** 2 - 19 ** 2) * 4);
  });

  it('refuses out-of-range and toothless parameters', () => {
    expect(() => compileCode(program('return extrudeProfile(2, spurGear2d(1, 5));'))).toThrow();
    expect(() => compileCode(program('return extrudeProfile(2, spurGear2d(1, 201));'))).toThrow();
    expect(() => compileCode(program('return extrudeProfile(2, spurGear2d(1, 20, 20, 9));'))).toThrow(/no valid tooth/);
  });
});
