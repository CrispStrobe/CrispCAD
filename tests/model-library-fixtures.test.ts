// SPDX-License-Identifier: BSD-3-Clause
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {expect, it} from 'vitest';
import {checkModelLibrarySTL} from '../packages/geometry/src/model-library-quality.js';

const root = new URL('../', import.meta.url);
const read = (path: string) => readFileSync(new URL(`library/${path}`, root));
const manifest = JSON.parse(read('fixtures-manifest.json').toString());
const asset = manifest.assets[0];
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

it('retains pinned editable fixture, author and full model grant independently of rendered quality', () => {
  expect(manifest.format).toBe('brickwright-local-fixture-library');
  expect(manifest.version).toBe(1);
  expect(manifest.assets).toHaveLength(1);
  expect(asset.sourceRevision.commit).toBe('e1bbc8eec047c2fb604b71f7e4793c3e0189fd6d');
  expect(asset.original.url).toContain(`/${asset.sourceRevision.commit}/basic/cube.scad`);
  expect(read(asset.original.path).toString()).toBe('cube(10);');
  expect(asset.licence.spdx).toBe('CC0-1.0');
  expect(read(asset.licence.localEvidence[0].path).toString()).toContain('These models are all in the public domain, under the CC0 Creative Commons license.');
  expect(read(asset.licence.localEvidence[0].path).toString()).toContain('Calibration is out of scope.');
  const author = JSON.parse(read(asset.authorEvidence.path).toString());
  expect(author.authorName).toBe(asset.author);
  expect(author.status).toBe('added');
  expect(author.file).toBe('basic/cube.scad');
  expect(author.commit).toBe('b888c0a1da437803f6af7be17d584d3d27c1eaab');
  for (const file of [asset.original, ...asset.derivatives, ...asset.licence.localEvidence, asset.authorEvidence]) {
    expect(file.path).toMatch(/^(sources\/slicer-test-models|meshes\/slicer-test-models|evidence)\/[a-zA-Z0-9_.-]+$/);
    const bytes = read(file.path);
    expect(bytes.length).toBe(file.bytes);
    expect(hash(bytes)).toBe(file.sha256);
  }
});

it('checks a corner-origin 10 mm cube against independently specified dimensions and volume', async () => {
  const result = await checkModelLibrarySTL(read(asset.derivatives[0].path), {
    checkedOn: asset.quality.checkedOn, toMillimetresZUp: asset.conversion.toMillimetresZUp,
    maxTriangles: 100, maxExtentMm: 10,
  });
  expect(result.quality).toEqual(asset.quality);
  expect(result.boundsMm).toEqual({min: [0, 0, 0], max: [10, 10, 10]});
  expect(result.signedVolumeMm3).toBeCloseTo(1000, 9);
  expect(result.triangles).toBe(12);
  expect(result.diagnostics).toEqual([]);
  expect(Object.values(result.checks)).toEqual(['pass', 'pass', 'pass', 'pass']);
  expect(asset.quality.physics).toBeUndefined();
});

it('reproduces fixture bytes and manifest locally without network or writes', () => {
  expect(execFileSync(process.execPath, ['scripts/generate-fixture-library.mjs', '--check'], {
    cwd: fileURLToPath(root), encoding: 'utf8', timeout: 30_000,
  })).toContain('1 editable geometric fixture reproduced; 1 passes all STL screens.');
});
