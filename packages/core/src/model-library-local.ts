// SPDX-License-Identifier: BSD-3-Clause
import {validateModelLibraryCatalogue, type ModelLibraryCatalogue} from './model-library.js';

/** Project curated checked-in collection metadata to local file identities, never
 * inventing publication URLs. Validation does not establish grants or file bytes.
 */
export function createLocalModelLibraryCatalogue(manifest: unknown): ModelLibraryCatalogue {
  if (!manifest || typeof manifest !== 'object') throw new Error('Invalid local model library manifest.');
  const value = structuredClone(manifest) as Record<string, unknown>;
  if (!['brickwright-local-example-library', 'brickwright-local-fixture-library'].includes(String(value.format)) || value.version !== 1 || value.pathBase !== 'library/' || !Array.isArray(value.assets)) throw new Error('Unsupported local model library manifest.');
  const file = (raw: any) => ({path: raw?.path, format: raw?.format, bytes: raw?.bytes, sha256: raw?.sha256});
  const assets = value.assets.map((raw: any) => ({
    id: raw.id, version: String(raw.version), title: raw.title, author: raw.author,
    sourceUrl: raw.sourceRevision?.sourceUrl,
    sourceRevision: {repositoryUrl: raw.sourceRevision?.repositoryUrl, commit: raw.sourceRevision?.commit},
    licence: {spdx: raw.licence?.spdx, scope: raw.licence?.scope, attribution: raw.licence?.attribution,
      evidenceUrl: raw.licence?.evidenceUrl, capturedOn: raw.licence?.capturedOn, review: raw.licence?.review, reviewer: raw.licence?.reviewer},
    original: file(raw.original), derivatives: Array.isArray(raw.derivatives) ? raw.derivatives.map(file) : raw.derivatives,
    modificationNotes: raw.modificationNotes, conversion: raw.conversion,
    ...(raw.quality === undefined ? {} : {quality: raw.quality}),
  }));
  const result = validateModelLibraryCatalogue({format: 'brickwright-model-library', version: 1, assets});
  if (!result.valid) throw new Error(`Invalid local model library: ${result.errors.join(' ')}`);
  return result.catalogue;
}
