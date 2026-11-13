// SPDX-License-Identifier: BSD-3-Clause
import {hasModelAttribution, t} from '@brickwright/cad-core';
import type {CadDocument} from '@brickwright/cad-core';

/** Single-file hosts cannot carry recorded source obligations on STL or 3MF. */
export function assertPlainMeshExport(document: CadDocument): void {
  if (hasModelAttribution(document)) throw new Error(t('This editor cannot export meshes with recorded library sources yet. Save the project, then use MCP cad_export_stl with accurate modificationNotes to obtain STL and attribution together. 3MF attribution export is not supported.'));
}
