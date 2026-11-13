// SPDX-License-Identifier: BSD-3-Clause
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {expect, it} from 'vitest';
import {codeExamples, compileCode} from '@brickwright/cad-core';

const root = new URL('../', import.meta.url);
const library = new URL('library/', root);
const read = (path: string) => readFileSync(new URL(path, library));
const manifest = JSON.parse(read('examples-manifest.json').toString());
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

it('preserves each original editable example, its grant, and derived byte identity', () => {
  expect(manifest.format).toBe('brickwright-local-example-library');
  expect(manifest.version).toBe(1);
  expect(manifest.assets).toHaveLength(34);
  expect(new Set(manifest.assets.map((asset: {id: string}) => asset.id)).size).toBe(34);
  for (const example of codeExamples) {
    const asset = manifest.assets.find((entry: {exampleId: string}) => entry.exampleId === example.id);
    expect(asset).toBeDefined();
    expect(asset.id).toBe(`brickwright-${example.id}`);
    expect(asset.original.format).toBe('cad-script');
    expect(asset.derivatives).toHaveLength(1);
    expect(asset.derivatives[0].format).toBe('stl');
    expect(asset.licence.spdx).toBe('BSD-3-Clause');
    expect(asset.licence.scope).toBe('asset');
    expect(asset.sourceRevision.commit).toMatch(/^[a-f0-9]{40}$/);
    expect(asset.sourceRevision.sourceUrl).toContain(`/${asset.sourceRevision.commit}/`);
    expect(asset.licence.evidenceUrl).toContain(`/${asset.sourceRevision.commit}/LICENSE`);
    expect(asset.conversion.sourceUnits).toBe('mm');
    expect(asset.conversion.sourceUpAxis).toBe('Z');
    expect(asset.conversion.toMillimetresZUp).toEqual(identity);
    for (const file of [asset.original, ...asset.derivatives, asset.licence.localEvidence]) {
      expect(file.path).toMatch(/^(sources\/brickwright|meshes\/brickwright|evidence)\/[a-zA-Z0-9_.-]+$/);
      expect(file.path).not.toContain('..');
      const bytes = read(file.path);
      expect(bytes.length).toBe(file.bytes);
      expect(digest(bytes)).toBe(file.sha256);
    }
    const source = read(asset.original.path).toString();
    expect(source).toBe(`${example.source}\n`);
    compileCode({version: 1, language: 'brickwright-cad-script', source, parameters: {}});
    expect(asset.quality.fileSha256).toBe(asset.derivatives[0].sha256);
    expect(asset.quality.parseable).toBe(true);
    expect(asset.quality.closedPositiveVolume).toBe(true);
    expect(asset.quality.withinSizeLimits).toBe(true);
    expect(asset.quality.withinTriangleLimits).toBe(true);
    expect(asset.quality.screeningPolicy.toMillimetresZUp).toEqual(identity);
    expect(asset.quality.physics).toBeUndefined();
    expect(asset.measurements.signedVolumeMm3).toBeGreaterThan(0);
    expect(asset.diagnostics).toEqual([]);
  }
  const archivedModule = read(manifest.reproduction.sourceModule.path);
  expect(archivedModule.equals(readFileSync(new URL('packages/core/src/code-examples.ts', root)))).toBe(true);
  expect(digest(archivedModule)).toBe(manifest.reproduction.sourceModule.sha256);
  expect(read('evidence/brickwright-examples-LICENSE.txt').equals(readFileSync(new URL('LICENSE', root)))).toBe(true);
});

it('reproduces all source, STL, provenance and quality outputs without writes or network', () => {
  const output = execFileSync(process.execPath, ['scripts/generate-example-library.mjs', '--check'], {
    cwd: fileURLToPath(root), encoding: 'utf8', timeout: 30_000,
  });
  expect(output).toContain('34 original editable examples reproduced; 34 pass all STL screens');
}, 30_000);
