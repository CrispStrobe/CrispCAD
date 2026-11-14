// SPDX-License-Identifier: BSD-3-Clause
import {createHash} from 'node:crypto';
import {expect, it} from 'vitest';
import {CODE_LIMITS, compileCode} from '../packages/core/src/code.js';
import {importOpenSCADBundle, OPENSCAD_BUNDLE_LIMITS, OpenSCADBundleError} from '../packages/core/src/openscad-bundle.js';
import type {OpenSCADSourceBundle} from '../packages/core/src/openscad-bundle.js';
const sha = (source: string) => createHash('sha256').update(source).digest('hex');
const file = (path: string, source: string) => ({path, source, sha256: sha(source)});
const bundle = (root: string, files: ReturnType<typeof file>[]): OpenSCADSourceBundle => ({version: 1, rootPath: root, files});

it('imports a relative include closure and retains exact independent originals in input order', async () => {
  const original = [file('A2D.scad', 'width=3;\r\n'), file('Samples/GrillSquare.scad', 'include <../A2D.scad>\ncube(width);')];
  const result = await importOpenSCADBundle(bundle('Samples/./GrillSquare.scad', original));
  expect(compileCode(result.program).values.width.value).toBe(3);
  expect(result.provenance.rootPath).toBe('Samples/GrillSquare.scad');
  expect(result.provenance.files.map(f => ({path: f.path, source: f.source, sha256: f.sha256}))).toEqual(original);
  expect(result.provenance.originalBytes).toBe(original.reduce((sum, f) => sum + Buffer.byteLength(f.source), 0));
  expect(result.provenance.includes).toEqual([{fromPath: 'Samples/GrillSquare.scad', path: 'A2D.scad', sourceOffset: 0, line: 1, column: 1, depth: 1}]);
  expect(result.provenance.expandedSha256).toMatch(/^[a-f0-9]{64}$/);
});

it('expands every include at its textual site, preserving ordering and repeated occurrences', async () => {
  const child = file('values.scad', 'width=2;');
  const first = await importOpenSCADBundle(bundle('root.scad', [file('root.scad', 'include <values.scad> width=7; cube(width);'), child]));
  expect(compileCode(first.program).values.width.value).toBe(7);
  const repeated = await importOpenSCADBundle(bundle('root.scad', [file('root.scad', 'width=7; include <values.scad> width=8; include <values.scad> cube(width);'), child]));
  expect(compileCode(repeated.program).values.width.value).toBe(2);
  expect(repeated.provenance.includes.map(i => i.path)).toEqual(['values.scad', 'values.scad']);
  expect(repeated.provenance.includes[0].sourceOffset).toBeLessThan(repeated.provenance.includes[1].sourceOffset);
});

it('records nested occurrences in traversal order without an include-once shortcut', async () => {
  const result = await importOpenSCADBundle(bundle('root.scad', [
    file('root.scad', 'include <a.scad> include <a.scad> cube(1);'),
    file('a.scad', 'include <b.scad>'), file('b.scad', '// empty helper'),
  ]));
  expect(result.provenance.includes.map(i => i.path)).toEqual(['a.scad', 'b.scad', 'a.scad', 'b.scad']);
  expect(result.provenance.includes.map(i => i.depth)).toEqual([1, 2, 1, 2]);
});

it('does not treat comments, strings or identifier substrings as include/use directives', async () => {
  const source = '// include <missing.scad>\n/* use <also-missing.scad> */\ninclude_label=2;echo("include <no.scad> use <no.scad>");cube(include_label);';
  const result = await importOpenSCADBundle(bundle('root.scad', [file('root.scad', source)]));
  expect(result.provenance.includes).toEqual([]);
  expect(compileCode(result.program).values.include_label.value).toBe(2);
  expect(result.provenance.files[0].source).toBe(source);
});

