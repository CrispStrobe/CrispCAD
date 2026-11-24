// SPDX-License-Identifier: BSD-3-Clause
import {t} from '@brickwright/cad-core';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { MAX_DOCUMENT_BYTES, parseDocument, serializeDocument } from '@brickwright/cad-core';
import type { CadDocument, Vec3 } from '@brickwright/cad-core';
import type { BodyMesh } from '@brickwright/cad-geometry';
export const CAD_PROJECT_PATH = 'brickwright/cad.json';
export const BRICKWRIGHT_ADAPTER_VERSION = 1;
const MAX_ARCHIVE = 64 * 1024 * 1024;
const MAX_EXPANDED = 128 * 1024 * 1024;
function unpack(bytes: Uint8Array, onlyCad = false) {
  if (bytes.byteLength > MAX_ARCHIVE) throw new Error(t('Brickwright archive exceeds 64 MiB'));
  let expanded = 0;
  return unzipSync(bytes, { filter: file => {
    if (onlyCad && file.name !== CAD_PROJECT_PATH) return false;
    expanded += file.originalSize;
    if (expanded > MAX_EXPANDED || (file.name === CAD_PROJECT_PATH && file.originalSize > MAX_DOCUMENT_BYTES)) throw new Error(t('Brickwright archive exceeds extraction limits'));
    return true;
  } });
}
/** Preserve project.json, assets and ALL existing Brickwright sections byte-for-byte as ZIP entries. */
export function attachCadProject(sb3: Uint8Array, document: CadDocument | null): Uint8Array {
  const files = unpack(sb3);
  if (!Object.hasOwn(files, 'project.json')) throw new Error(t('Not a Scratch/Brickwright project: project.json is missing'));
  if (document) files[CAD_PROJECT_PATH] = strToU8(serializeDocument(document));
  else delete files[CAD_PROJECT_PATH];
  return zipSync(files);
}
/** Null means a legacy project with no CAD state. Future/invalid documents throw. */
export function extractCadProject(sb3: Uint8Array): CadDocument | null {
  const files = unpack(sb3, true); const data = files[CAD_PROJECT_PATH];
  return data ? parseDocument(strFromU8(data)) : null;
}
// LDraw is right-handed, Y down; CAD is right-handed, Z up. 1 LDU = 0.4 mm.
export const ldrawToCadPoint = ([x, y, z]: Vec3): Vec3 => [x * 0.4, z * 0.4, -y * 0.4];
export const cadToLdrawPoint = ([x, y, z]: Vec3): Vec3 => [x / 0.4, -z / 0.4, y / 0.4];
const P = [1, 0, 0, 0, 0, 1, 0, -1, 0];
const PT = [1, 0, 0, 0, 0, -1, 0, 1, 0];
const mul = (a: number[], b: number[]) => Array.from({ length: 9 }, (_, n) => { const r = Math.floor(n / 3), c = n % 3; return a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]; });
export function ldrawToCadRotation(rotation: number[]) { if (rotation.length !== 9 || !rotation.every(Number.isFinite)) throw new Error(t('Expected a 3×3 rotation')); return mul(mul(P, rotation), PT); }
export function cadToLdrawRotation(rotation: number[]) { if (rotation.length !== 9 || !rotation.every(Number.isFinite)) throw new Error(t('Expected a 3×3 rotation')); return mul(mul(PT, rotation), P); }
/** A self-authored part mesh, in LDraw units. Physics/connectors require separate authoring. */
export function toBrickwrightPart(body: BodyMesh) {
  const center = body.bounds.min.map((v, i) => (v + body.bounds.max[i]) / 2) as Vec3;
  const vertices = Array.from({ length: body.positions.length / 3 }, (_, i) => cadToLdrawPoint([body.positions[i * 3] - center[0], body.positions[i * 3 + 1] - center[1], body.positions[i * 3 + 2] - center[2]]));
  const fileName = `cad-${body.id.replace(/[^a-zA-Z0-9_-]/g, '')}.dat`;
  const name = body.name.replace(/[\r\n\u0000-\u001f]/g, ' ');
  const lines = [`0 ${name}`, `0 Name: ${fileName}`, '0 Author: CrispCAD user', '0 BFC CERTIFY CCW'];
  for (let t = 0; t < body.indices.length; t += 3) lines.push(`3 16 ${[0, 1, 2].flatMap(i => vertices[body.indices[t + i]]).join(' ')}`);
  return {
    format: 'brickwright-cad-part' as const, version: 1 as const,
    fileName, ldraw: lines.join('\n') + '\n',
    placement: { id: body.id, part: fileName, color: 16, position: cadToLdrawPoint(center), rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1] },
    geometry: { units: 'ldu' as const, positions: vertices.flat(), indices: Array.from(body.indices) },
    requiresPhysicsMetadata: true as const,
  };
}
