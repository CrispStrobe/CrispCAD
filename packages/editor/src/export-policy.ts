// SPDX-License-Identifier: BSD-3-Clause
import {hasModelAttribution, validateDocument, t} from '@brickwright/cad-core';
import type {CadDocument} from '@brickwright/cad-core';
import {export3MF, exportSTL, exportAttributedSTL} from '@brickwright/cad-geometry';
import type {GeometryResult} from '@brickwright/cad-geometry';

/** Hosts requesting a plain mesh must never silently drop recorded obligations. */
export function assertPlainMeshExport(document: CadDocument): void {
  if (hasModelAttribution(document)) throw new Error(t('Recorded library sources require STL with attribution. 3MF attribution export is not supported.'));
}

/** Evaluate and package one captured document. The host checks cancellation and
 * revision before/after every asynchronous boundary, including sidecar hashing.
 */
export async function prepareMeshExport(input: CadDocument, format: 'stl' | '3mf', evaluate: (document: CadDocument) => Promise<GeometryResult>, checkCurrent: () => void, modificationNotes?: string) {
  const snapshot = validateDocument(input);
  const attributed = hasModelAttribution(snapshot);
  if (attributed && format === '3mf') assertPlainMeshExport(snapshot);
  if (attributed && (typeof modificationNotes !== 'string' || !modificationNotes.trim() || modificationNotes.length > 4096 || /[\u0000-\u001f]/.test(modificationNotes))) throw new Error(t('Describe changes since insertion accurately, including when unchanged.'));
  checkCurrent();
  const result = await evaluate(snapshot);
  checkCurrent();
  const title = snapshot.title.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '-').trim() || 'design';
  const name = `${attributed ? title.slice(0, 230) : title}.${format}`;
  const bytes = attributed ? await exportAttributedSTL(snapshot, result.bodies, name, modificationNotes!) : format === 'stl' ? exportSTL(result.bodies) : export3MF(result.bodies);
  checkCurrent();
  return {name: attributed ? `${name}.zip` : name, bytes, mime: attributed ? 'application/zip' : format === 'stl' ? 'model/stl' : 'model/3mf'};
}
