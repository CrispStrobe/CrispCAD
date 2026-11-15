// SPDX-License-Identifier: BSD-3-Clause
// Assembly of supplied in-memory originals only; verification remains the importer’s job.
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
function data(value, names) {
  if (!plain(value) || Object.keys(value).length !== names.length) throw new Error('Expected a plain bundle record');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const name of names) if (!descriptors[name]?.enumerable || !Object.hasOwn(descriptors[name], 'value')) throw new Error('Bundle records require data properties');
}
function relativePath(value) {
  if (typeof value !== 'string' || !value || value.trim() !== value || value.startsWith('/') || /[\u0000-\u001f\u007f\\:<>]/.test(value)) throw new Error('Expected a relative virtual source path');
  const parts = value.split('/');
  if (parts.includes('..')) throw new Error('Source path escapes the package namespace');
  const normalized = parts.filter(part => part && part !== '.').join('/');
  if (!normalized) throw new Error('Expected a source file path');
  return normalized;
}
/**
 * Retain a reviewed checkout’s directory name in every virtual path. No alias
 * stripping, file loading, source rewriting or extra copy of a dependency.
 * The result must still pass importOpenSCADBundle's complete hash/byte/depth guards.
 */
export function namespaceOpenSCADBundle(input) {
  data(input, ['namespace', 'rootPath', 'files']);
  const namespace = relativePath(input.namespace);
  if (namespace.includes('/') || namespace !== input.namespace) throw new Error('Expected one exact package-directory name');
  if (!Array.isArray(input.files)) throw new Error('Expected supplied original files');
  const paths = new Set();
  const files = input.files.map(file => {
    data(file, ['path', 'source', 'sha256']);
    const path = namespace + '/' + relativePath(file.path);
    if (paths.has(path)) throw new Error('Duplicate normalized source path');
    paths.add(path);
    return {path, source: file.source, sha256: file.sha256};
  });
  const rootPath = namespace + '/' + relativePath(input.rootPath);
  if (!paths.has(rootPath)) throw new Error('Root source file is missing');
  return {version: 1, rootPath, files};
}
