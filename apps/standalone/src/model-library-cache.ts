// SPDX-License-Identifier: BSD-3-Clause
import type {ModelLibraryFileCache} from '@brickwright/cad-core';

async function readBounded(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error('Invalid cache read limit.');
  if (!response.body) throw new Error('Cached model library file has no body.');
  const reader = response.body.getReader();
  const bytes = new Uint8Array(maxBytes);
  let size = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) return bytes.slice(0, size);
      if (size + value.length > maxBytes) throw new Error('Cached model library file exceeds its declared byte size.');
      bytes.set(value, size); size += value.length;
    }
  } catch (error) {
    void reader.cancel().catch(() => { /* Preserve the cache read error. */ });
    throw error;
  } finally { reader.releaseLock(); }
}

/** Persistent, separately named browser cache; unaffected by app-shell cache rotation. */
export function createModelLibraryBrowserCache(storage: CacheStorage = globalThis.caches): ModelLibraryFileCache {
  const key = (sha256: string): string => {
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('Invalid model library cache hash.');
    return `https://brickwright.invalid/model-library/sha256/${sha256}`;
  };
  const open = () => {
    if (!storage) throw new Error('Browser model library storage is unavailable.');
    return storage.open('brickwright-model-library-files-v1');
  };
  return {
    async read(hash, maxBytes) {
      const response = await (await open()).match(key(hash));
      if (!response) return undefined;
      try { return await readBounded(response, maxBytes); }
      catch (error) { await (await open()).delete(key(hash)); throw error; }
    },
    async write(hash, bytes) { await (await open()).put(key(hash), new Response(bytes.slice() as BodyInit)); },
    async remove(hash) { await (await open()).delete(key(hash)); },
  };
}
