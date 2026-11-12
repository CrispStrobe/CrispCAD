import { expect, it } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createCadSession, serializeDocument } from '@brickwright/cad-core';
import { attachCadProject, extractCadProject, CAD_PROJECT_PATH, ldrawToCadPoint, cadToLdrawPoint, ldrawToCadRotation, cadToLdrawRotation, toBrickwrightPart } from '@brickwright/cad-brickwright';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const archive = () => zipSync({ 'project.json': strToU8('{"targets":[]}'), 'brickwright/state.json': strToU8('{"format":"brickwright-state","version":2,"state":{"simLab":{"ldraw":"0 User LEGO model"},"futureSection":{"keep":true}}}'), 'a.png': new Uint8Array([0, 128, 255]) });
it('round-trips editable CAD while preserving every original project section and asset', () => {
  const s = createCadSession(); s.add({ kind: 'box', size: [10, 20, 30] }); const original = archive(); const saved = attachCadProject(original, s.state.document);
  expect(serializeDocument(extractCadProject(saved)!)).toBe(s.serialize()); const before = unzipSync(original), after = unzipSync(saved);
  for (const [path, data] of Object.entries(before)) expect(after[path]).toEqual(data);
  const without = unzipSync(attachCadProject(saved, null)); expect(without[CAD_PROJECT_PATH]).toBeUndefined(); expect(without['brickwright/state.json']).toEqual(before['brickwright/state.json']);
});
it('legacy projects have no CAD state and future data is refused', () => {
  expect(extractCadProject(archive())).toBeNull(); const files = unzipSync(archive()); files[CAD_PROJECT_PATH] = strToU8('{"format":"brickwright-cad","version":99,"units":"mm"}');
  expect(() => extractCadProject(zipSync(files))).toThrow(/unsupported/); expect(() => attachCadProject(zipSync({ nope: strToU8('x') }), createCadSession().state.document)).toThrow(/project.json/);
});
it('converts LDraw units and handedness reversibly', () => {
  expect(ldrawToCadPoint([20, -20, 40])).toEqual([8, 16, 8]); expect(cadToLdrawPoint(ldrawToCadPoint([123, -12.5, 9]))).toEqual([123, -12.5, 9]);
  const r = [0, -1, 0, 1, 0, 0, 0, 0, 1]; expect(cadToLdrawRotation(ldrawToCadRotation(r))).toEqual(r);
});
it('produces a mesh handoff with an explicit unqualified-physics boundary', () => {
  const part = toBrickwrightPart({ id: 'body', name: 'Bracket', color: '#ff0000', positions: new Float32Array([0, 0, 0, 8, 0, 0, 0, 8, 0]), indices: new Uint32Array([0, 1, 2]), volume: 0, bounds: { min: [0, 0, 0], max: [8, 8, 0] } });
  expect(part.requiresPhysicsMetadata).toBe(true); expect(part.placement.position).toEqual([10, -0, 10]); expect(part.ldraw).toContain('3 16');
});
it('retains exact provenance of the BSD modules extracted from Brickwright', () => {
  const provenance = JSON.parse(readFileSync('docs/brickwright-provenance.json', 'utf8'));
  expect(provenance.license).toBe('BSD-3-Clause');
  for (const f of provenance.files) expect(createHash('sha256').update(readFileSync(f.file)).digest('hex')).toBe(f.sha256);
});
