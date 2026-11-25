// SPDX-License-Identifier: BSD-3-Clause
// The exact kernel comes from the kernel lab's release tarball (@crispcad/exact-kernel), pinned
// by URL and lockfile integrity. Its closure is MIT and Apache-2.0 only: no runtime dependencies,
// no font, and modeling and STEP work without one.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { beforeAll, expect, it } from 'vitest';
import { createSmlibKernel, ExactKernelError, type ExactKernel } from '@crispcad/exact-kernel';

const RELEASE = /^https:\/\/github\.com\/CrispStrobe\/crispcad-kernel-lab\/releases\/download\/exact-kernel-v[0-9.]+\/crispcad-exact-kernel-[0-9.]+\.tgz$/;
const here = new URL('..', import.meta.url);
const pkgDir = dirname(createRequire(import.meta.url).resolve('@crispcad/exact-kernel/package.json'));
const read = (file: string) => JSON.parse(readFileSync(join(pkgDir, file), 'utf8'));
let k: ExactKernel;
beforeAll(async () => { k = await createSmlibKernel(); });

it('pins the lab release tarball by URL and integrity', () => {
  // Since 2026-11-25 the product package packages/exact owns the dependency; this directory
  // uses the root install.
  const manifest = JSON.parse(readFileSync(new URL('../../packages/exact/package.json', here), 'utf8'));
  const lock = JSON.parse(readFileSync(new URL('../../package-lock.json', here), 'utf8'));
  const spec = manifest.dependencies['@crispcad/exact-kernel'];
  expect(spec).toMatch(RELEASE);
  const entry = lock.packages['node_modules/@crispcad/exact-kernel'];
  expect(entry.resolved).toBe(spec);
  expect(entry.integrity).toMatch(/^sha512-/);
  expect(entry.version).toBe(read('package.json').version);
  expect(entry.dependencies).toBeUndefined();
  expect(Object.keys(lock.packages).filter(p => /node_modules\/@classcad\//.test(p))).toEqual([]);
});

it('installs only MIT and Apache-2.0 code, with no runtime dependencies and no font', () => {
  const pkg = read('package.json');
  expect(pkg.license).toBe('MIT AND Apache-2.0');
  for (const key of ['dependencies', 'optionalDependencies', 'peerDependencies']) expect(pkg[key], key).toBeUndefined();
  const { inputs } = read('dist/bundle-inputs.json') as { inputs: { file: string; licence: string }[] };
  for (const input of inputs) expect(['MIT', 'MIT AND Apache-2.0', 'Apache-2.0 AND MIT'], input.file).toContain(input.licence);
  expect(inputs.filter(i => /_fonts|\/fonts\/|replicad|opencascade/i.test(i.file))).toEqual([]);
  expect(k.licence).toBe('MIT AND Apache-2.0');
});

it('fails Text() cleanly and still models, shells and round-trips STEP', () => {
  let error: unknown;
  try { k.profile.text('A', 10).dispose(); } catch (e) { error = e; }
  expect(error).toBeInstanceOf(ExactKernelError);
  expect((error as ExactKernelError).code).toBe('unsupported');
  k.scope(() => {
    const part = k.shell(k.fillet(k.box([40, 30, 20]), 3), 2, [0, 0, 1]), back = k.importStep(k.exportStep(part));
    expect(k.isValid(part)).toBe(true);
    expect(Math.abs(k.volume(back) - k.volume(part)) / k.volume(part)).toBeLessThan(1e-9);
    return 0;
  });
});
