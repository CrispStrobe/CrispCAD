// SPDX-License-Identifier: BSD-3-Clause
import {sha256Hex, type ModelLibraryAsset, type ModelLibraryScreeningPolicy} from '@brickwright/cad-core';

export const MODEL_LIBRARY_MESH_CHECK_VERSION = 'brickwright-stl-quality/1';
/** Hard analysis budgets, independent of caller admission limits. */
export const MODEL_LIBRARY_MESH_MAX_BYTES = 16 * 1024 * 1024;
export const MODEL_LIBRARY_MESH_MAX_TRIANGLES = 83_333;
export type ModelLibraryMeshCheck = 'pass' | 'fail' | 'unchecked';
export interface ModelLibraryMeshQualityOptions {
  /** Explicit source-to-mm, Z-up affine conversion; STL itself has no units. */
  toMillimetresZUp: readonly number[];
  checkedOn: string;
  maxTriangles?: number;
  /** Maximum span along any converted axis, in millimetres. Default: 1000. */
  maxExtentMm?: number;
}
export interface ModelLibraryMeshQualityResult {
  fileSha256: string;
  toolVersion: string;
  checkedOn: string;
  policy: ModelLibraryScreeningPolicy;
  checks: {parseable: ModelLibraryMeshCheck; closedPositiveVolume: ModelLibraryMeshCheck; withinSizeLimits: ModelLibraryMeshCheck; withinTriangleLimits: ModelLibraryMeshCheck};
  diagnostics: string[];
  triangles?: number;
  boundsMm?: {min: number[]; max: number[]};
  signedVolumeMm3?: number;
  /** Available only after a complete parse and all geometry checks. No physics evidence. */
  quality?: NonNullable<ModelLibraryAsset['quality']>;
}
const NUMBER = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?';
const vector = new RegExp(`^(${NUMBER})\\s+(${NUMBER})\\s+(${NUMBER})$`);
/** Internal strict parser shared by quality screening and catalogue insertion. */
export function parseModelLibrarySTL(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = bytes.length >= 84 ? view.getUint32(80, true) : 0;
  if (count && bytes.length === 84 + count * 50) {
    if (count > MODEL_LIBRARY_MESH_MAX_TRIANGLES) throw new Error('Triangle analysis budget exceeded.');
    const positions: number[] = [];
    for (let i = 0; i < count; i++) {
      for (let j = 0; j < 12; j++) {
        const value = view.getFloat32(84 + i * 50 + j * 4, true);
        if (!Number.isFinite(value)) throw new Error('Non-finite STL data.');
        if (j >= 3) positions.push(value);
      }
    }
    return positions;
  }
  // Consume the full ASCII grammar. A loose vertex search is not evidence of a valid file.
  const text = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  let i = 0;
  if (!/^solid(?:\s.*)?$/i.test(lines[i++] ?? '')) throw new Error('Invalid STL header or binary length.');
  const positions: number[] = [];
  const readVector = (prefix: RegExp): number[] => {
    const line = lines[i++] ?? '';
    const match = prefix.exec(line);
    const values = match && vector.exec(line.slice(match[0].length));
    if (!values) throw new Error('Invalid ASCII STL facet.');
    const numbers = values.slice(1).map(Number);
    if (!numbers.every(Number.isFinite)) throw new Error('Non-finite STL data.');
    return numbers;
  };
  while (/^facet\b/i.test(lines[i] ?? '')) {
    if (positions.length / 9 >= MODEL_LIBRARY_MESH_MAX_TRIANGLES) throw new Error('Triangle analysis budget exceeded.');
    readVector(/^facet\s+normal\s+/i);
    if (!/^outer\s+loop$/i.test(lines[i++] ?? '')) throw new Error('Missing STL outer loop.');
    for (let v = 0; v < 3; v++) positions.push(...readVector(/^vertex\s+/i));
    if (!/^endloop$/i.test(lines[i++] ?? '') || !/^endfacet$/i.test(lines[i++] ?? '')) throw new Error('Incomplete STL facet.');
  }
  if (!positions.length || !/^endsolid(?:\s.*)?$/i.test(lines[i++] ?? '') || i !== lines.length) throw new Error('Incomplete STL or trailing data.');
  return positions;
}

/**
 * Inspect only these STL bytes, without editing documents or importing library provenance.
 * Closure checks exact coincident vertices, oriented edges and connected vertex fans.
 * Signed volume is a geometric screen, not a self-intersection, printability or collision
 * certification. Intersections between nonadjacent faces/shells are not detected.
 */
