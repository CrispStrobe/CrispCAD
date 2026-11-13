// SPDX-License-Identifier: BSD-3-Clause
import {describe, expect, it} from 'vitest';
import {MODEL_LIBRARY_CONTENT_LICENCES, parseModelLibraryCatalogue, validateModelLibraryCatalogue} from '../packages/core/src/model-library.js';
import type {ModelLibraryCatalogue} from '../packages/core/src/model-library.js';

function catalogue(): ModelLibraryCatalogue {
  return {
    format: 'brickwright-model-library', version: 1,
    assets: [{
      id: 'original-calibration-block', version: '1', title: 'Calibration block', author: 'Example creator',
      sourceUrl: 'https://example.org/models/block',
      licence: {spdx: 'BSD-3-Clause', scope: 'asset', attribution: 'Example creator, BSD-3-Clause', evidenceUrl: 'https://example.org/archive/grant', capturedOn: '2026-11-13', review: 'accepted', reviewer: 'Local curator'},
      original: {url: 'https://example.org/block.cad', format: 'cad-script', sha256: 'a'.repeat(64), bytes: 128},
      derivatives: [{url: 'https://example.org/block.stl', format: 'stl', sha256: 'b'.repeat(64), bytes: 684}],
      modificationNotes: 'Converted original to STL without geometric changes.',
      conversion: {sourceUnits: 'mm', unitAssumption: 'Source explicitly declares millimetres.', sourceUpAxis: 'Z', toMillimetresZUp: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]},
    }],
  };
}
describe('model library metadata admission', () => {
  it('accepts reviewed provenance without implying mesh or physics qualification', () => {
    const input = catalogue();
    const result = validateModelLibraryCatalogue(input);
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.catalogue.assets[0].quality).toBeUndefined();
    input.assets[0].title = 'Changed';
    expect(result.catalogue.assets[0].title).toBe('Calibration block');
    expect(parseModelLibraryCatalogue(JSON.stringify(catalogue())).valid).toBe(true);
  });
  it.each(MODEL_LIBRARY_CONTENT_LICENCES)('admits exact content grant %s', spdx => {
    const c = catalogue(); c.assets[0].licence.spdx = spdx;
    expect(validateModelLibraryCatalogue(c).valid).toBe(true);
  });
  it.each(['CC-BY-NC-4.0', 'CC-BY-ND-4.0', 'CC-BY-SA-4.0', 'GPL-3.0', 'unknown', 'MIT OR GPL-3.0', 'MIT AND CC-BY-NC-4.0', 'BSD'])('refuses excluded or ambiguous rights %s', spdx => {
    const c = catalogue() as any; c.assets[0].licence.spdx = spdx;
    expect(validateModelLibraryCatalogue(c).valid).toBe(false);
  });
  it.each(['scope', 'attribution', 'evidenceUrl', 'capturedOn', 'review', 'reviewer'])('requires explicit grant evidence: %s', key => {
    const c = catalogue() as any; delete c.assets[0].licence[key];
    expect(validateModelLibraryCatalogue(c).valid).toBe(false);
  });
  it('rejects loader-only grants, unreviewed grants and impossible capture dates', () => {
    for (const [key, value] of [['scope', 'loader'], ['review', 'pending'], ['capturedOn', '2026-02-30']]) {
      const c = catalogue() as any; c.assets[0].licence[key] = value;
      expect(validateModelLibraryCatalogue(c).valid).toBe(false);
    }
  });
  it('requires exact file identities and refuses insecure or credential-bearing URLs', () => {
    for (const [key, value] of [['sha256', 'file.stl'], ['bytes', 0], ['bytes', 1.5], ['url', 'http://example.org/block'], ['url', 'https://user:secret@example.org/block']]) {
      const c = catalogue() as any; c.assets[0].original[key] = value;
      expect(validateModelLibraryCatalogue(c).valid).toBe(false);
    }
  });
  it('requires explicit conversion information and an invertible affine transform', () => {
    const c = catalogue() as any;
    delete c.assets[0].conversion.unitAssumption;
    expect(validateModelLibraryCatalogue(c).valid).toBe(false);
    for (const matrix of [[], Array(16).fill(0), Array(16).fill(Infinity), [1, 0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]]) {
      const c = catalogue(); c.assets[0].conversion.toMillimetresZUp = matrix;
      expect(validateModelLibraryCatalogue(c).valid).toBe(false);
    }
  });
  it('ties quality and separate physics checks to a stored file hash and tool versions', () => {
    const c = catalogue();
    c.assets[0].quality = {fileSha256: 'b'.repeat(64), toolVersion: 'mesh-check-1', checkedOn: '2026-11-13', parseable: true, closedPositiveVolume: true, withinSizeLimits: true, withinTriangleLimits: true};
    expect(validateModelLibraryCatalogue(c).valid).toBe(true);
    c.assets[0].quality.physics = {engine: 'Jolt', engineVersion: '1', qualifierVersion: '2', qualified: true};
    expect(validateModelLibraryCatalogue(c).valid).toBe(true);
    c.assets[0].quality.closedPositiveVolume = false;
    expect(validateModelLibraryCatalogue(c).valid).toBe(false);
    c.assets[0].quality.physics.qualified = false;
    expect(validateModelLibraryCatalogue(c).valid).toBe(true);
    c.assets[0].quality.fileSha256 = 'c'.repeat(64);
    expect(validateModelLibraryCatalogue(c).valid).toBe(false);
  });
  it('refuses undeclared grant restrictions and returns diagnostics for hostile objects', () => {
    const c = catalogue() as any; c.assets[0].licence.restrictions = 'Noncommercial only';
    expect(validateModelLibraryCatalogue(c).valid).toBe(false);
    const hostile = Object.defineProperty({}, 'format', {get() { throw new Error('unexpected getter'); }});
    expect(validateModelLibraryCatalogue(hostile).valid).toBe(false);
  });
  it('refuses duplicate identities, malformed or future catalogues and excessive input without throwing', () => {
    const c = catalogue(); c.assets.push(structuredClone(c.assets[0]));
    expect(validateModelLibraryCatalogue(c).valid).toBe(false);
    for (const value of [null, [], {}, {format: c.format, version: 2, assets: []}, {...c, assets: [null]}, {...c, assets: Array(1001).fill(null)}]) expect(validateModelLibraryCatalogue(value).valid).toBe(false);
    expect(parseModelLibraryCatalogue('{').valid).toBe(false);
    expect(parseModelLibraryCatalogue(' '.repeat(4 * 1024 * 1024 + 1)).valid).toBe(false);
  });
});
