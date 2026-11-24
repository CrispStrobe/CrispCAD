import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createCadSession } from '@brickwright/cad-core';
import { checkMeshTopology, checkPrintability, createGeometryKernel, type GeometryKernel } from '@brickwright/cad-geometry';

let kernel: GeometryKernel;
beforeAll(async () => { kernel = await createGeometryKernel({ wasmBinary: readFileSync('node_modules/manifold-3d/manifold.wasm') }); });
const bodies = (source: string) => { const s = createCadSession(); s.addCode({ version: 1, language: 'brickwright-cad-script', source, parameters: {} }); return kernel.evaluate(s.state.document).bodies; };

describe('printability screening', () => {
  it('passes a plain block printed flat', () => {
    const report = checkPrintability(bodies('return box(20, 20, 10);'));
    const [body] = report.bodies;
    expect(body.topology.watertight).toBe(true);
    expect(body.minWall.violations).toHaveLength(0);
    expect(body.minWall.thinnestMm).toBeCloseTo(10, 2);
    expect(body.current?.unsupportedAreaMm2).toBe(0);
    expect(body.current?.bedContactMm2).toBeCloseTo(400, 6);
    expect(report.issues).toEqual([]);
  });

  it('measures a wall thinner than the threshold', () => {
    const report = checkPrintability(bodies('return box(20, 20, 0.5);'), { minWallMm: 0.8 });
    expect(report.bodies[0].minWall.thinnestMm).toBeCloseTo(0.5, 3);
    expect(report.bodies[0].minWall.violations.length).toBeGreaterThan(0);
    expect(report.issues.join('\n')).toMatch(/thinner than 0\.8 mm/);
  });

  it('finds an unsupported cantilever and recommends turning the part', () => {
    const report = checkPrintability(bodies('return union(box(10, 10, 30), move([15, 0, 14], box(20, 10, 2)));'));
    const body = report.bodies[0];
    expect(body.current?.unsupportedAreaMm2).toBeCloseTo(200, 3);
    expect(body.orientations?.[0].unsupportedAreaMm2).toBe(0);
    expect(['+y', '-y']).toContain(body.orientations?.[0].label);
    expect(report.issues.join('\n')).toMatch(/reduces unsupported area/);
  });

  it('flags bed overflow and validates settings', () => {
    expect(checkPrintability(bodies('return box(300, 300, 300);')).issues.join('\n')).toMatch(/does not fit/);
    expect(() => checkPrintability([], { maxOverhangDeg: 90 })).toThrow(RangeError);
  });

  it('counts open and non-manifold edges', () => {
    expect(checkMeshTopology({ vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0], triangles: [0, 1, 2] })).toMatchObject({ watertight: false, openEdges: 3 });
    // Two triangles sharing an edge with the same direction are not an orientable surface.
    expect(checkMeshTopology({ vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -1, 0], triangles: [0, 1, 2, 0, 1, 3] }).nonManifoldEdges).toBe(1);
  });

  it('runs through the MCP host', async () => {
    const { createCodeHost } = await import('../apps/mcp/host.mjs');
    const host = await createCodeHost({});
    try {
      const { revision } = await host.call('cad_get_model');
      await host.call('cad_create_code_object', { source: 'return box(20, 20, 0.4);', expectedRevision: revision });
      const report = await host.call('cad_check_printability', { minWallMm: 1, bedXMm: 100 });
      expect(report.settings.bedSizeMm).toEqual({ x: 100, y: 220, z: 250 });
      expect(report.bodies).toHaveLength(1);
      expect(report.bodies[0].minWall.thinnestMm).toBeCloseTo(0.4, 3);
      await expect(host.call('cad_check_printability', { maxOverhangDeg: 95 })).rejects.toThrow(/Invalid maxOverhangDeg/);
    } finally { await host.dispose(); }
  }, 60000);
});
