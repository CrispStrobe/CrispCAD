// SPDX-License-Identifier: BSD-3-Clause
import {sha256Hex} from './hash.js';
import {validateModelLibraryCatalogue} from './model-library.js';

/** A selection identifies exactly one original, editable source or derivative. */
export type ModelLibraryFileSelection = {
  assetId: string;
  file: 'original' | 'editableSource' | {derivative: number};
};
/** Cache implementations must never fetch remotely. Keys are lowercase SHA-256. */
export interface ModelLibraryFileCache {
  read(sha256: string, maxBytes: number): Promise<Uint8Array | undefined>;
  write(sha256: string, bytes: Uint8Array): Promise<void>;
  remove(sha256: string): Promise<void>;
}
export const MAX_MODEL_LIBRARY_FILE_BYTES = 64 * 1024 * 1024;
export interface ModelLibraryFetchOptions {
  cache: ModelLibraryFileCache;
  /** Explicit offline mode never invokes fetch, including on a corrupt cache hit. */
  offline?: boolean;
  fetch?: typeof globalThis.fetch;
  signal?: AbortSignal;
  maxBytes?: number;
}
export interface ModelLibraryFileResult {
  bytes: Uint8Array;
  source: 'cache' | 'network';
  /** False when browser storage is full/unavailable after a verified download. */
  cached: boolean;
}

async function readBounded(response: Response, limit: number): Promise<Uint8Array> {
  if (!response.body) throw new Error('Model library response has no readable body.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error('Model library file exceeds its declared byte size.');
      chunks.push(value);
    }
  } catch (error) {
    void reader.cancel().catch(() => { /* Keep the original read error. */ });
    throw error;
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
const safeUrl = (value: string): boolean => {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; }
  catch { return false; }
};

/** Validate metadata and retrieve only the selected file; never imports geometry. */
export async function fetchModelLibraryFile(
  catalogue: unknown, selection: ModelLibraryFileSelection, options: ModelLibraryFetchOptions,
): Promise<ModelLibraryFileResult> {
  const validation = validateModelLibraryCatalogue(catalogue);
  if (!validation.valid) throw new Error(`Invalid model library catalogue: ${validation.errors.join(' ')}`);
  const asset = validation.catalogue.assets.find(asset => asset.id === selection.assetId);
  if (!asset) throw new Error('Unknown model library asset.');
  const choice = selection.file;
  const file = choice === 'original' ? asset.original : choice === 'editableSource' ? asset.editableSource
    : choice && typeof choice === 'object' && Number.isInteger(choice.derivative) && choice.derivative >= 0
      ? asset.derivatives[choice.derivative] : undefined;
  if (!file) throw new Error('Unknown model library file selection.');
  if (!file.url) throw new Error('Local library files require an explicit host resolver; remote fetching is refused.');
  const maxBytes = options.maxBytes ?? MAX_MODEL_LIBRARY_FILE_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || file.bytes > maxBytes) throw new Error('Model library file exceeds the configured byte limit.');
  options.signal?.throwIfAborted();
  const verify = async (bytes: Uint8Array): Promise<boolean> => bytes.byteLength === file.bytes && await sha256Hex(bytes) === file.sha256;
  let cached: Uint8Array | undefined;
  try { cached = await options.cache.read(file.sha256, file.bytes); }
  catch { /* Unavailable storage is a cache miss, never permission to trust bytes. */ }
  options.signal?.throwIfAborted();
  if (cached && await verify(cached)) return {bytes: cached.slice(), source: 'cache', cached: true};
  if (cached) {
    try { await options.cache.remove(file.sha256); } catch { /* Reverify every future read. */ }
  }
  if (options.offline) throw new Error('Verified model library file is unavailable offline.');
  const fetchFile = options.fetch ?? globalThis.fetch;
  if (!fetchFile) throw new Error('Model library fetching is unavailable.');
  const response = await fetchFile(file.url, {credentials: 'omit', mode: 'cors', redirect: 'error', cache: 'no-store', signal: options.signal});
  if (!response.ok || (response.url && !safeUrl(response.url))) {
    void response.body?.cancel().catch(() => { /* Preserve download diagnostic. */ });
    throw new Error('Model library download failed or redirected to an unsafe URL.');
  }
  const bytes = await readBounded(response, file.bytes);
  options.signal?.throwIfAborted();
  if (!await verify(bytes)) throw new Error('Model library file size or SHA-256 mismatch.');
  let stored = false;
  try { await options.cache.write(file.sha256, bytes.slice()); stored = true; }
  catch { /* Verified bytes remain usable when storage quota is exhausted. */ }
  return {bytes, source: 'network', cached: stored};
}
