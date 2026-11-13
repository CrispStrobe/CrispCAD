// SPDX-License-Identifier: BSD-3-Clause
import {createHash} from 'node:crypto';
import {describe, expect, it} from 'vitest';
import {checkModelLibrarySTL, MODEL_LIBRARY_MESH_MAX_BYTES, MODEL_LIBRARY_MESH_MAX_TRIANGLES} from '../packages/geometry/src/model-library-quality.js';

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const options = {toMillimetresZUp: identity, checkedOn: '2026-11-13'};
const points = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]];
const faces = [[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]];
const encode = (text: string) => new TextEncoder().encode(text);
function ascii(vertices = points, triangles = faces): Uint8Array {
  return encode(`solid test\n${triangles.map(face => `facet normal 0 0 0\nouter loop\n${face.map(id => `vertex ${vertices[id].join(' ')}`).join('\n')}\nendloop\nendfacet`).join('\n')}\nendsolid test`);
}
function binary(): Uint8Array {
  const bytes = new Uint8Array(84 + faces.length * 50), view = new DataView(bytes.buffer);
  bytes.set(encode('solid binary header')); view.setUint32(80, faces.length, true);
  faces.forEach((face, i) => face.flatMap(id => points[id]).forEach((value, j) => view.setFloat32(84 + i * 50 + 12 + j * 4, value, true)));
  return bytes;
}

describe('headless model library mesh screening', () => {
  it('checks ASCII and binary solids, binds evidence to exact input bytes and never creates physics evidence', async () => {
    for (const bytes of [ascii(), binary()]) {
      const result = await checkModelLibrarySTL(bytes, options);
      expect(Object.values(result.checks)).toEqual(['pass', 'pass', 'pass', 'pass']);
      expect(result.signedVolumeMm3).toBeCloseTo(1 / 6);
      expect(result.fileSha256).toBe(createHash('sha256').update(bytes).digest('hex'));
      expect(result.quality).toMatchObject({fileSha256: result.fileSha256, parseable: true, closedPositiveVolume: true});
      expect(result.quality).not.toHaveProperty('physics');
    }
  });

  it('applies explicit unit conversion before size and volume screening and preserves input', async () => {
    const bytes = binary(), before = bytes.slice(), conversion = identity.map((value, i) => [0, 5, 10].includes(i) ? 25.4 : value);
    const result = await checkModelLibrarySTL(bytes, {...options, toMillimetresZUp: conversion, maxExtentMm: 20, maxTriangles: 3});
    expect(result.checks).toEqual({parseable: 'pass', closedPositiveVolume: 'pass', withinSizeLimits: 'fail', withinTriangleLimits: 'fail'});
    expect(result.signedVolumeMm3).toBeCloseTo(25.4 ** 3 / 6);
    expect(result.boundsMm).toEqual({min: [0, 0, 0], max: [25.4, 25.4, 25.4]});
    expect(bytes).toEqual(before);
    expect(result.policy).toMatchObject({maxTriangles: 3, maxExtentMm: 20, toMillimetresZUp: conversion});
    expect(result.quality?.screeningPolicy).toEqual(result.policy);
    expect(result.quality?.screeningPolicy).not.toBe(result.policy);
  });

  it('snapshots bytes and conversion before asynchronous hashing', async () => {
    const bytes = binary(), before = bytes.slice(), conversion = [...identity];
    const pending = checkModelLibrarySTL(bytes, {...options, toMillimetresZUp: conversion});
    bytes.fill(0); conversion.fill(0);
    const result = await pending;
    expect(result.fileSha256).toBe(createHash('sha256').update(before).digest('hex'));
    expect(result.checks.closedPositiveVolume).toBe('pass');
    expect(result.policy.toMillimetresZUp).toEqual(identity);
  });

  it('rejects open, reversed, inconsistent, duplicated and degenerate facets separately from parsing', async () => {
    const cases = [faces.slice(1), faces.map(face => [...face].reverse()), [faces[0].slice().reverse(), ...faces.slice(1)], [...faces, faces[0]], [...faces, [0, 0, 1]]];
    for (const triangles of cases) {
      const result = await checkModelLibrarySTL(ascii(points, triangles), options);
      expect(result.checks.parseable).toBe('pass');
      expect(result.checks.closedPositiveVolume).toBe('fail');
      expect(result.quality?.closedPositiveVolume).toBe(false);
    }
  });

  it('rejects pinched vertex fans even when every edge is paired', async () => {
    const vertices = [...points, [-1, 0, 0], [0, -1, 0], [0, 0, -1]];
    const other = faces.map(face => face.map(id => [0, 4, 5, 6][id]).reverse());
    const result = await checkModelLibrarySTL(ascii(vertices, [...faces, ...other]), options);
    expect(result.checks.closedPositiveVolume).toBe('fail');
  });

  it('fully consumes ASCII grammar rather than accepting loose vertex matches', async () => {
    const valid = new TextDecoder().decode(ascii());
    for (const text of [valid + '\ngarbage', valid.replace('outer loop', 'ignored'), valid.replace('endfacet', ''), valid.replace('vertex 0 0 0', 'vertex NaN 0 0'), 'solid empty\nendsolid empty']) {
      const result = await checkModelLibrarySTL(encode(text), options);
      expect(result.checks).toEqual({parseable: 'fail', closedPositiveVolume: 'unchecked', withinSizeLimits: 'unchecked', withinTriangleLimits: 'unchecked'});
      expect(result.quality).toBeUndefined();
    }
  });

  it('rejects truncated binary and non-finite normals or coordinates', async () => {
    const nonfinite = binary(); new DataView(nonfinite.buffer).setFloat32(84, Infinity, true);
    for (const bytes of [binary().slice(0, -1), nonfinite]) expect((await checkModelLibrarySTL(bytes, options)).checks.parseable).toBe('fail');
  });

  it('reports unchecked parsing when a hard triangle budget prevents analysis', async () => {
    const bytes = new Uint8Array(84 + (MODEL_LIBRARY_MESH_MAX_TRIANGLES + 1) * 50);
    new DataView(bytes.buffer).setUint32(80, MODEL_LIBRARY_MESH_MAX_TRIANGLES + 1, true);
    const result = await checkModelLibrarySTL(bytes, options);
    expect(result.checks).toEqual({parseable: 'unchecked', closedPositiveVolume: 'unchecked', withinSizeLimits: 'unchecked', withinTriangleLimits: 'fail'});
    expect(result.quality).toBeUndefined();
  });

  it('requires bounded admission policy, explicit invertible conversion and a real capture date', async () => {
    for (const invalid of [{...options, checkedOn: '2026-02-30'}, {...options, maxTriangles: 0}, {...options, maxExtentMm: Infinity}, {...options, toMillimetresZUp: identity.map(() => 0)}]) {
      await expect(checkModelLibrarySTL(binary(), invalid)).rejects.toThrow();
    }
    await expect(checkModelLibrarySTL(new Uint8Array(MODEL_LIBRARY_MESH_MAX_BYTES + 1), options)).rejects.toThrow('16 MiB');
  });
});
