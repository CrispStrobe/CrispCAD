// SPDX-License-Identifier: BSD-3-Clause
import {parentPort, workerData} from 'node:worker_threads';
import {readFile} from 'node:fs/promises';
import {createGeometryKernel} from '../packages/geometry/dist/index.js';
import {qualifyModelLibrarySTLAndAttach} from '../packages/physics/dist/index.js';

// Every input is a selected, already bounded local snapshot. Never fetch meshes,
// resolve catalogue URLs, or load WASM through a network fallback.
globalThis.fetch = async () => { throw new Error('Offline qualification forbids network access.'); };
try {
  const kernel = await createGeometryKernel({wasmBinary: await readFile(new URL('../node_modules/manifold-3d/manifold.wasm', import.meta.url))});
  const {catalogue, selection, bytes, checkedOn} = workerData;
  const asset = catalogue.assets.find(asset => asset.id === selection.assetId);
  const policy = asset.quality.screeningPolicy;
  const result = await qualifyModelLibrarySTLAndAttach(catalogue, selection, bytes, {
    kernel, checkedOn, toMillimetresZUp: policy.toMillimetresZUp,
    maxTriangles: policy.maxTriangles, maxExtentMm: policy.maxExtentMm,
    maxHulls: 2048, volumeFraction: 0.02, boundsMm: 0.2,
  });
  parentPort.postMessage({catalogue: result});
} catch (error) {
  parentPort.postMessage({error: error instanceof Error ? error.message : String(error)});
}