it('accepts comment-separated directives and prevents an included EOF comment swallowing caller code', async () => {
  const result = await importOpenSCADBundle(bundle('root.scad', [file('root.scad', 'include/* separation */<helper.scad>cube(2);'), file('helper.scad', 'cube(1);// no final newline')]));
  const shape = compileCode(result.program).shape;
  expect(shape.kind).toBe('union');
  if (shape.kind === 'union') expect(shape.shapes).toHaveLength(2);
});

it('snapshots before awaiting hash verification and freezes provenance independently of editable code', async () => {
  const root = file('root.scad', 'include <lib.scad> cube(width);'), lib = file('lib.scad', 'width=2;');
  const input = {version: 1 as const, rootPath: 'root.scad', files: [root, lib]};
  const pending = importOpenSCADBundle(input);
  lib.source = 'width=99;'; lib.sha256 = sha(lib.source); input.files.pop(); input.rootPath = 'bad.scad';
  const result = await pending;
  expect(compileCode(result.program).values.width.value).toBe(2);
  expect(result.provenance.files[1].source).toBe('width=2;');
  for (const value of [result.provenance, result.provenance.files, ...result.provenance.files, result.provenance.includes, ...result.provenance.includes]) expect(Object.isFrozen(value)).toBe(true);
  result.program.parameters.width = '4';
  expect(compileCode(result.program).values.width.value).toBe(4);
});

it('verifies every declared file, even an unused dependency, before invoking the importer', async () => {
  const input = bundle('root.scad', [file('root.scad', 'use <not-supported.scad>'), {...file('unused.scad', 'cube(9);'), sha256: '0'.repeat(64)}]);
  await expect(importOpenSCADBundle(input)).rejects.toThrow('SHA-256');
});

it('normalizes paths within the logical root without changing retained original text or names', async () => {
  const result = await importOpenSCADBundle(bundle('Samples/root.scad', [file('Samples/root.scad', 'include <../lib/./base.scad> cube(1);'), file('lib/temp/../base.scad', '// retained\r\n')]));
  expect(result.provenance.includes[0].path).toBe('lib/base.scad');
  expect(result.provenance.files[1]).toMatchObject({path: 'lib/base.scad', originalPath: 'lib/temp/../base.scad', source: '// retained\r\n'});
});

it.each(['../../escape.scad', '/absolute.scad', 'https://example.com/lib.scad', 'file:///tmp/lib.scad', 'C:\\lib.scad', '..\\escape.scad', 'bad\u0000.scad'])('refuses escaped, absolute, URL or controlled include path %j', async path => {
  await expect(importOpenSCADBundle(bundle('Samples/root.scad', [file('Samples/root.scad', `include <${path}> cube(1);`)]))).rejects.toBeInstanceOf(OpenSCADBundleError);
});

it('fails closed on duplicate normalized paths, missing roots/dependencies and active include cycles', async () => {
  for (const input of [
    bundle('root.scad', [file('root.scad', 'cube(1);'), file('a/../root.scad', 'cube(2);')]),
    bundle('absent.scad', [file('root.scad', 'cube(1);')]),
    bundle('root.scad', [file('root.scad', 'include <missing.scad>')]),
    bundle('root.scad', [file('root.scad', 'include <dir/a.scad>'), file('dir/a.scad', 'include <../root.scad>')]),
  ]) await expect(importOpenSCADBundle(input)).rejects.toBeInstanceOf(OpenSCADBundleError);
});

it('keeps use unsupported and reports originating file context for an included source failure', async () => {
  await expect(importOpenSCADBundle(bundle('root.scad', [file('root.scad', 'use <lib.scad> cube(1);'), file('lib.scad', '// ignored')]))).rejects.toMatchObject({code: 'unsupported-feature', path: 'root.scad'});
  await expect(importOpenSCADBundle(bundle('root.scad', [file('root.scad', 'include <lib.scad>'), file('lib.scad', '\nnot_supported();')]))).rejects.toMatchObject({code: 'unsupported-feature', path: 'lib.scad', line: 2});
});

