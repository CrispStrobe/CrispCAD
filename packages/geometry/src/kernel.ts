// SPDX-License-Identifier: BSD-3-Clause
import Module from 'manifold-3d';
import type { Manifold, ManifoldToplevel } from 'manifold-3d';
import { validateDocument } from '@brickwright/cad-core';
import type { CadDocument, SolidNode } from '@brickwright/cad-core';
export interface BodyMesh { id: string; name: string; color: string; positions: Float32Array; indices: Uint32Array; volume: number; bounds: { min: number[]; max: number[] } }
export interface GeometryResult { bodies: BodyMesh[]; volume: number; triangles: number }
export async function createGeometryKernel(options: { wasmURL?: string; wasmBinary?: Uint8Array } = {}) {
  // Upstream's declaration omits Emscripten's wasmBinary option and locateFile argument.
  const factory = Module as unknown as (options: { locateFile?: (name: string) => string; wasmBinary?: Uint8Array }) => Promise<ManifoldToplevel>;
  const module = await factory({ ...(options.wasmURL ? { locateFile: (name: string) => name.endsWith('.wasm') ? options.wasmURL! : name } : {}), ...(options.wasmBinary ? { wasmBinary: options.wasmBinary } : {}) });
  module.setup();
  return { evaluate: (doc: CadDocument) => evaluateDocument(module, doc) };
}
export type GeometryKernel = Awaited<ReturnType<typeof createGeometryKernel>>;
function evaluateDocument(module: ManifoldToplevel, input: CadDocument): GeometryResult {
  const doc = validateDocument(input); const cache = new Map<string, Manifold>(); const owned = new Set<Manifold>();
  const keep = (m: Manifold) => { owned.add(m); return m; };
  const build = (id: string): Manifold => {
    const cached = cache.get(id); if (cached) return cached;
    const node = doc.nodes[id]; let solid: Manifold;
    switch (node.kind) {
      case 'box': solid = keep(module.Manifold.cube(node.size, true)); break;
      case 'cylinder': solid = keep(module.Manifold.cylinder(node.height, node.radius, node.radius, node.segments, true)); break;
      case 'sphere': solid = keep(module.Manifold.sphere(node.radius, node.segments)); break;
      case 'mesh': {
        const mesh = new module.Mesh({ numProp: 3, vertProperties: new Float32Array(node.positions), triVerts: new Uint32Array(node.indices) });
        mesh.merge(); solid = keep(new module.Manifold(mesh)); break;
      }
      case 'boolean': {
        const operands = node.inputs.map(build);
        solid = keep(node.operation === 'union' ? module.Manifold.union(operands) : node.operation === 'subtract' ? module.Manifold.difference(operands) : module.Manifold.intersection(operands)); break;
      }
    }
    // Both Manifold and the viewport use fixed-axis X, then Y, then Z rotations.
    const scaled = keep(solid.scale(node.transform.scale));
    const rotated = keep(scaled.rotate(node.transform.rotation));
    const result = keep(rotated.translate(node.transform.position));
    const status = result.status();
    if (status !== 'NoError') throw new Error(`${node.name}: ${status}. Import a closed, consistently oriented solid mesh.`);
    cache.set(id, result); return result;
  };
  try {
    const bodies = doc.roots.map(id => {
      const solid = build(id); const node: SolidNode = doc.nodes[id]; const mesh = solid.getMesh();
      const positions = new Float32Array(mesh.numVert * 3);
      for (let i = 0; i < mesh.numVert; i++) for (let j = 0; j < 3; j++) positions[i * 3 + j] = mesh.vertProperties[i * mesh.numProp + j];
      const bounds = solid.boundingBox();
      return { id, name: node.name, color: node.color, positions, indices: new Uint32Array(mesh.triVerts), volume: solid.volume(), bounds };
    });
    return { bodies, volume: bodies.reduce((s, b) => s + b.volume, 0), triangles: bodies.reduce((s, b) => s + b.indices.length / 3, 0) };
  } finally { for (const solid of [...owned].reverse()) solid.delete(); }
}