export async function checkModelLibrarySTL(bytes: Uint8Array, options: ModelLibraryMeshQualityOptions): Promise<ModelLibraryMeshQualityResult> {
  const m = Array.from(options.toMillimetresZUp);
  const checkedOn = options.checkedOn;
  const maxTriangles = options.maxTriangles ?? MODEL_LIBRARY_MESH_MAX_TRIANGLES;
  const maxExtentMm = options.maxExtentMm ?? 1000;
  const determinant = m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);
  if (m.length !== 16 || !m.every(Number.isFinite) || m[3] !== 0 || m[7] !== 0 || m[11] !== 0 || m[15] !== 1 || !Number.isFinite(determinant) || determinant === 0) throw new Error('An invertible source-to-mm affine conversion is required.');
  if (!Number.isSafeInteger(maxTriangles) || maxTriangles < 1 || maxTriangles > MODEL_LIBRARY_MESH_MAX_TRIANGLES || !Number.isFinite(maxExtentMm) || maxExtentMm <= 0) throw new Error('Invalid mesh admission limits.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkedOn) || !Number.isFinite(Date.parse(checkedOn)) || new Date(checkedOn).toISOString().slice(0, 10) !== checkedOn) throw new Error('A valid quality capture date is required.');
  // Snapshot before asynchronous hashing so analysis and identity use the same bytes.
  if (bytes.byteLength > MODEL_LIBRARY_MESH_MAX_BYTES) throw new Error('STL exceeds the 16 MiB analysis budget.');
  const snapshot = new Uint8Array(bytes);
  const result: ModelLibraryMeshQualityResult = {
    fileSha256: await sha256Hex(snapshot), toolVersion: MODEL_LIBRARY_MESH_CHECK_VERSION, checkedOn,
    policy: {maxTriangles, maxExtentMm, toMillimetresZUp: m, maxAnalysisBytes: MODEL_LIBRARY_MESH_MAX_BYTES, maxAnalysisTriangles: MODEL_LIBRARY_MESH_MAX_TRIANGLES},
    checks: {parseable: 'unchecked', closedPositiveVolume: 'unchecked', withinSizeLimits: 'unchecked', withinTriangleLimits: 'unchecked'}, diagnostics: [],
  };
  let positions: number[];
  try { positions = parseModelLibrarySTL(snapshot); }
  catch (error) {
    const message = error instanceof Error ? error.message : 'STL parse failed.';
    // Resource exhaustion is not proof of malformed geometry.
    if (!message.includes('budget exceeded')) result.checks.parseable = 'fail';
    else result.checks.withinTriangleLimits = 'fail';
    result.diagnostics.push(message); return result;
  }
  result.checks.parseable = 'pass';
  result.triangles = positions.length / 9;
  result.checks.withinTriangleLimits = result.triangles <= maxTriangles ? 'pass' : 'fail';
  const points: number[][] = [];
  const ids = new Map<string, number>();
  const faces: number[][] = [];
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    const [x, y, z] = positions.slice(i, i + 3);
    const p = [0, 1, 2].map(k => m[k] * x + m[k + 4] * y + m[k + 8] * z + m[k + 12]);
    if (!p.every(Number.isFinite)) {
      result.checks.withinSizeLimits = 'fail'; result.diagnostics.push('Conversion exceeds finite coordinate range.'); return result;
    }
    for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p[k]); max[k] = Math.max(max[k], p[k]); }
    const key = p.join(','); let id = ids.get(key);
    if (id === undefined) { id = points.length; ids.set(key, id); points.push(p); }
    if (i % 9 === 0) faces.push([]);
    faces[faces.length - 1].push(id);
  }
  result.boundsMm = {min, max};
  result.checks.withinSizeLimits = max.every((v, k) => v - min[k] <= maxExtentMm) ? 'pass' : 'fail';
  const edges = new Map<string, {count: number; direction: number}>();
  const links: Map<number, number[]>[] = points.map(() => new Map());
  let valid = true, volume = 0;
  for (const face of faces) {
    const [a, b, c] = face.map(id => points[id].map((v, k) => v - min[k]));
    const u = b.map((v, k) => v - a[k]), v = c.map((v, k) => v - a[k]);
    if (Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) === 0) valid = false;
    volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    for (let k = 0; k < 3; k++) {
      const x = face[k], y = face[(k + 1) % 3], z = face[(k + 2) % 3];
      const key = x < y ? `${x},${y}` : `${y},${x}`;
      const edge = edges.get(key) ?? {count: 0, direction: 0}; edge.count++; edge.direction += x < y ? 1 : -1; edges.set(key, edge);
      for (const [from, to] of [[y, z], [z, y]]) { const list = links[x].get(from) ?? []; list.push(to); links[x].set(from, list); }
    }
  }
  if ([...edges.values()].some(edge => edge.count !== 2 || edge.direction !== 0)) valid = false;
  // Each vertex link must be one cycle; edge checks alone admit pinched vertices.
  for (const link of links) {
    if ([...link.values()].some(neighbours => neighbours.length !== 2)) { valid = false; break; }
    const seen = new Set<number>(), pending = [link.keys().next().value!];
    while (pending.length) { const id = pending.pop()!; if (seen.has(id)) continue; seen.add(id); pending.push(...link.get(id)!); }
    if (seen.size !== link.size) { valid = false; break; }
  }
  result.signedVolumeMm3 = volume;
  result.checks.closedPositiveVolume = valid && Number.isFinite(volume) && volume > 0 ? 'pass' : 'fail';
  if (result.checks.closedPositiveVolume === 'fail') result.diagnostics.push('Mesh must have nondegenerate, consistently oriented closed manifold topology and positive signed volume.');
  if (Object.values(result.checks).every(check => check !== 'unchecked')) {
    result.quality = {fileSha256: result.fileSha256, toolVersion: result.toolVersion, checkedOn: result.checkedOn,
      screeningPolicy: structuredClone(result.policy), parseable: true, closedPositiveVolume: result.checks.closedPositiveVolume === 'pass', withinSizeLimits: result.checks.withinSizeLimits === 'pass', withinTriangleLimits: result.checks.withinTriangleLimits === 'pass'};
  }
  return result;
}
