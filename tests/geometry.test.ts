import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createCadSession, identityTransform } from '@brickwright/cad-core';
import { createGeometryKernel, exportSTL, importSTL, export3MF } from '@brickwright/cad-geometry';
import type { GeometryKernel } from '@brickwright/cad-geometry';
import { strFromU8, unzipSync } from 'fflate';
let kernel: GeometryKernel;
beforeAll(async () => { kernel = await createGeometryKernel({ wasmBinary: readFileSync('node_modules/manifold-3d/manifold.wasm') }); });
const overlapping = () => {
  const s = createCadSession(); const a = s.add({ kind: 'box', size: [10, 10, 10] }); const b = s.add({ kind: 'box', size: [10, 10, 10] }, { transform: { ...identityTransform(), position: [5, 0, 0] } }); return { s, a, b };
};
describe('real Manifold kernel', () => {
  for (const [op, volume] of [['union', 1500], ['subtract', 500], ['intersect', 500]] as const) it(`${op} has the expected physical volume`, () => {
    const { s, a, b } = overlapping(); s.combine(op, [a, b]); const result = kernel.evaluate(s.state.document); expect(result.volume).toBeCloseTo(volume, 6); expect(result.bodies).toHaveLength(1);
  });
  it('changing a retained operand changes the evaluated boolean', () => {
    const { s, a, b } = overlapping(); s.combine('subtract', [a, b]); expect(kernel.evaluate(s.state.document).volume).toBeCloseTo(500);
    s.update(b, { transform: { ...identityTransform(), position: [20, 0, 0] } }); expect(kernel.evaluate(s.state.document).volume).toBeCloseTo(1000);
  });
  it('applies position, scale and rotation in the documented order', () => {
    const s = createCadSession(); s.add({ kind: 'box', size: [10, 20, 30] }, { transform: { position: [50, 0, 15], rotation: [0, 0, 90], scale: [2, 1, 1] } });
    const result = kernel.evaluate(s.state.document); expect(result.volume).toBeCloseTo(12000); expect(result.bodies[0].bounds.min[0]).toBeCloseTo(40); expect(result.bodies[0].bounds.max[2]).toBeCloseTo(30);
  });
  it('exports and reimports STL without losing scale or volume', () => {
    const { s } = overlapping(); const bodies = kernel.evaluate(s.state.document).bodies; const bytes = exportSTL(bodies); const mesh = importSTL(bytes);
    const roundtrip = createCadSession(); roundtrip.add({ ...mesh, kind: 'mesh', id: 'ignored', name: 'ignored', color: '#ffffff', transform: identityTransform() });
    expect(kernel.evaluate(roundtrip.state.document).volume).toBeCloseTo(2000);
    expect(new DataView(bytes.buffer).getUint32(80, true)).toBe(bodies.reduce((n, b) => n + b.indices.length / 3, 0));
  });
  it('rejects open STL meshes before reporting a solid', () => {
    const s = createCadSession(); s.add({ kind: 'mesh', id: 'ignored', name: 'open', color: '#ffffff', transform: identityTransform(), positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1], indices: [0, 1, 2, 0, 1, 3, 0, 2, 3, 0, 2, 3] });
    expect(() => kernel.evaluate(s.state.document)).toThrow();
  });
  it('writes a 3MF package with millimetre units and every body', () => {
    const { s } = overlapping(); const zip = unzipSync(export3MF(kernel.evaluate(s.state.document).bodies)); const xml = strFromU8(zip['3D/3dmodel.model']);
    expect(xml).toContain('unit="millimeter"'); expect(xml.match(/<object /g)).toHaveLength(2); expect(zip['_rels/.rels']).toBeDefined(); expect(zip['[Content_Types].xml']).toBeDefined();
  });
  it('handles empty intersections and repeated evaluations without stale geometry', () => {
    const { s, a, b } = overlapping(); s.update(b, { transform: { ...identityTransform(), position: [100, 0, 0] } }); s.combine('intersect', [a, b]);
    for (let i = 0; i < 30; i++) expect(kernel.evaluate(s.state.document).triangles).toBe(0);
  });
});
it('omits empty boolean results from printable 3MF objects', () => {
  const { s } = overlapping(); const bodies = kernel.evaluate(s.state.document).bodies;
  const empty = { ...bodies[0], id: 'empty', positions: new Float32Array(), indices: new Uint32Array(), volume: 0 };
  const xml = strFromU8(unzipSync(export3MF([...bodies, empty]))['3D/3dmodel.model']);
  expect(xml.match(/<object /g)).toHaveLength(2); expect(xml.match(/<item /g)).toHaveLength(2);
});
