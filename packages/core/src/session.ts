// SPDX-License-Identifier: BSD-3-Clause
import { checkDocument, createDocument, freezeDocument, identityTransform, newId, parseDocument, pruneDocument, serializeDocument, validateDocument } from './document.js';
import type { CadDocument, Primitive, SolidNode, Transform } from './document.js';
export interface SessionState { document: CadDocument; selection: readonly string[]; revision: number; canUndo: boolean; canRedo: boolean; label: string }
const cloneNode = (node: SolidNode): SolidNode => ({ ...node,
  transform: { position: [...node.transform.position], rotation: [...node.transform.rotation], scale: [...node.transform.scale] },
  ...(node.kind === 'box' ? { size: [...node.size] } : {}),
  ...(node.kind === 'boolean' ? { inputs: [...node.inputs] } : {}),
}) as SolidNode;
const equivalent = (a: SolidNode, b: SolidNode) => {
  if (a.kind === 'mesh' && b.kind === 'mesh') {
    if (a.positions !== b.positions || a.indices !== b.indices) return false;
    return JSON.stringify({ ...a, positions: null, indices: null }) === JSON.stringify({ ...b, positions: null, indices: null });
  }
  return JSON.stringify(a) === JSON.stringify(b);
};
type Snapshot = { document: CadDocument; selection: string[]; label: string };
export function createCadSession(initial: CadDocument = createDocument()) {
  let document = freezeDocument(validateDocument(initial)); let selection: string[] = []; let revision = 0; let label = 'Opened';
  const undo: Snapshot[] = []; const redo: Snapshot[] = []; const listeners = new Set<(state: SessionState) => void>();
  const state = (): SessionState => ({ document, selection: Object.freeze([...selection]), revision, canUndo: !!undo.length, canRedo: !!redo.length, label });
  const emit = () => { for (const listener of [...listeners]) listener(state()); };
  const snapshot = (): Snapshot => ({ document, selection: [...selection], label });
  function commit(title: string, edit: (draft: CadDocument) => string[] | void) {
    const draft = { ...document, roots: [...document.roots], nodes: Object.fromEntries(Object.entries(document.nodes).map(([id, node]) => [id, cloneNode(node)])) };
    const nextSelection = edit(draft);
    checkDocument(draft);
    for (const [id, node] of Object.entries(draft.nodes)) {
      const previous = document.nodes[id];
      if (previous && equivalent(node, previous)) draft.nodes[id] = previous;
    }
    if (draft.title === document.title && JSON.stringify(draft.roots) === JSON.stringify(document.roots) && Object.keys(draft.nodes).length === Object.keys(document.nodes).length && Object.entries(draft.nodes).every(([id, node]) => document.nodes[id] === node)) return;
    const validated = freezeDocument(draft);
    undo.push(snapshot()); if (undo.length > 100) undo.shift(); redo.length = 0;
    document = validated; selection = nextSelection ?? selection.filter(id => !!document.nodes[id]); label = title; revision++; emit();
  }
  const session = {
    get state() { return state(); },
    subscribe(listener: (state: SessionState) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    select(ids: readonly string[]) { selection = [...new Set(ids)].filter(id => Object.hasOwn(document.nodes, id)); emit(); },
    rename(title: string) { commit('Rename design', d => { d.title = title; }); },
    add(shape: Primitive | Extract<SolidNode, { kind: 'mesh' }>, options: Partial<Pick<SolidNode, 'name' | 'color' | 'transform'>> = {}) {
      const id = newId();
      commit(`Add ${shape.kind}`, d => {
        d.nodes[id] = { ...structuredClone(shape), id, name: options.name ?? `${shape.kind[0].toUpperCase()}${shape.kind.slice(1)}`, color: options.color ?? '#eea52b', transform: structuredClone(options.transform ?? identityTransform()) } as SolidNode;
        d.roots.push(id); return [id];
      }); return id;
    },
    update(id: string, patch: Partial<SolidNode>) { commit('Edit object', d => {
      if (!d.nodes[id]) throw new Error('Object does not exist');
      // Kind and identity cannot be changed by inspector edits.
      if ((patch.id && patch.id !== id) || (patch.kind && patch.kind !== d.nodes[id].kind)) throw new Error('Cannot change object identity or kind');
      d.nodes[id] = { ...d.nodes[id], ...structuredClone(patch) } as SolidNode;
    }); },
    transform(updates: Array<{ id: string; transform: Transform }>) { commit('Transform selection', d => { for (const { id, transform } of updates) { if (!d.nodes[id]) throw new Error('Object does not exist'); d.nodes[id].transform = structuredClone(transform); } }); },
    combine(operation: 'union' | 'subtract' | 'intersect', ids: readonly string[] = selection) {
      const chosen = [...new Set(ids)]; const id = newId();
      commit(operation === 'subtract' ? 'Subtract (first selected is the base)' : operation, d => {
        if (chosen.length < 2 || !chosen.every(x => d.roots.includes(x))) throw new Error('Select at least two top-level bodies');
        d.nodes[id] = { id, kind: 'boolean', operation, inputs: chosen, name: operation[0].toUpperCase() + operation.slice(1), color: d.nodes[chosen[0]].color, transform: identityTransform() };
        const at = Math.min(...chosen.map(x => d.roots.indexOf(x)));
        d.roots = d.roots.filter(x => !chosen.includes(x)); d.roots.splice(at, 0, id); return [id];
      }); return id;
    },
    separate(id: string) { commit('Separate operands', d => {
      const node = d.nodes[id]; if (node?.kind !== 'boolean' || !d.roots.includes(id)) throw new Error('Select a top-level operation');
      if (JSON.stringify(node.transform) !== JSON.stringify(identityTransform())) throw new Error('Reset the operation transform before separating its operands');
      d.roots.splice(d.roots.indexOf(id), 1, ...node.inputs); delete d.nodes[id]; return [...node.inputs];
    }); },
    duplicate(ids: readonly string[] = selection) { commit('Duplicate', d => {
      const roots = ids.filter(id => d.roots.includes(id)); if (!roots.length) throw new Error('Select a top-level body');
      const copied: string[] = [];
      for (const root of roots) {
        const map = new Map<string, string>();
        const copy = (id: string): string => {
          if (map.has(id)) return map.get(id)!;
          const next = newId(); map.set(id, next); const n = cloneNode(d.nodes[id]); n.id = next;
          if (n.kind === 'boolean') n.inputs = n.inputs.map(copy);
          d.nodes[next] = n; return next;
        };
        const id = copy(root); const n = d.nodes[id]; n.name += ' copy'; n.transform.position[0] += 10; d.roots.push(id); copied.push(id);
      } return copied;
    }); },
    remove(ids: readonly string[] = selection) { commit('Delete', d => {
      if (!ids.some(id => d.roots.includes(id))) throw new Error('Select a top-level body');
      d.roots = d.roots.filter(id => !ids.includes(id)); pruneDocument(d); return [];
    }); },
    undo() { const prev = undo.pop(); if (!prev) return; redo.push(snapshot()); ({ document, selection, label } = prev); revision++; emit(); },
    redo() { const next = redo.pop(); if (!next) return; undo.push(snapshot()); ({ document, selection, label } = next); revision++; emit(); },
    load(next: CadDocument | string) {
      const validated = freezeDocument(typeof next === 'string' ? parseDocument(next) : validateDocument(next));
      document = validated; selection = []; undo.length = 0; redo.length = 0; label = 'Opened'; revision++; emit();
    },
    serialize() { return serializeDocument(document); },
    dispose() { listeners.clear(); undo.length = 0; redo.length = 0; },
  };
  return session;
}
export type CadSession = ReturnType<typeof createCadSession>;
