// SPDX-License-Identifier: BSD-3-Clause
import { strToU8, zipSync } from 'fflate';
import type { BodyMesh } from './kernel.js';
/** Binary STL, world-space millimetres. Normals are calculated from winding. */
export function exportSTL(bodies: readonly BodyMesh[]): Uint8Array {
  bodies = bodies.filter(body=>!body.reference);
  const triangles = bodies.reduce((s, b) => s + b.indices.length / 3, 0);
  if (!triangles) throw new Error('The design has no solid triangles to export');
  const bytes = new Uint8Array(84 + triangles * 50); const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode('Brickwright CAD | millimetres')); view.setUint32(80, triangles, true);
  let offset = 84;
  for (const b of bodies) for (let t = 0; t < b.indices.length; t += 3) {
    const p = [0, 1, 2].map(k => Array.from(b.positions.subarray(b.indices[t + k] * 3, b.indices[t + k] * 3 + 3)));
    const a = p[1].map((x, i) => x - p[0][i]); const c = p[2].map((x, i) => x - p[0][i]);
    const n = [a[1] * c[2] - a[2] * c[1], a[2] * c[0] - a[0] * c[2], a[0] * c[1] - a[1] * c[0]]; const len = Math.hypot(...n) || 1;
    [...n.map(x => x / len), ...p.flat()].forEach((v, i) => view.setFloat32(offset + i * 4, v, true)); offset += 50;
  } return bytes;
}
export function importSTL(bytes: Uint8Array): { positions: number[]; indices: number[] } {
  if (bytes.byteLength > 16 * 1024 * 1024) throw new Error('STL exceeds 16 MiB');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); const positions: number[] = [];
  const count = bytes.length >= 84 ? view.getUint32(80, true) : 0;
  if (count && bytes.length === 84 + count * 50) {
    for (let t = 0; t < count; t++) for (let j = 0; j < 9; j++) positions.push(view.getFloat32(84 + t * 50 + 12 + j * 4, true));
  } else {
    const text = new TextDecoder().decode(bytes);
    if (!/^\s*solid\b/i.test(text) || !/endsolid/i.test(text)) throw new Error('Not a valid binary or ASCII STL');
    const vertices = [...text.matchAll(/\bvertex\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)/gi)];
    for (const v of vertices) positions.push(Number(v[1]), Number(v[2]), Number(v[3]));
  }
  if (positions.length < 36 || positions.length % 9 || positions.length > 750000 || positions.some(x => !Number.isFinite(x) || Math.abs(x) > 1e6)) throw new Error('STL has invalid or excessive triangle data');
  return { positions, indices: Array.from({ length: positions.length / 3 }, (_, i) => i) };
}
const escape = (s: string) => s.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);
export function export3MF(bodies: readonly BodyMesh[]): Uint8Array {
  // Empty boolean results have no printable object in the 3MF core format.
  bodies = bodies.filter(body => !body.reference && body.indices.length > 0);
  if (!bodies.some(b => b.indices.length)) throw new Error('The design has no solid triangles to export');
  const objects = bodies.map((b, i) => `<object id="${i + 1}" type="model" name="${escape(b.name)}"><mesh><vertices>${Array.from({ length: b.positions.length / 3 }, (_, n) => `<vertex x="${b.positions[n * 3]}" y="${b.positions[n * 3 + 1]}" z="${b.positions[n * 3 + 2]}"/>`).join('')}</vertices><triangles>${Array.from({ length: b.indices.length / 3 }, (_, n) => `<triangle v1="${b.indices[n * 3]}" v2="${b.indices[n * 3 + 1]}" v3="${b.indices[n * 3 + 2]}"/>`).join('')}</triangles></mesh></object>`).join('');
  const model = `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources>${objects}</resources><build>${bodies.map((_, i) => `<item objectid="${i + 1}"/>`).join('')}</build></model>`;
  return zipSync({ '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>'), '_rels/.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'), '3D/3dmodel.model': strToU8(model) });
}
