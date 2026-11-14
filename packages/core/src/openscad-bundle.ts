// SPDX-License-Identifier: BSD-3-Clause
// In-memory include/use bundles only. No filesystem, URL loading or search paths.
import {CadCodeError, CODE_LIMITS} from './code.js';
import type {CodeProgram} from './code.js';
import {sha256Hex} from './hash.js';
import {importOpenSCAD} from './openscad-import.js';
import type {OpenSCADLibraryRange} from './openscad-import.js';

export interface OpenSCADBundleFile {
  readonly path: string;
  /** Exact original UTF-8 text, not preprocessed or normalized. */
  readonly source: string;
  readonly sha256: string;
}
export interface OpenSCADSourceBundle {
  readonly version: 1;
  readonly rootPath: string;
  readonly files: readonly OpenSCADBundleFile[];
}
export interface OpenSCADBundleOriginal extends OpenSCADBundleFile {
  readonly originalPath: string;
  readonly bytes: number;
}
export interface OpenSCADIncludeOccurrence {
  readonly kind?: 'use';
  /** Present only when the relative candidate was absent and a supplied root file matched. */
  readonly resolution?: 'bundle-root';
  readonly fromPath: string;
  readonly path: string;
  readonly sourceOffset: number;
  readonly line: number;
  readonly column: number;
  readonly depth: number;
}
export interface OpenSCADBundleProvenance {
  readonly format: 'brickwright-openscad-source-bundle';
  readonly version: 1;
  readonly rootPath: string;
  /** Input order, including declared but unused files; every hash was checked. */
  readonly files: readonly OpenSCADBundleOriginal[];
  /** Traversal order; repeated include/use directives remain separate occurrences. */
  readonly includes: readonly OpenSCADIncludeOccurrence[];
  readonly originalBytes: number;
  readonly expandedBytes: number;
  readonly expandedTokens: number;
  /** Identifies derived in-memory text; it is not an upstream source identity. */
  readonly expandedSha256: string;
}
export interface OpenSCADBundleImport {
  program: CodeProgram;
  provenance: OpenSCADBundleProvenance;
}
export const OPENSCAD_BUNDLE_LIMITS = Object.freeze({
  files: CODE_LIMITS.statements,
  includes: CODE_LIMITS.tokens,
  depth: CODE_LIMITS.depth,
  originalBytes: CODE_LIMITS.sourceBytes,
  expandedBytes: CODE_LIMITS.sourceBytes,
  expandedTokens: CODE_LIMITS.tokens,
});
export class OpenSCADBundleError extends CadCodeError {
  constructor(detail: string, readonly path: string, offset: number, source: string, code = 'invalid-source') {
    super(`${path}: ${detail}`, offset, source, code);
    this.name = 'OpenSCADBundleError';
  }
}
interface Snapshot {
  original: OpenSCADBundleOriginal;
  encoded: Uint8Array;
  lines: number[];
}
interface Segment {start: number; end: number; path: string; sourceStart: number}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const keys = (value: Record<string, unknown>, expected: string[]) => Object.keys(value).length === expected.length && expected.every(key => {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return !!descriptor?.enumerable && Object.hasOwn(descriptor, 'value');
});
const encoder = new TextEncoder();
function fail(detail: string, path = '(bundle)', offset = 0, source = '', code = 'invalid-source'): never {throw new OpenSCADBundleError(detail, path, offset, source, code);}

