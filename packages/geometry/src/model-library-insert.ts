// SPDX-License-Identifier: BSD-3-Clause
import {compileCode, importOpenSCAD, importJSCAD, identityTransform, newId, sha256Hex, validateModelLibraryCatalogue, type CadDocument, type ModelLibraryFileSelection, createCadSession} from '@brickwright/cad-core';
import {checkModelLibrarySTL, MODEL_LIBRARY_MESH_MAX_BYTES, MODEL_LIBRARY_MESH_MAX_TRIANGLES, parseModelLibrarySTL, type ModelLibraryMeshQualityResult} from './model-library-quality.js';
import type {GeometryResult} from './kernel.js';

export interface ModelLibraryInsertOptions {
  /** Evaluate the complete candidate document with the host's geometry kernel. */
  evaluate: (document: CadDocument) => GeometryResult | Promise<GeometryResult>;
  /** Explicit conversion for the selected STL, matching its retained screening policy. */
  toMillimetresZUp: readonly number[];
  /** Cancellation is checked again after asynchronous kernel evaluation, before commit. */
  signal?: AbortSignal;
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
  options.signal?.throwIfAborted();
  const signal = options.signal;
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
  signal?.throwIfAborted();
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
    const evaluated = await evaluate(trial.state.document);
    const body = evaluated.bodies.find(body => body.id === trial.state.selection[0]);
    if (!body || !Number.isFinite(body.volume) || body.volume <= 0 || !body.indices.length || !body.positions.every(Number.isFinite)) throw new Error('Selected STL did not produce a finite positive-volume kernel body.');
  } finally { trial.dispose(); }
  // Do not insert into a different revision if the host edits/loads while checks await.
  signal?.throwIfAborted();
  const current = session.state;
  if (current.document !== initial.document || current.revision !== initial.revision) throw new Error('Project changed during model library insertion; retry against the current revision.');
  session.insert(fragment, [0, 0, 0], {label: 'Insert library model'});
  return result;
}

export interface ModelLibrarySourceInsertOptions {
  evaluate: (document: CadDocument) => GeometryResult | Promise<GeometryResult>;
  signal?: AbortSignal;
  modificationNotes: string;
}
/** Verify and compile an original local source, evaluate its complete candidate,
 * then retain CAD Script as an editable code node with provenance in one edit.
 * OpenSCAD is translated by the supported importer; JSCAD becomes a bounded
 * evaluated default-parameter snapshot, not editable original JS. The local artifact
 * remains identified by its provenance hash rather than embedded in the node.
 * Source conversion is deliberately restricted to millimetres/Z-up identity.
 */
export async function insertModelLibrarySource(
  session: ReturnType<typeof createCadSession>, catalogue: unknown,
  selection: ModelLibraryFileSelection, bytes: Uint8Array, options: ModelLibrarySourceInsertOptions,
): Promise<void> {
  options.signal?.throwIfAborted();
  const initial = session.state, signal = options.signal, evaluate = options.evaluate;
  const modificationNotes = options.modificationNotes;
  if (typeof modificationNotes !== 'string' || !modificationNotes.trim() || modificationNotes.length > 4096 || /[\u0000-\u001f]/.test(modificationNotes)) throw new Error('Explicit incorporation modification notes are required.');
  const checked = validateModelLibraryCatalogue(catalogue);
  if (!checked.valid) throw new Error(`Invalid model library catalogue: ${checked.errors.join(' ')}`);
  const asset = checked.catalogue.assets.find(asset => asset.id === selection.assetId);
  if (!asset) throw new Error('Unknown model library asset.');
  const file = selection.file === 'original' ? asset.original : selection.file === 'editableSource' ? asset.editableSource : undefined;
  if (!file?.path || !['cad-script', 'openscad', 'jscad'].includes(file.format)) throw new Error('Select a local editable CAD Script, supported OpenSCAD or JSCAD source.');
  if (file.bytes > 32768 || bytes.byteLength !== file.bytes) throw new Error('Source exceeds 32 KiB or file size mismatch.');
  if (JSON.stringify(asset.conversion.toMillimetresZUp) !== JSON.stringify([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]) || asset.conversion.sourceUnits !== 'mm' || asset.conversion.sourceUpAxis !== 'Z') throw new Error('Editable source requires millimetres/Z-up identity conversion.');
  const snapshot = bytes.slice();
  if (await sha256Hex(snapshot) !== file.sha256) throw new Error('Model library file size or SHA-256 mismatch.');
  const source = new TextDecoder('utf-8', {fatal: true}).decode(snapshot);
  const jscad = file.format === 'jscad' ? importJSCAD(source) : undefined;
  const incorporationNotes = modificationNotes + (file.format === 'openscad' ? ' OpenSCAD translated to editable CAD Script by the supported subset importer.' : jscad ? ` JSCAD converted by the bounded subset interpreter to an editable CAD Script evaluated snapshot with default parameters ${JSON.stringify(jscad.parameters)}. Original JavaScript parameter definitions are not retained in the code node; no collision qualification.` : '');
  if (incorporationNotes.length > 4096) throw new Error('Incorporation modification notes exceed the provenance limit after recording source conversion.');
  const program = jscad ? jscad.program : file.format === 'openscad' ? importOpenSCAD(source) : {version: 1 as const, language: 'brickwright-cad-script' as const, source, parameters: {}};
  compileCode(program);
  const nodeId = newId(), recordId = newId();
  const fragment: CadDocument = {format: 'brickwright-cad', id: newId(), version: 5, title: asset.title, units: 'mm', roots: [nodeId], nodes: {
    [nodeId]: {id: nodeId, kind: 'code', program, name: asset.title, color: '#76b7ce', transform: identityTransform(), provenance: [recordId]},
  }, provenance: {version: 1, records: [{id: recordId, asset, selectedFile: file, modificationNotes: incorporationNotes}]}};
  const trial = createCadSession(initial.document);
  try {
    trial.insert(fragment, [0,0,0], {label: 'Insert library source'});
    signal?.throwIfAborted();
    const evaluated = await evaluate(trial.state.document);
    const body = evaluated.bodies.find(body => body.id === trial.state.selection[0]);
    if (!body || !Number.isFinite(body.volume) || body.volume <= 0 || !body.indices.length || !body.positions.every(Number.isFinite)) throw new Error('Selected source did not produce a finite positive-volume kernel body.');
  } finally { trial.dispose(); }
  signal?.throwIfAborted();
  if (session.state.document !== initial.document || session.state.revision !== initial.revision) throw new Error('Project changed during model library insertion; retry against the current revision.');
  session.insert(fragment, [0,0,0], {label: 'Insert library source'});
}
