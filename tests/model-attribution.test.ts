// SPDX-License-Identifier: BSD-3-Clause
import {createHash} from 'node:crypto';
import {describe, expect, it} from 'vitest';
import {createDocument, identityTransform, serializeDocument} from '../packages/core/src/document.js';
import type {CadDocument} from '../packages/core/src/document.js';
import {createCadSession} from '../packages/core/src/session.js';
import {createModelAttributionSidecar} from '../packages/core/src/model-attribution.js';
import type {ModelAttributionExport} from '../packages/core/src/model-attribution.js';
import type {ModelProvenanceRecord} from '../packages/core/src/model-provenance.js';

function record(id: string): ModelProvenanceRecord {
  const selectedFile = {url: `https://example.org/${id}.stl`, format: 'stl', sha256: 'a'.repeat(64), bytes: 684};
  return {id, selectedFile, modificationNotes: 'Inserted unchanged.', asset: {
    id, version: '1', title: id, author: 'Example creator', sourceUrl: `https://example.org/${id}`,
    licence: {spdx: 'CC-BY-4.0', scope: 'asset', attribution: 'Example creator, CC-BY-4.0', evidenceUrl: 'https://example.org/grant', capturedOn: '2026-11-13', review: 'accepted', reviewer: 'Curator'},
    original: selectedFile, derivatives: [], modificationNotes: 'Unchanged original.',
    conversion: {sourceUnits: 'mm', unitAssumption: 'Declared millimetres.', sourceUpAxis: 'Z', toMillimetresZUp: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]},
  }};
}
function project(): CadDocument {
  const document = createDocument('Attributed project'); document.version = 5;
  document.provenance = {version: 1, records: [record('source-a'), record('source-b')]};
  document.nodes = {
    a: {id: 'a', name: 'Source A', color: '#abcdef', transform: identityTransform(), kind: 'box', size: [10, 10, 10], provenance: ['source-a']},
    b: {id: 'b', name: 'Source B', color: '#abcdef', transform: identityTransform(), kind: 'box', size: [2, 2, 2], provenance: ['source-b']},
    cut: {id: 'cut', name: 'Cut', color: '#abcdef', transform: identityTransform(), kind: 'boolean', operation: 'subtract', inputs: ['a', 'b']},
    ruler: {id: 'ruler', name: 'Reference', color: '#abcdef', transform: identityTransform(), kind: 'box', size: [100, 1, 1], reference: true},
  };
  document.roots = ['cut', 'ruler']; return document;
}
const output = (): ModelAttributionExport => ({filename: 'part.stl', format: 'stl', bytes: new Uint8Array([1, 2, 3]), modificationNotes: 'Subtracted the source B shape from source A; exported in millimetres.'});
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

describe('recorded library attribution sidecars', () => {
  it('retains operand sources, rights, evidence and changes, binding exact caller bytes and project snapshot', async () => {
    const document = project(), before = serializeDocument(document), artifact = output();
    const sidecar = await createModelAttributionSidecar(document, artifact);
    expect(sidecar).toMatchObject({format: 'brickwright-model-attribution', version: 1, scope: 'recorded-library-provenance', geometryBinding: 'caller-supplied-export', rootIds: ['cut']});
    expect(sidecar.nodes).toEqual([{id: 'cut', provenanceIds: []}, {id: 'a', provenanceIds: ['source-a']}, {id: 'b', provenanceIds: ['source-b']}]);
    expect(sidecar.records).toEqual(document.provenance!.records);
    expect(sidecar.output.sha256).toBe(hash(artifact.bytes));
    expect(sidecar.project.sha256).toBe(hash(before));
    expect(JSON.parse(JSON.stringify(sidecar))).toEqual(sidecar);
    expect(serializeDocument(document)).toBe(before);
    sidecar.records[0].asset.licence.attribution = 'Changed';
    expect(document.provenance!.records[0].asset.licence.attribution).toBe('Example creator, CC-BY-4.0');
  });
  it('includes library attribution beneath a retained mirror', async () => {
    const session=createCadSession(project());
    const id=session.mirrorBody('cut',{plane:'YZ',offset:10});
    const sidecar=await createModelAttributionSidecar(session.state.document,{...output(),rootIds:[id]});
    expect(sidecar.records.map(record=>record.id)).toEqual(['source-a','source-b']);
    expect(sidecar.nodes.map(node=>node.id)).toEqual([id,'cut','a','b']);
  });
  it('includes only source records reachable from selected printable roots', async () => {
    const document = project(); document.roots = ['a', 'b', 'ruler']; delete document.nodes.cut;
    const sidecar = await createModelAttributionSidecar(document, {...output(), rootIds: ['a']});
    expect(sidecar.records.map(record => record.id)).toEqual(['source-a']);
    expect(sidecar.nodes.map(node => node.id)).toEqual(['a']);
    expect(sidecar.rootIds).toEqual(['a']);
  });
  it('captures metadata and bytes before asynchronous hashing', async () => {
    const document = project(), artifact = output(), expected = hash(artifact.bytes);
    const pending = createModelAttributionSidecar(document, artifact);
    artifact.bytes.fill(9); artifact.filename = 'changed.stl'; artifact.modificationNotes = 'Changed';
    document.provenance!.records[0].asset.author = 'Changed';
    const sidecar = await pending;
    expect(sidecar.output.sha256).toBe(expected); expect(sidecar.output.filename).toBe('part.stl');
    expect(sidecar.records[0].asset.author).toBe('Example creator');
  });
  it('refuses missing or incomplete metadata without implying plain STL provenance', async () => {
    const document = project(); delete document.provenance; Object.values(document.nodes).forEach(node => delete node.provenance);
    await expect(createModelAttributionSidecar(document, output())).rejects.toThrow('recorded library provenance');
    const broken = project(); broken.provenance!.records[0].asset.licence.attribution = '';
    await expect(createModelAttributionSidecar(broken, output())).rejects.toThrow();
    const dangling = project(); dangling.nodes.a.provenance = ['missing'];
    await expect(createModelAttributionSidecar(dangling, output())).rejects.toThrow();
  });
  it('refuses ambiguous export selection, unsafe filenames and absent modification notes', async () => {
    for (const patch of [{rootIds: []}, {rootIds: ['a']}, {rootIds: ['ruler']}, {rootIds: ['cut', 'cut']}, {rootIds: ['missing']}, {filename: '../part.stl'}, {filename: 'part.3mf'}, {bytes: new Uint8Array()}, {modificationNotes: ''}]) {
      await expect(createModelAttributionSidecar(project(), {...output(), ...patch})).rejects.toThrow();
    }
  });
});
