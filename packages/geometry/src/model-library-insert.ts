// SPDX-License-Identifier: BSD-3-Clause
import {identityTransform, newId, sha256Hex, validateModelLibraryCatalogue, type CadDocument, type ModelLibraryFileSelection, createCadSession} from '@brickwright/cad-core';
import {checkModelLibrarySTL, MODEL_LIBRARY_MESH_MAX_BYTES, MODEL_LIBRARY_MESH_MAX_TRIANGLES, parseModelLibrarySTL, type ModelLibraryMeshQualityResult} from './model-library-quality.js';
import type {GeometryKernel} from './kernel.js';

export interface ModelLibraryInsertOptions {
  /** Evaluate the complete candidate document with the host's geometry kernel. */
  evaluate: GeometryKernel['evaluate'];
  /** Explicit conversion for the selected STL, matching its retained screening policy. */
  toMillimetresZUp: readonly number[];
  checkedOn: string;
  modificationNotes: string;
  /** Optional stricter admission limits. Never relaxes the curated policy. */
  maxTriangles?: number;
  maxExtentMm?: number;
}

/** Insert one verified, freshly screened STL and its source snapshot as one edit.
 * No fetching, repairs, centering, physics qualification or user-STL import policy.
 */
export async function insertModelLibrarySTL(
  session: ReturnType<typeof createCadSession>, catalogue: unknown, selection: ModelLibraryFileSelection,
  bytes: Uint8Array, options: ModelLibraryInsertOptions,
): Promise<ModelLibraryMeshQualityResult> {
  const initial = session.state;
  const validation = validateModelLibraryCatalogue(catalogue);
  if (!validation.valid) throw new Error(`Invalid model library catalogue: ${validation.errors.join(' ')}`);
  const asset = validation.catalogue.assets.find(asset => asset.id === selection.assetId);
  if (!asset) throw new Error('Unknown model library asset.');
  const choice = selection.file;
  const file = choice === 'original' ? asset.original
    : choice && typeof choice === 'object' && Number.isInteger(choice.derivative) && choice.derivative >= 0 ? asset.derivatives[choice.derivative] : undefined;
  if (!file || file.format !== 'stl') throw new Error('Select one original or derivative STL file.');
  if (file.bytes > MODEL_LIBRARY_MESH_MAX_BYTES || bytes.byteLength > MODEL_LIBRARY_MESH_MAX_BYTES) throw new Error('STL exceeds the 16 MiB analysis budget.');
  if (bytes.byteLength !== file.bytes) throw new Error('Model library file size or SHA-256 mismatch.');
  const quality = asset.quality, policy = quality?.screeningPolicy;
  if (!quality || quality.fileSha256 !== file.sha256 || !quality.parseable || !quality.closedPositiveVolume || !quality.withinSizeLimits || !quality.withinTriangleLimits || !policy) throw new Error('Selected STL requires passing curated quality and a reproducible screening policy.');
  if (bytes.byteLength > policy.maxAnalysisBytes) throw new Error('STL exceeds its curated analysis byte budget.');
  const m = Array.from(options.toMillimetresZUp);
  if (JSON.stringify(m) !== JSON.stringify(policy.toMillimetresZUp)) throw new Error('Selected STL conversion must match its curated screening policy.');
  const checkedOn = options.checkedOn, modificationNotes = options.modificationNotes, evaluate = options.evaluate;
  if (typeof modificationNotes !== 'string' || !modificationNotes.trim() || modificationNotes.length > 4096 || /[\u0000-\u001f]/.test(modificationNotes)) throw new Error('Explicit incorporation modification notes are required.');
  const maxTriangles = options.maxTriangles ?? Math.min(policy.maxTriangles, policy.maxAnalysisTriangles, MODEL_LIBRARY_MESH_MAX_TRIANGLES);
  const maxExtentMm = options.maxExtentMm ?? policy.maxExtentMm;
  if (maxTriangles > policy.maxTriangles || maxExtentMm > policy.maxExtentMm) throw new Error('Insertion limits cannot relax the curated screening policy.');
  const snapshot = new Uint8Array(bytes);
  if (await sha256Hex(snapshot) !== file.sha256) throw new Error('Model library file size or SHA-256 mismatch.');
  const result = await checkModelLibrarySTL(snapshot, {toMillimetresZUp: m, checkedOn, maxTriangles, maxExtentMm});
  if (!Object.values(result.checks).every(check => check === 'pass')) throw new Error(`Selected STL failed fresh quality screening. ${result.diagnostics.join(' ')}`);
  const raw = parseModelLibrarySTL(snapshot), positions: number[] = [];
  for (let i = 0; i < raw.length; i += 3) {
    const [x, y, z] = raw.slice(i, i + 3);
    for (let k = 0; k < 3; k++) positions.push(m[k] * x + m[k + 4] * y + m[k + 8] * z + m[k + 12]);
  }
  const nodeId = newId(), recordId = newId();
  const fragment: CadDocument = {format: 'brickwright-cad', id: newId(), version: 5, title: asset.title, units: 'mm', roots: [nodeId], nodes: {
    [nodeId]: {id: nodeId, kind: 'mesh', name: asset.title, color: '#eea52b', transform: identityTransform(), positions,
      indices: Array.from({length: positions.length / 3}, (_, i) => i), provenance: [recordId]},
  }, provenance: {version: 1, records: [{id: recordId, asset, selectedFile: file, modificationNotes}]}};
  const trial = createCadSession(initial.document);
  try {
    trial.insert(fragment, [0, 0, 0], {label: 'Insert library model'});
    const evaluated = evaluate(trial.state.document);
    const body = evaluated.bodies.find(body => body.id === trial.state.selection[0]);
    if (!body || !Number.isFinite(body.volume) || body.volume <= 0 || !body.indices.length || !body.positions.every(Number.isFinite)) throw new Error('Selected STL did not produce a finite positive-volume kernel body.');
  } finally { trial.dispose(); }
  // Do not insert into a different revision if the host edits/loads while checks await.
  const current = session.state;
  if (current.document !== initial.document || current.revision !== initial.revision) throw new Error('Project changed during model library insertion; retry against the current revision.');
  session.insert(fragment, [0, 0, 0], {label: 'Insert library model'});
  return result;
}