it('counts unused originals toward the aggregate original-byte budget', async () => {
  const input = bundle('root.scad', [file('root.scad', 'cube(1);'), file('unused.scad', ' '.repeat(CODE_LIMITS.sourceBytes))]);
  await expect(importOpenSCADBundle(input)).rejects.toMatchObject({code: 'resource-limit'});
});

it('retains the existing expanded byte cap instead of compacting or bypassing it', async () => {
  const input = bundle('root.scad', [file('root.scad', 'include <large.scad>include <large.scad>cube(1);'), file('large.scad', `/*${'x'.repeat(17000)}*/`)]);
  await expect(importOpenSCADBundle(input)).rejects.toThrow('Expanded include text');
});

it('charges repeated include tokens against the aggregate expanded token budget', async () => {
  const input = bundle('root.scad', [file('root.scad', 'include <many.scad>include <many.scad>'), file('many.scad', '0 '.repeat(4200))]);
  await expect(importOpenSCADBundle(input)).rejects.toThrow('8192-token limit');
});

it('bounds declared files, dependency depth and repeated empty expansion independently', async () => {
  const many = Array.from({length: OPENSCAD_BUNDLE_LIMITS.files + 1}, (_, i) => file(`f${i}.scad`, ''));
  await expect(importOpenSCADBundle(bundle('f0.scad', many))).rejects.toMatchObject({code: 'resource-limit'});
  const deep = Array.from({length: CODE_LIMITS.depth + 2}, (_, i) => file(`f${i}.scad`, i === CODE_LIMITS.depth + 1 ? 'cube(1);' : `include <f${i + 1}.scad>`));
  await expect(importOpenSCADBundle(bundle('f0.scad', deep))).rejects.toThrow('Include nesting');
  const repeated = Array.from({length: 15}, (_, i) => file(`f${i}.scad`, i === 14 ? ';' : `include <f${i + 1}.scad>include <f${i + 1}.scad>`));
  await expect(importOpenSCADBundle(bundle('f0.scad', repeated))).rejects.toThrow('Include occurrences');
});

it('accepts the exact single-source byte boundary and preserves a UTF-8 BOM and multibyte originals', async () => {
  const source = `/*${'x'.repeat(CODE_LIMITS.sourceBytes - 12)}*/cube(1);`;
  expect(Buffer.byteLength(source)).toBe(CODE_LIMITS.sourceBytes);
  expect((await importOpenSCADBundle(bundle('root.scad', [file('root.scad', source)]))).provenance.expandedBytes).toBe(CODE_LIMITS.sourceBytes);
  const utf8 = '\ufeff// é🙂\r\ncube(1);';
  const result = await importOpenSCADBundle(bundle('root.scad', [file('root.scad', utf8)]));
  expect(result.provenance.files[0].source).toBe(utf8);
  expect(result.provenance.originalBytes).toBe(Buffer.byteLength(utf8));
});

it('rejects malformed bundle data, unclosed lexical constructs and non-lossless UTF-8 strings', async () => {
  for (const input of [null, {}, {version: 2, rootPath: 'x', files: []}, {version: 1, rootPath: 'x', files: new Array(2)}]) await expect(importOpenSCADBundle(input as any)).rejects.toBeInstanceOf(OpenSCADBundleError);
  for (const source of ['include "not-an-angle-path"', 'include <unclosed', '/* unclosed', 'echo("unclosed);', '\ud800']) await expect(importOpenSCADBundle(bundle('root.scad', [file('root.scad', source)]))).rejects.toBeInstanceOf(OpenSCADBundleError);
});

it('rejects accessor-based bundle records without evaluating source getters', async () => {
  let touched = false;
  const original = file('root.scad', 'cube(1);');
  Object.defineProperty(original, 'source', {enumerable: true, get() {touched = true; return 'cube(99);';}});
  await expect(importOpenSCADBundle(bundle('root.scad', [original]))).rejects.toBeInstanceOf(OpenSCADBundleError);
  expect(touched).toBe(false);
});
