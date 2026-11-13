// SPDX-License-Identifier: BSD-3-Clause
import {afterEach, describe, expect, it} from 'vitest';
import {mkdtemp, readFile, writeFile, rm, readdir, symlink, truncate} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {createLocalModelLibraryCatalogue, parseModelLibraryCatalogue} from '@brickwright/cad-core';
// Host CLI intentionally stays outside the browser/SDK dependency graph.
// @ts-expect-error Node host script has no TypeScript declaration.
import {parseArguments, qualifyLocalSTL, runBoundedWorker, writeNewCatalogue} from '../scripts/qualify-library-stl.mjs';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, {recursive: true, force: true}))); });
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'brickwright-curation-')); dirs.push(dir);
  const manifest = JSON.parse(await readFile('library/fixtures-manifest.json', 'utf8'));
  const catalogue = createLocalModelLibraryCatalogue(manifest);
  const cataloguePath = join(dir, 'input.json'), stlPath = join(dir, 'cached.stl'), outputPath = join(dir, 'qualified.json');
  const original = `${JSON.stringify(catalogue)}\n`;
  const bytes = await readFile('library/meshes/slicer-test-models/cube.stl');
  await writeFile(cataloguePath, original); await writeFile(stlPath, bytes);
  const options = {cataloguePath, stlPath, outputPath, selection: {assetId: catalogue.assets[0].id, file: {derivative: 0}}, checkedOn: '2026-11-13', timeoutMs: 30000};
  return {dir, original, bytes, catalogue, options};
}
const worker = (source: string) => new URL(`data:text/javascript,${encodeURIComponent(source)}`);
describe('bounded offline STL curation host', () => {
  it('runs fresh native qualification, atomically saves a new catalogue and preserves inputs', async () => {
    const f = await fixture();
    const result = await qualifyLocalSTL(f.options);
    const saved = parseModelLibraryCatalogue(await readFile(f.options.outputPath, 'utf8'));
    expect(saved.valid).toBe(true);
    if (!saved.valid) throw new Error('Invalid saved catalogue');
    expect(saved.catalogue).toEqual(result);
    const report = result.assets[0].quality.collisionReport;
    expect(report.selectedFile).toEqual(f.catalogue.assets[0].derivatives[0]);
    expect(report.evidence).toMatchObject({scope: 'rigid-collision-preview', nativeCheck: {build: 'debug', ground: false, steps: 1}, certificate: {maxHulls: 2048, tolerance: {volumeFraction: 0.02, boundsMm: 0.2}}});
    expect(report.quality.policy).toEqual(f.catalogue.assets[0].quality!.screeningPolicy);
    expect(await readFile(f.options.cataloguePath, 'utf8')).toBe(f.original);
    expect(await readFile(f.options.stlPath)).toEqual(f.bytes);
    expect((await readdir(f.dir)).sort()).toEqual(['cached.stl', 'input.json', 'qualified.json']);
  }, 30000);

  it('refuses altered bytes, oversized catalogue and an unselected file without output', async () => {
    const f = await fixture();
    await writeFile(f.options.stlPath, Buffer.alloc(f.bytes.length));
    await expect(qualifyLocalSTL(f.options)).rejects.toThrow('SHA-256');
    await writeFile(f.options.stlPath, f.bytes);
    await expect(qualifyLocalSTL({...f.options, selection: {assetId: 'absent', file: 'original'}})).rejects.toThrow('Select one');
    await truncate(f.options.cataloguePath, 4 * 1024 * 1024 + 1);
    await expect(qualifyLocalSTL(f.options)).rejects.toThrow('at most');
    expect((await readdir(f.dir)).sort()).toEqual(['cached.stl', 'input.json']);
  });

  it('requires retained screening policy and refuses failing curated checks without saving', async () => {
    const f = await fixture();
    const failing = structuredClone(f.catalogue);
    failing.assets[0].quality!.closedPositiveVolume = false;
    await writeFile(f.options.cataloguePath, JSON.stringify(failing));
    await expect(qualifyLocalSTL(f.options)).rejects.toThrow('passing curated quality');
    delete f.catalogue.assets[0].quality!.screeningPolicy;
    await writeFile(f.options.cataloguePath, JSON.stringify(f.catalogue));
    await expect(qualifyLocalSTL(f.options)).rejects.toThrow('retained screening policy');
    await expect(readFile(f.options.outputPath)).rejects.toThrow();
    expect(await readFile(f.options.stlPath)).toEqual(f.bytes);
  });

  it('refuses overwrites, aliases and symlink inputs, and preserves an output publication race', async () => {
    const f = await fixture();
    await expect(qualifyLocalSTL({...f.options, outputPath: f.options.cataloguePath})).rejects.toThrow('separate');
    await symlink(f.options.cataloguePath, f.options.outputPath);
    await expect(qualifyLocalSTL(f.options)).rejects.toThrow('already exists');
    await rm(f.options.outputPath);
    const alias = join(f.dir, 'alias.stl'); await symlink(f.options.stlPath, alias);
    await expect(qualifyLocalSTL({...f.options, stlPath: alias})).rejects.toThrow();
    await writeFile(f.options.outputPath, 'keep this');
    await expect(writeNewCatalogue(f.options.outputPath, Buffer.from('replacement'))).rejects.toThrow();
    expect(await readFile(f.options.outputPath, 'utf8')).toBe('keep this');
    expect((await readdir(f.dir)).some(name => name.endsWith('.tmp'))).toBe(false);
    await rm(f.options.outputPath);
    const first = Buffer.alloc(10000, 'a'), second = Buffer.alloc(10000, 'b');
    const races = await Promise.allSettled([writeNewCatalogue(f.options.outputPath, first), writeNewCatalogue(f.options.outputPath, second)]);
    expect(races.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const published = await readFile(f.options.outputPath);
    expect(published.equals(first) || published.equals(second)).toBe(true);
    expect((await readdir(f.dir)).some(name => name.endsWith('.tmp'))).toBe(false);
  });

  it('discards workers on timeout, cancellation, native-style error or premature exit', async () => {
    const spin = worker('while (true) {}');
    await expect(runBoundedWorker(spin, {}, {timeoutMs: 20})).rejects.toThrow('timed out');
    const controller = new AbortController();
    const pending = runBoundedWorker(spin, {}, {timeoutMs: 10000, signal: controller.signal});
    controller.abort();
    await expect(pending).rejects.toThrow('cancelled');
    await expect(runBoundedWorker(worker('throw new Error("native failure")'), {}, {timeoutMs: 1000})).rejects.toThrow('native failure');
    await expect(runBoundedWorker(worker('process.exit(9)'), {}, {timeoutMs: 1000})).rejects.toThrow('without a result');
    const f = await fixture();
    await expect(qualifyLocalSTL(f.options, {signal: controller.signal})).rejects.toThrow();
    await expect(readFile(f.options.outputPath)).rejects.toThrow();
    await expect(qualifyLocalSTL({...f.options, timeoutMs: 1})).rejects.toThrow('timed out');
    await expect(readFile(f.options.outputPath)).rejects.toThrow();
    expect(await readFile(f.options.cataloguePath, 'utf8')).toBe(f.original);
    expect(await readFile(f.options.stlPath)).toEqual(f.bytes);
  });

  it('requires explicit selections, dates, bounded timeouts and distinct output paths', () => {
    const args = ['--catalogue', 'in.json', '--stl', 'cache.stl', '--asset', 'cube', '--file', 'derivative:0', '--checked-on', '2026-11-13', '--output', 'out.json'];
    expect(parseArguments(args)).toMatchObject({cataloguePath: resolve('in.json'), selection: {assetId: 'cube', file: {derivative: 0}}, timeoutMs: 30000});
    expect(() => parseArguments([])).toThrow();
    expect(() => parseArguments([...args, '--timeout-ms', '120001'])).toThrow('timeout-ms');
    expect(() => parseArguments([...args, '--output', 'other.json'])).toThrow();
    expect(() => parseArguments(args.map(value => value === '2026-11-13' ? '2026-02-30' : value))).toThrow('date');
    expect(() => parseArguments(args.map(value => value === 'derivative:0' ? 'editableSource' : value))).toThrow();
  });
});
