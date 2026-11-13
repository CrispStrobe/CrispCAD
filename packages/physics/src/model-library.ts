// SPDX-License-Identifier: BSD-3-Clause
import {createCadSession, type ModelLibraryFileSelection} from '@brickwright/cad-core';
import {insertModelLibrarySTL, type GeometryKernel, type ModelLibraryMeshQualityOptions, type ModelLibraryMeshQualityResult} from '@brickwright/cad-geometry';
import {prepareCollision, type CollisionCertificate} from './collision.js';
import {createPhysicsWorld} from './world.js';

export const MODEL_LIBRARY_COLLISION_QUALIFIER_VERSION = 'brickwright-library-collision/1';
export const MODEL_LIBRARY_JOLT_VERSION = '1.1.0-bw.9';
let qualificationJolt: Promise<any> | undefined;
export interface ModelLibraryCollisionOptions extends ModelLibraryMeshQualityOptions {
  /** Trusted host kernel from createGeometryKernel; never an untrusted external evaluator. */
  kernel: GeometryKernel;
  signal?: AbortSignal;
  maxHulls?: number;
  volumeFraction?: number;
  boundsMm?: number;
}
export interface ModelLibraryCollisionResult {
  /** Fresh geometry screen; kept separate from collision evidence. */
  quality: ModelLibraryMeshQualityResult;
  evidence: {
    fileSha256: string;
    checkedOn: string;
    toMillimetresZUp: number[];
    engine: 'Jolt';
    engineVersion: string;
    qualifierVersion: string;
    qualified: true;
    scope: 'rigid-collision-preview';
    geometrySha256: string;
    hulls: number;
    certificate: CollisionCertificate;
    nativeCheck: {build: 'debug'; ground: false; steps: 1; stepSeconds: 0.005};
  };
}

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
  const session = createCadSession();
  try {
    const quality = await insertModelLibrarySTL(session, catalogue, selection, bytes, {
      evaluate: document => kernel.evaluate(document), toMillimetresZUp,
      checkedOn, maxTriangles, maxExtentMm, signal,
      modificationNotes: 'Temporary isolated collision qualification with the recorded STL conversion; no repair.',
    });
    signal?.throwIfAborted();
    const document = session.state.document, geometry = kernel.evaluate(document);
    if (geometry.bodies.length !== 1 || geometry.bodies[0].reference) throw new Error('Library collision qualification requires exactly one physical solid.');
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
    return {quality, evidence: {
      fileSha256: quality.fileSha256, checkedOn, toMillimetresZUp,
      engine: 'Jolt', engineVersion: MODEL_LIBRARY_JOLT_VERSION,
      qualifierVersion: MODEL_LIBRARY_COLLISION_QUALIFIER_VERSION, qualified: true,
      scope: 'rigid-collision-preview', geometrySha256: prepared.certificate.sourceSHA256,
      hulls: prepared.hulls.length, certificate: structuredClone(prepared.certificate),
      nativeCheck: {build: 'debug', ground: false, steps: 1, stepSeconds: 0.005},
    }};
  } finally { session.dispose(); }
}
