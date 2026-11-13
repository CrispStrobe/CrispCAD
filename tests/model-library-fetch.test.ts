// SPDX-License-Identifier: BSD-3-Clause
import {describe, expect, it, vi} from 'vitest';
import {fetchModelLibraryFile} from '../packages/core/src/model-library-fetch.js';
import type {ModelLibraryFileCache} from '../packages/core/src/model-library-fetch.js';
import {createModelLibraryBrowserCache} from '../apps/standalone/src/model-library-cache.js';
import {sha256Hex} from '../packages/core/src/hash.js';

const data = new TextEncoder().encode('original CAD content');
async function fixture() {
  const hash = await sha256Hex(data);
  const file = {url: 'https://example.org/original.cad', format: 'cad-script', bytes: data.length, sha256: hash};
  const catalogue = {format: 'brickwright-model-library', version: 1, assets: [{
    id: 'block', version: '1', title: 'Block', author: 'Creator', sourceUrl: 'https://example.org/block',
    licence: {spdx: 'BSD-3-Clause', scope: 'asset', attribution: 'Creator BSD-3-Clause', evidenceUrl: 'https://example.org/grant', capturedOn: '2026-11-13', review: 'accepted', reviewer: 'Curator'},
    original: file, editableSource: {...file, url: 'https://example.org/source.cad'}, derivatives: [{...file, url: 'https://example.org/mesh.stl', format: 'stl'}],
    modificationNotes: 'Unchanged.', conversion: {sourceUnits: 'mm', unitAssumption: 'Declared mm.', sourceUpAxis: 'Z', toMillimetresZUp: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]},
  }]};
  const entries = new Map<string, Uint8Array>();
  const cache: ModelLibraryFileCache = {
    read: vi.fn(async key => entries.get(key)?.slice()),
    write: vi.fn(async (key, bytes) => { entries.set(key, bytes.slice()); }),
    remove: vi.fn(async key => { entries.delete(key); }),
  };
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(data.slice()));
  return {catalogue, hash, entries, cache, fetch};
}
const original = {assetId: 'block', file: 'original'} as const;
describe('selected model library downloads', () => {
  it.each(['original', 'editableSource', {derivative: 0}] as const)('downloads only the selected file %j and reuses verified bytes offline', async file => {
    const f = await fixture();
    const result = await fetchModelLibraryFile(f.catalogue, {assetId: 'block', file}, f);
    expect(result).toEqual({bytes: data, source: 'network', cached: true});
    const expected = typeof file === 'object' ? 'mesh.stl' : file === 'original' ? 'original.cad' : 'source.cad';
    expect(f.fetch).toHaveBeenCalledExactlyOnceWith(`https://example.org/${expected}`, expect.objectContaining({credentials: 'omit', redirect: 'error', cache: 'no-store'}));
    result.bytes.fill(0);
    const offline = await fetchModelLibraryFile(f.catalogue, original, {...f, offline: true});
    expect(offline).toEqual({bytes: data, source: 'cache', cached: true});
    expect(f.fetch).toHaveBeenCalledTimes(1);
  });
  it('does no IO for rejected metadata, unknown selections or oversized declared files', async () => {
    const f = await fixture();
    for (const [catalogue, selection, maxBytes] of [
      [{...f.catalogue, version: 2}, original, 100],
      [f.catalogue, {assetId: 'missing', file: 'original'}, 100],
      [f.catalogue, {assetId: 'block', file: {derivative: 9}}, 100],
      [f.catalogue, original, 1],
    ] as const) await expect(fetchModelLibraryFile(catalogue, selection, {...f, maxBytes})).rejects.toThrow();
    expect(f.fetch).not.toHaveBeenCalled(); expect(f.cache.read).not.toHaveBeenCalled();
  });
  it('never fetches offline, removes corrupt bytes and refuses same-size tampering', async () => {
    const f = await fixture();
    await expect(fetchModelLibraryFile(f.catalogue, original, {...f, offline: true})).rejects.toThrow('offline');
    f.entries.set(f.hash, new Uint8Array(data.length));
    await expect(fetchModelLibraryFile(f.catalogue, original, {...f, offline: true})).rejects.toThrow('offline');
    expect(f.entries.has(f.hash)).toBe(false); expect(f.fetch).not.toHaveBeenCalled();
    f.entries.set(f.hash, new Uint8Array([1]));
    expect((await fetchModelLibraryFile(f.catalogue, original, f)).source).toBe('network');
  });
  it.each(['hash', 'short', 'http', 'network'])('does not cache a failed %s download', async failure => {
    const f = await fixture();
    f.fetch.mockImplementation(async () => {
      if (failure === 'network') throw new Error('offline');
      return new Response(failure === 'short' ? data.slice(1) : new Uint8Array(data.length), {status: failure === 'http' ? 403 : 200});
    });
    await expect(fetchModelLibraryFile(f.catalogue, original, f)).rejects.toThrow();
    expect(f.cache.write).not.toHaveBeenCalled();
  });
  it('bounds streamed bytes and cancels before an unbounded response finishes, ignoring content-length', async () => {
    const f = await fixture();
    const cancel = vi.fn();
    f.fetch.mockResolvedValue(new Response(new ReadableStream({start(controller) {controller.enqueue(new Uint8Array(data.length + 1));}, cancel}), {headers: {'content-length': '1'}}));
    await expect(fetchModelLibraryFile(f.catalogue, original, f)).rejects.toThrow('byte size');
    expect(cancel).toHaveBeenCalled(); expect(f.cache.write).not.toHaveBeenCalled();
  });
  it('keeps verified bytes usable when storage fails and respects cancellation', async () => {
    const f = await fixture();
    vi.mocked(f.cache.read).mockRejectedValue(new Error('Unavailable'));
    vi.mocked(f.cache.write).mockRejectedValue(new Error('Quota'));
    expect(await fetchModelLibraryFile(f.catalogue, original, f)).toEqual({bytes: data, source: 'network', cached: false});
    const controller = new AbortController(); controller.abort(); f.fetch.mockClear();
    await expect(fetchModelLibraryFile(f.catalogue, original, {...f, signal: controller.signal})).rejects.toThrow();
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it('persists browser cache across adapters and removes corrupt oversized responses', async () => {
    const f = await fixture();
    const entries = new Map<string, Response>();
    const browserCache = {
      match: vi.fn(async (key: string) => entries.get(key)?.clone()),
      put: vi.fn(async (key: string, value: Response) => {entries.set(key, value.clone());}),
      delete: vi.fn(async (key: string) => entries.delete(key)),
    };
    const storage = {open: vi.fn(async () => browserCache)} as unknown as CacheStorage;
    await fetchModelLibraryFile(f.catalogue, original, {...f, cache: createModelLibraryBrowserCache(storage)});
    expect(storage.open).toHaveBeenCalledWith('brickwright-model-library-files-v1');
    expect((await fetchModelLibraryFile(f.catalogue, original, {...f, cache: createModelLibraryBrowserCache(storage), offline: true})).bytes).toEqual(data);
    const key = [...entries.keys()][0]; entries.set(key, new Response(new Uint8Array(data.length + 1)));
    await expect(fetchModelLibraryFile(f.catalogue, original, {...f, cache: createModelLibraryBrowserCache(storage), offline: true})).rejects.toThrow('offline');
    expect(entries.size).toBe(0); expect(f.fetch).toHaveBeenCalledTimes(1);
  });
});
