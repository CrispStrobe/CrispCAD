// SPDX-License-Identifier: BSD-3-Clause
import {serializeDocument, validateDocument} from './document.js';
import type {CadDocument} from './document.js';
import {sha256Hex} from './hash.js';
import type {ModelProvenanceRecord} from './model-provenance.js';

export interface ModelAttributionExport {
  filename: string;
  format: 'stl';
  bytes: Uint8Array;
  /** Describe changes made after catalogue insertion, including when unchanged. */
  modificationNotes: string;
  /** Printable document roots included by the caller; defaults to all printable roots. */
  rootIds?: readonly string[];
}

export interface ModelAttributionSidecar {
  format: 'brickwright-model-attribution';
  version: 1;
  /** This covers recorded library sources, never a claim about unrecorded sources. */
  scope: 'recorded-library-provenance';
  geometryBinding: 'caller-supplied-export';
  output: {filename: string; format: 'stl'; sha256: string; bytes: number; units: 'mm'; modificationNotes: string};
  project: {id: string; title: string; sha256: string; hashEncoding: 'utf8-serializeDocument'};
  rootIds: string[];
  nodes: {id: string; provenanceIds: string[]}[];
  records: ModelProvenanceRecord[];
}

/** Whether any printable root or boolean operand retains recorded library sources.
 * Legacy extension fields are opaque. Validate before deciding to omit a sidecar.
 */
export function hasModelAttribution(input: CadDocument): boolean {
  const document = validateDocument(input);
  if (document.version !== 5) return false;
  const seen = new Set<string>();
  const visit = (id: string): boolean => {
    if (seen.has(id)) return false;
    seen.add(id);
    const node = document.nodes[id];
    return !!node.provenance?.length || (node.kind === 'boolean' && node.inputs.some(visit));
  };
  return document.roots.filter(id => !document.nodes[id].reference).some(visit);
}

/**
 * Build metadata for caller-supplied export bytes without changing the project.
 * The caller must export exactly these roots from this document, in millimetres.
 * Hashing proves byte identity only: this function does not parse STL, evaluate
 * geometry, verify derivation, establish legal rights or qualify physics.
 */
export async function createModelAttributionSidecar(
  input: CadDocument,
  output: ModelAttributionExport,
): Promise<ModelAttributionSidecar> {
  const document = validateDocument(input);
  if(document.version!==5)throw new Error('No recorded library provenance for selected geometry; legacy fields are opaque.');
  if (output.format !== 'stl' || typeof output.filename !== 'string' ||
      !output.filename.trim() || output.filename.length > 240 ||
      /[\u0000-\u001f\u007f/\\]/.test(output.filename) || !/\.stl$/i.test(output.filename)) {
    throw new Error('Attribution requires an STL filename without a path.');
  }
  if (!(output.bytes instanceof Uint8Array) || !output.bytes.byteLength) {
    throw new Error('Attribution requires nonempty export bytes.');
  }
  if (typeof output.modificationNotes !== 'string' || !output.modificationNotes.trim() ||
      output.modificationNotes.length > 4096 || /[\u0000-\u001f]/.test(output.modificationNotes)) {
    throw new Error('Explicit export modification notes are required.');
  }
  const rootIds = [...(output.rootIds ?? document.roots.filter(id => !document.nodes[id].reference))];
  if (!rootIds.length || new Set(rootIds).size !== rootIds.length ||
      rootIds.some(id => !document.roots.includes(id) || document.nodes[id].reference)) {
    throw new Error('Attribution requires distinct printable document roots.');
  }
  const seen = new Set<string>();
  const provenanceIds = new Set<string>();
  const nodes: ModelAttributionSidecar['nodes'] = [];
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const node = document.nodes[id];
    const references = [...(node.provenance ?? [])];
    nodes.push({id, provenanceIds: references});
    references.forEach(reference => provenanceIds.add(reference));
    if (node.kind === 'boolean') node.inputs.forEach(visit);
  };
  rootIds.forEach(visit);
  const records = (document.provenance?.records ?? []).filter(record => provenanceIds.has(record.id));
  if (!records.length || records.length !== provenanceIds.size) {
    throw new Error('No recorded library provenance for selected geometry.');
  }
  // Capture both byte and metadata inputs before awaiting host hashing APIs.
  const bytes = output.bytes.slice();
  const filename = output.filename;
  const modificationNotes = output.modificationNotes;
  const source = new TextEncoder().encode(serializeDocument(document));
  const [outputHash, projectHash] = await Promise.all([sha256Hex(bytes), sha256Hex(source)]);
  return {
    format: 'brickwright-model-attribution', version: 1,
    scope: 'recorded-library-provenance', geometryBinding: 'caller-supplied-export',
    output: {filename, format: 'stl', sha256: outputHash, bytes: bytes.byteLength, units: 'mm', modificationNotes},
    project: {id: document.id, title: document.title, sha256: projectHash, hashEncoding: 'utf8-serializeDocument'},
    rootIds, nodes, records,
  };
}
