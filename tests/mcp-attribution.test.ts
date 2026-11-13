// SPDX-License-Identifier: BSD-3-Clause
import {afterEach, expect, it} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCodeHost} from '../apps/mcp/host.mjs';
import {createCadSession, serializeDocument, hasModelAttribution} from '@brickwright/cad-core';
import type {ModelProvenanceRecord} from '@brickwright/cad-core';
import {appendPortableRevision, readPortableHistory} from '@brickwright/cad-history';
import {createGeometryKernel, exportSTL} from '@brickwright/cad-geometry';
import {assertPlainMeshExport} from '../packages/editor/src/export-policy.js';

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
function source(): ModelProvenanceRecord {
  const file = {url: 'https://example.org/part.stl', format: 'stl', sha256: 'a'.repeat(64), bytes: 684};
  return {id: 'source', selectedFile: file, modificationNotes: 'Inserted at declared scale.', asset: {
    id: 'part', version: '1', title: 'Part', author: 'Creator', sourceUrl: 'https://example.org/part',
    licence: {spdx: 'CC-BY-4.0', scope: 'asset', attribution: 'Creator, CC-BY-4.0', evidenceUrl: 'https://example.org/grant', capturedOn: '2026-11-13', review: 'accepted', reviewer: 'Curator'},
    original: file, derivatives: [], modificationNotes: 'Original.',
    conversion: {sourceUnits: 'mm', unitAssumption: 'Declared millimetres.', sourceUpAxis: 'Z', toMillimetresZUp: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]},
  }};
}
function project() {
  const session = createCadSession();
  const base = session.add({kind: 'box', size: [10, 10, 10]});
  const tool = session.add({kind: 'box', size: [2, 2, 2]});
  session.attachProvenance([tool], source());
  const root = session.combine('subtract', [base, tool]);
  const reference = session.add({kind: 'box', size: [100, 1, 1]});
  session.update(reference, {reference: true});
  return {session, root, tool, reference};
}
async function open(document: ReturnType<typeof project>['session']['state']['document']) {
  const folder = await mkdtemp(join(tmpdir(), 'cad-attribution-')), path = join(folder, 'project.bcad');
  cleanups.push(() => rm(folder, {recursive: true, force: true}));
  await writeFile(path, await appendPortableRevision(undefined, document, 'Attributed source'));
  const host = await createCodeHost({project: path});
  cleanups.push(() => host.dispose());
  return {host, path};
}

it('automatically returns exact STL and operand-source attribution together from one snapshot during a concurrent edit', async () => {
  const {session, root, tool} = project(), document = session.state.document;
  const {host, path} = await open(document), before = await readFile(path);
  for (const modificationNotes of [undefined, '', '  ', 'line\nbreak']) {
    await expect(host.call('cad_export_stl', modificationNotes === undefined ? {} : {modificationNotes})).rejects.toThrow();
  }
  expect(await readFile(path)).toEqual(before);
  const archived = await readPortableHistory(before);
  const snapshot = archived.readDocument(archived.project.headId);
  const pending = host.call('cad_export_stl', {modificationNotes: 'Subtracted the source tool; no other source changes.'});
  const info = await host.call('cad_get_model');
  const edit = host.call('cad_create_code_object', {source: 'return box(1,2,3);', expectedRevision: info.revision});
  const [result] = await Promise.all([pending, edit]);
  expect(result.format).toBe('brickwright-attributed-stl');
  expect(result.files.map((file: any) => file.name)).toEqual(['coded-project.stl', 'coded-project.stl.attribution.json']);
  const bytes = Buffer.from(result.files[0].base64, 'base64');
  const sidecar = JSON.parse(Buffer.from(result.files[1].base64, 'base64').toString('utf8'));
  const kernel = await createGeometryKernel({wasmBinary: await readFile('node_modules/manifold-3d/manifold.wasm')});
  expect(bytes).toEqual(Buffer.from(exportSTL(kernel.evaluate(snapshot).bodies)));
  expect(sidecar.output).toMatchObject({filename: result.files[0].name, bytes: bytes.length, sha256: hash(bytes), modificationNotes: 'Subtracted the source tool; no other source changes.'});
  expect(sidecar.project.sha256).toBe(hash(serializeDocument(snapshot)));
  expect(sidecar.rootIds).toEqual([root]);
  expect(sidecar.nodes.find((node: any) => node.id === tool).provenanceIds).toEqual(['source']);
  expect(sidecar.records).toEqual(document.provenance!.records);
  expect((await host.call('cad_get_model')).objects).toHaveLength(3);
}, 30000);

it('refuses editor STL/3MF policy for operand sources, permits reference-only and legacy sources, and preserves plain MCP response', async () => {
  const {session, root, tool, reference} = project();
  expect(hasModelAttribution(session.state.document)).toBe(true);
  expect(() => assertPlainMeshExport(session.state.document)).toThrow('3MF');
  session.update(root, {reference: true});
  session.update(reference, {reference: false});
  expect(hasModelAttribution(session.state.document)).toBe(false);
  expect(() => assertPlainMeshExport(session.state.document)).not.toThrow();
  const {host} = await open(session.state.document);
  const result = await host.call('cad_export_stl');
  expect(Object.keys(result).sort()).toEqual(['base64', 'mime', 'name']);
  const legacy = structuredClone(session.state.document); legacy.version = 4;
  expect(hasModelAttribution(legacy)).toBe(false);
  const malformed = structuredClone(session.state.document); malformed.nodes[tool].provenance = ['missing'];
  expect(() => assertPlainMeshExport(malformed)).toThrow();
}, 30000);
