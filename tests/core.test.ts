import { describe, expect, it } from 'vitest';
import { createCadSession, createDocument, identityTransform, parseDocument, serializeDocument, validateDocument } from '@brickwright/cad-core';
const box = () => ({ kind: 'box' as const, size: [10, 10, 10] as [number, number, number] });
describe('document and session contracts', () => {
  it('round-trips an editable boolean tree, operands and transforms', () => {
    const s = createCadSession(); const a = s.add(box()), b = s.add(box()); s.update(b, { transform: { ...identityTransform(), position: [5, 0, 0] } });
    s.combine('subtract', [a, b]); const restored = parseDocument(s.serialize());
    expect(restored).toEqual(s.state.document); expect(Object.keys(restored.nodes)).toHaveLength(3);
    const r = createCadSession(restored); r.update(a, { size: [20, 10, 10] }); expect(r.state.document.nodes[a].kind).toBe('box'); expect(r.state.canUndo).toBe(true);
  });
  it('keeps rejected loads and commands out of live state and history', () => {
    const s = createCadSession(); const id = s.add(box()); const before = s.serialize();
    expect(() => s.update(id, { size: [-1, 10, 10] })).toThrow(); expect(s.serialize()).toBe(before);
    expect(() => s.load({ ...s.state.document, version: 99 } as never)).toThrow(/unsupported/); expect(s.serialize()).toBe(before);
    s.undo(); expect(s.state.document.roots).toEqual([]);
  });
  it('refuses cycles, missing operands, prototype keys and non-finite dimensions', () => {
    const s = createCadSession(); const a = s.add(box()), b = s.add(box()); const op = s.combine('union', [a, b]);
    const cycle = structuredClone(s.state.document); (cycle.nodes[op] as any).inputs[0] = op; expect(() => validateDocument(cycle)).toThrow(/cyclic/);
    const missing = structuredClone(s.state.document); (missing.nodes[op] as any).inputs[0] = 'missing'; expect(() => validateDocument(missing)).toThrow(/inputs/);
    const bad = createDocument(); Object.defineProperty(bad.nodes, '__proto__', { enumerable: true, value: s.state.document.nodes[a] }); expect(() => validateDocument(bad)).toThrow();
    expect(() => s.update(a, { size: [NaN, 1, 1] })).toThrow();
  });
  it('isolates sessions, deep-copies input and freezes exposed state', () => {
    const a = createCadSession(); a.add(box()); const initial = structuredClone(a.state.document); const b = createCadSession(initial);
    initial.title = 'external mutation'; expect(b.state.document.title).not.toBe(initial.title);
    expect(() => { b.state.document.roots.push('invalid'); }).toThrow(); b.undo(); expect(a.state.document.roots).toHaveLength(1);
  });
  it('duplicates operation operands independently and prunes deleted trees', () => {
    const s = createCadSession(); const a = s.add(box()), b = s.add(box()); const op = s.combine('union', [a, b]);
    s.duplicate([op]); expect(s.state.document.roots).toHaveLength(2); expect(Object.keys(s.state.document.nodes)).toHaveLength(6);
    s.remove([op]); expect(Object.keys(s.state.document.nodes)).toHaveLength(3); s.undo(); expect(Object.keys(s.state.document.nodes)).toHaveLength(6);
  });
  it('one selection transform is one undo step', () => {
    const s = createCadSession(); const a = s.add(box()), b = s.add(box());
    s.transform([a, b].map(id => ({ id, transform: { ...identityTransform(), position: [20, 30, 40] } })));
    s.undo(); expect(s.state.document.nodes[a].transform.position).toEqual([0, 0, 0]); expect(s.state.document.nodes[b].transform.position).toEqual([0, 0, 0]);
  });
  it('selection does not change the document revision or history', () => {
    const s = createCadSession(); const a = s.add(box()); const rev = s.state.revision; s.select([a]); s.select([]); expect(s.state.revision).toBe(rev);
  });
  it('refuses orphans and oversized files', () => {
    const s = createCadSession(); s.add(box()); const d = structuredClone(s.state.document); d.roots = []; expect(() => validateDocument(d)).toThrow(/orphaned/);
    expect(() => parseDocument(' '.repeat(16 * 1024 * 1024 + 1))).toThrow(/16 MiB/);
  });
});
it('bounds graph depth independently of node insertion order', () => {
  const s = createCadSession(); const a = s.add(box()), b = s.add(box()); const d = structuredClone(s.state.document);
  let previous = b;
  for (let i = 0; i < 102; i++) { const id = `operation-${i}`; d.nodes[id] = { id, name: 'Union', kind: 'boolean', color: '#ffffff', transform: identityTransform(), operation: 'union', inputs: [previous, a] }; previous = id; }
  d.roots = [previous]; expect(() => validateDocument(d)).toThrow(/deep/);
});
it('shares immutable imported mesh data across transforms and undo snapshots', () => {
  const s = createCadSession(); const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1], indices = [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3];
  const id = s.add({ kind: 'mesh', id: 'input', name: 'Tetra', color: '#ffffff', transform: identityTransform(), positions, indices });
  expect(Object.isFrozen(positions)).toBe(false); const before = s.state.document.nodes[id];
  s.update(id, { transform: { ...identityTransform(), position: [10, 0, 0] } }); const after = s.state.document.nodes[id];
  if (before.kind !== 'mesh' || after.kind !== 'mesh') throw Error('expected mesh');
  expect(after.positions).toBe(before.positions); expect(after.indices).toBe(before.indices); s.undo(); expect(s.state.document.nodes[id]).toBe(before);
});
