// SPDX-License-Identifier: BSD-3-Clause
import {createHash} from 'node:crypto';
import {isModelLibraryLocalPath} from '../../packages/core/dist/index.js';

// Read the exact locations declared by the reviewed asset, including versioned
// archive directories. No ambient part-library or filesystem fallback.
export async function readSelectedLDrawFiles(entry, readLocalFile) {
  if (!Array.isArray(entry.files) || !entry.files.length || entry.files.length > 32 || entry.files.some(f => !Number.isSafeInteger(f.bytes) || f.bytes < 1) || entry.files.reduce((n, f) => n + f.bytes, 0) > 32768) throw Error('LDraw source budget exceeds32files/32768bytes.');
  const bundle = entry.asset.sourceBundle;
  if (bundle !== undefined && (bundle?.rootPath !== entry.rootPath || !Array.isArray(bundle.dependencies) || !bundle.dependencies.length)) throw Error('LDraw root binding mismatch.');
  // A source with no dependencies uses its original-file identity directly.
  // A declared bundle must still contain actual dependencies.
  const dependencies = bundle === undefined ? [] : bundle.dependencies;
  const declared = [[entry.rootPath, entry.asset.original], ...dependencies.map(d => [d.path, d.file])];
  const locations = new Map();
  for (const [path, file] of declared) {
    if (locations.has(path)) throw Error('Duplicate LDraw source binding: ' + path);
    if (!file.path?.startsWith('sources/') || !isModelLibraryLocalPath(file.path) || file.format !== 'ldraw') throw Error('Invalid local LDraw source path.');
    locations.set(path, file);
  }
  if (locations.size !== entry.files.length || new Set(entry.files.map(f => f.path)).size !== entry.files.length) throw Error('LDraw closure binding mismatch.');
  for (const file of entry.files) {
    const location = locations.get(file.path);
    if (!location || location.bytes !== file.bytes || location.sha256 !== file.sha256) throw Error('LDraw source identity declaration mismatch: ' + file.path);
  }
  return Promise.all(entry.files.map(async file => {
    const bytes = await readLocalFile(locations.get(file.path).path);
    if (bytes.length !== file.bytes || createHash('sha256').update(bytes).digest('hex') !== file.sha256 || !bytes.toString('utf8').includes('0 !LICENSE Licensed under CC BY 4.0 : see CAreadme.txt')) throw Error('Source/grant identity mismatch: ' + file.path);
    return {path: file.path, bytes};
  }));
}
