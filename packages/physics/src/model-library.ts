// SPDX-License-Identifier: BSD-3-Clause
import {createCadSession, validateModelLibraryCatalogue, type ModelLibraryFileSelection, type ModelLibraryCollisionReport, type ModelLibraryCatalogue} from '@brickwright/cad-core';
import {insertModelLibrarySTL, type GeometryKernel, type ModelLibraryMeshQualityOptions} from '@brickwright/cad-geometry';
import {prepareCollision} from './collision.js';
import {createPhysicsWorld} from './world.js';

export const MODEL_LIBRARY_COLLISION_QUALIFIER_VERSION = 'brickwright-library-collision/1';
export const MODEL_LIBRARY_JOLT_VERSION = '1.1.0-bw.10';
let qualificationJolt: Promise<any> | undefined;
export interface ModelLibraryCollisionOptions extends ModelLibraryMeshQualityOptions {
  /** Trusted host kernel from createGeometryKernel; never an untrusted external evaluator. */
  kernel: GeometryKernel;
  signal?: AbortSignal;
  maxHulls?: number;
  volumeFraction?: number;
  boundsMm?: number;
}
/** Complete serializable curation report, without runtime collision authority. */
export type ModelLibraryCollisionResult = ModelLibraryCollisionReport;

/** Explicit optional qualification of one reviewed STL, never visual-import certification.
 * Run in a host worker with a time limit: synchronous decomposition cannot be interrupted.
 * Failures reject without producing evidence or modifying catalogue/project/history.
 * Reports are curation evidence only, never reusable runtime collision proof objects.
 */
export async function qualifyModelLibrarySTL(
  catalogue: unknown, selection: ModelLibraryFileSelection, bytes: Uint8Array,
  options: ModelLibraryCollisionOptions,
): Promise<ModelLibraryCollisionResult> {
  // Snapshot options before the first asynchronous operation. Insertion snapshots bytes/metadata.
  const {kernel, signal, checkedOn, maxTriangles, maxExtentMm, maxHulls, volumeFraction, boundsMm} = options;
  const toMillimetresZUp = Array.from(options.toMillimetresZUp);
  signal?.throwIfAborted();
  const checked = validateModelLibraryCatalogue(catalogue);
  if (!checked.valid) throw new Error(`Invalid model library catalogue: ${checked.errors.join(' ')}`);
  const asset = checked.catalogue.assets.find(a => a.id === selection.assetId);
  const choice = selection.file;
  const selectedFile = choice === 'original' ? asset?.original : choice && typeof choice === 'object' && Number.isInteger(choice.derivative) && choice.derivative >= 0 ? asset?.derivatives[choice.derivative] : undefined;
  if (!selectedFile || selectedFile.format !== 'stl') throw new Error('Select one original or derivative STL.');
  const stableSelection = structuredClone(selection);
  const session = createCadSession();
  try {
    const quality = await insertModelLibrarySTL(session, checked.catalogue, stableSelection, bytes, {
      evaluate: document => kernel.evaluate(document), toMillimetresZUp,
      checkedOn, maxTriangles, maxExtentMm, signal,
      modificationNotes: 'Temporary isolated collision qualification with the recorded STL conversion; no repair.',
    });
    signal?.throwIfAborted();
    const document = session.state.document, geometry = kernel.evaluate(document);
    if (geometry.bodies.length !== 1 || (geometry.bodies[0].reference||geometry.bodies[0].hole)) throw new Error('Library collision qualification requires exactly one physical solid.');
    const mesh = geometry.bodies[0];
    const prepared = await prepareCollision(mesh, kernel, {maxHulls, volumeFraction, boundsMm});
    signal?.throwIfAborted();
    // Load our pinned debug build here: externally supplied modules cannot assert an engine identity.
    const J = await (qualificationJolt ??= import('jolt-physics/debug-wasm-compat').then(module => module.default()));
    signal?.throwIfAborted();
    // Native compound construction and a real fixed rigid step are required. No hull fallback.
    const world = await createPhysicsWorld(document, geometry, new Map([[mesh.id, prepared]]), {J, ground: false, mode: 'rigid-preview'});
    try {
      signal?.throwIfAborted();
      world.step();
      const pose = world.pose(mesh.id), bounds = world.geometryBoundsMm(mesh.id);
      if (![...pose.positionMm, ...pose.quaternion, ...bounds.min, ...bounds.max].every(Number.isFinite)) throw new Error('Jolt rigid collision preview produced a non-finite state.');
    } finally { world.dispose(); }
    signal?.throwIfAborted();
    const report = {format: 'brickwright-library-collision-report', version: 1, selectedFile, quality, evidence: {
      fileSha256: quality.fileSha256, checkedOn, toMillimetresZUp,
      engine: 'Jolt', engineVersion: MODEL_LIBRARY_JOLT_VERSION,
      qualifierVersion: MODEL_LIBRARY_COLLISION_QUALIFIER_VERSION, qualified: true,
      scope: 'rigid-collision-preview', sourceVolumeMm3: mesh.volume, geometrySha256: prepared.certificate.sourceSHA256,
      hulls: prepared.hulls.length, certificate: structuredClone(prepared.certificate),
      nativeCheck: {build: 'debug', ground: false, steps: 1, stepSeconds: 0.005},
    }};
    // Validate the full persisted representation before returning any positive report.
    asset!.quality = {...quality.quality!, collisionReport: report as ModelLibraryCollisionReport};
    const validated = validateModelLibraryCatalogue(checked.catalogue);
    if (!validated.valid) throw new Error(`Invalid produced collision report: ${validated.errors.join(' ')}`);
    return validated.catalogue.assets.find(a => a.id === stableSelection.assetId)!.quality!.collisionReport!;
  } finally { session.dispose(); }
}

/** Run fresh qualification and return a new validated catalogue with its complete report.
 * Never attaches caller-supplied serialized assertions or edits a project/history.
 */
export async function qualifyModelLibrarySTLAndAttach(
  catalogue: unknown, selection: ModelLibraryFileSelection, bytes: Uint8Array,
  options: ModelLibraryCollisionOptions,
): Promise<ModelLibraryCatalogue> {
  const checked = validateModelLibraryCatalogue(catalogue);
  if (!checked.valid) throw new Error(`Invalid model library catalogue: ${checked.errors.join(' ')}`);
  const stableSelection = structuredClone(selection);
  const report = await qualifyModelLibrarySTL(checked.catalogue, stableSelection, bytes, options);
  const asset = checked.catalogue.assets.find(a => a.id === stableSelection.assetId)!;
  asset.quality = {...report.quality.quality, collisionReport: report};
  const result = validateModelLibraryCatalogue(checked.catalogue);
  if (!result.valid) throw new Error(`Invalid qualified catalogue: ${result.errors.join(' ')}`);
  return result.catalogue;
}