function normalizePath(value: unknown, base: string[], contextPath = '(bundle)', offset = 0, source = ''): string {
  if (typeof value !== 'string' || !value || value.length > CODE_LIMITS.sourceBytes || value.trim() !== value || /[\u0000-\u001f\u007f\\:<>]/.test(value) || value.startsWith('/')) fail('Expected a relative bundle path, without control characters, URLs or absolute paths', contextPath, offset, source);
  const parts = [...base];
  for (const part of value.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!parts.length) fail('Path escapes the source bundle root', contextPath, offset, source);
      parts.pop();
    } else parts.push(part);
  }
  if (!parts.length) fail('Expected a file path inside the source bundle', contextPath, offset, source);
  return parts.join('/');
}
function snapshotBundle(value: OpenSCADSourceBundle): {rootPath: string; files: Snapshot[]; originalBytes: number} {
  if (!object(value) || !keys(value, ['version', 'rootPath', 'files']) || value.version !== 1 || !Array.isArray(value.files)) fail('Unsupported source bundle schema');
  if (!value.files.length || value.files.length > OPENSCAD_BUNDLE_LIMITS.files) fail(`Source bundle must contain 1–${OPENSCAD_BUNDLE_LIMITS.files} files`, '(bundle)', 0, '', 'resource-limit');
  const rootPath = normalizePath(value.rootPath, []);
  const paths = new Set<string>();
  let originalBytes = 0;
  const files = Array.from(value.files).map((file: unknown): Snapshot => {
    if (!object(file) || !keys(file, ['path', 'source', 'sha256']) || typeof file.source !== 'string' || typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256)) fail('Each file needs an original source, relative path and exact SHA-256');
    const path = normalizePath(file.path, []);
    if (paths.has(path)) fail('Duplicate normalized source path', path);
    paths.add(path);
    if (file.source.length > OPENSCAD_BUNDLE_LIMITS.originalBytes) fail('Aggregate original source exceeds 32 KiB', path, 0, '', 'resource-limit');
    const encoded = encoder.encode(file.source);
    originalBytes += encoded.length;
    if (originalBytes > OPENSCAD_BUNDLE_LIMITS.originalBytes) fail('Aggregate original source exceeds 32 KiB', path, 0, '', 'resource-limit');
    if (new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(encoded) !== file.source) fail('Original source must be lossless UTF-8 text', path);
    const lines = [0];
    for (let at = 0; at < file.source.length; at++) if (file.source[at] === '\n') lines.push(at + 1);
    return {original: Object.freeze({path, originalPath: file.path as string, source: file.source, sha256: file.sha256, bytes: encoded.length}), encoded, lines};
  });
  if (!paths.has(rootPath)) fail('Root source file is missing', rootPath);
  return {rootPath, files, originalBytes};
}
function location(lines: number[], at: number): {line: number; column: number} {
  let low = 0, high = lines.length;
  while (low + 1 < high) {const middle = (low + high) >>> 1; if (lines[middle] <= at) low = middle; else high = middle;}
  return {line: low + 1, column: at - lines[low] + 1};
}

/**
 * Verify and snapshot every declared original before expanding textual includes.
 * No ambient file access exists. `use` retains isolated lexical library scopes. Includes are
 * relative to their containing file and expand at every occurrence, not once.
 * Provenance retains original bytes as lossless text; expanded text is derived.
 */
export async function importOpenSCADBundle(bundle: OpenSCADSourceBundle): Promise<OpenSCADBundleImport> {
  // This snapshot completes before the first await: caller mutations cannot race hashing.
  const snapshot = snapshotBundle(bundle);
  await Promise.all(snapshot.files.map(async file => {
    if (await sha256Hex(file.encoded) !== file.original.sha256) fail('Source SHA-256 does not match the declared original', file.original.path);
  }));
  const files = new Map(snapshot.files.map(file => [file.original.path, file]));
  const chunks: string[] = [], segments: Segment[] = [], includes: OpenSCADIncludeOccurrence[] = [];
  const active = new Set<string>();
  const libraries: OpenSCADLibraryRange[] = [];
  let expandedBytes = 0, expandedLength = 0, expandedTokens = 0;
  const append = (text: string, path: string, sourceStart: number) => {
    if (!text) return;
    expandedBytes += encoder.encode(text).length;
    if (expandedBytes > OPENSCAD_BUNDLE_LIMITS.expandedBytes) fail('Expanded include text exceeds the existing 32 KiB source limit', path, sourceStart, files.get(path)!.original.source, 'resource-limit');
    segments.push({start: expandedLength, end: expandedLength + text.length, path, sourceStart});
    expandedLength += text.length;
    chunks.push(text);
  };
  const expand = (path: string, depth: number, fileScope = true) => {
    if (depth > OPENSCAD_BUNDLE_LIMITS.depth) fail('Include nesting exceeds the existing depth limit', path, 0, files.get(path)?.original.source ?? '', 'resource-limit');
    if (active.has(path)) fail('Cyclic include dependency', path, 0, files.get(path)!.original.source);
    const file = files.get(path)!;
    const source = file.original.source;
    active.add(path);
    let at = 0, chunkStart = 0, nesting = 0, statementBoundary = true;
    const trivia = (start: number): number => {
      let cursor = start;
      while (cursor < source.length) {
        if (/\s/.test(source[cursor])) {cursor++; continue;}
        if (source.startsWith('//', cursor)) {const end = source.indexOf('\n', cursor); cursor = end < 0 ? source.length : end + 1; continue;}
        if (source.startsWith('/*', cursor)) {const end = source.indexOf('*/', cursor + 2); if (end < 0) fail('Unclosed source comment', path, cursor, source); cursor = end + 2; continue;}
        break;
      }
      return cursor;
    };
    while (at < source.length) {
      const next = trivia(at);
      if (next !== at) {at = next; continue;}
      if (at >= source.length) break;
      const start = at;
      let token: string;
      if (source[at] === '"') {
        at++;
        let closed = false;
        while (at < source.length) {const ch = source[at++]; if (ch === '\\') {at++; continue;} if (ch === '"') {closed = true; break;}}
        if (!closed) fail('Unclosed source string', path, start, source);
        token = source.slice(start, at);
      } else {
        token = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|^[A-Za-z_$][A-Za-z0-9_$]*|^(?:==|!=|<=|>=|&&|\|\|)|^[\s\S]/.exec(source.slice(at))![0];
        at += token.length;
      }
      if (token === 'use' && (!fileScope || nesting !== 0 || !statementBoundary)) fail('OpenSCAD use requires file scope', path, start, source, 'unsupported-feature');
      if (token === 'include' || token === 'use') {
        const open = trivia(at);
        if (source[open] !== '<') fail('Expected a literal include <relative/path> directive', path, start, source);
        const close = source.indexOf('>', open + 1);
        if (close < 0) fail('Unclosed include path', path, start, source);
        const raw = source.slice(open + 1, close);
        let target = normalizePath(raw, path.split('/').slice(0, -1), path, start, source);
        let resolution: 'bundle-root' | undefined;
        // A deterministic second candidate within the verified virtual files only.
        // Parent traversal remains relative-only; no ambient library search or aliases.
        if (!files.has(target) && !raw.split('/').includes('..')) {
          const candidate = normalizePath(raw, [], path, start, source);
          if (files.has(candidate)) {target = candidate; resolution = 'bundle-root';}
        }
        if (!files.has(target)) fail(`Included source file is missing: ${target}`, path, start, source);
        if (includes.length >= OPENSCAD_BUNDLE_LIMITS.includes) fail('Include occurrences exceed the existing token budget', path, start, source, 'resource-limit');
        includes.push(Object.freeze({...(resolution ? {resolution} : {}), ...(token === 'use' ? {kind: 'use' as const} : {}), fromPath: path, path: target, sourceOffset: start, ...location(file.lines, start), depth: depth + 1}));
        append(source.slice(chunkStart, start), path, chunkStart);
        // Boundaries prevent an included EOF comment or adjacent identifier from swallowing caller code.
        append('\n', path, start);
        const range: OpenSCADLibraryRange = {start: expandedLength, end: expandedLength};
        if (token === 'use') libraries.push(range);
        expand(target, depth + 1, fileScope && nesting === 0 && statementBoundary);
        range.end = expandedLength;
        append('\n', path, start);
        at = close + 1;
        chunkStart = at;
      } else {
        if (['{', '(', '['].includes(token)) nesting++;
        if (['}', ')', ']'].includes(token)) nesting--;
        statementBoundary = nesting === 0 && (token === ';' || token === '}');
        expandedTokens++;
        if (expandedTokens > OPENSCAD_BUNDLE_LIMITS.expandedTokens) fail('Expanded include tokens exceed the existing 8192-token limit', path, start, source, 'resource-limit');
      }
    }
    append(source.slice(chunkStart), path, chunkStart);
    active.delete(path);
  };
  expand(snapshot.rootPath, 0);
  const expanded = chunks.join('');
  const expandedSha256 = await sha256Hex(encoder.encode(expanded));
  let program: CodeProgram;
  try {program = importOpenSCAD(expanded, libraries);}
  catch (error) {
    if (!(error instanceof CadCodeError)) throw error;
    const segment = segments.find(item => error.offset >= item.start && error.offset < item.end) ?? segments.at(-1);
    const path = segment?.path ?? snapshot.rootPath;
    const source = files.get(path)!.original.source;
    const offset = segment ? Math.min(source.length, segment.sourceStart + Math.max(0, error.offset - segment.start)) : source.length;
    throw new OpenSCADBundleError(error.detail, path, offset, source, error.code);
  }
  return {program, provenance: Object.freeze({
    format: 'brickwright-openscad-source-bundle', version: 1, rootPath: snapshot.rootPath,
    files: Object.freeze(snapshot.files.map(file => file.original)), includes: Object.freeze(includes),
    originalBytes: snapshot.originalBytes, expandedBytes, expandedTokens, expandedSha256,
  })};
}
