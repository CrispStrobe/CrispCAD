// SPDX-License-Identifier: BSD-3-Clause
import {describe, expect, it} from 'vitest';
import {parsePreviewArguments, selectPreviewAssets} from '../scripts/generate-library-previews.mjs';

describe('explicit preview rendering selection', () => {
  it('keeps the default selection and combines repeated IDs with corpus-only', () => {
    expect(parsePreviewArguments([])).toEqual({corpusOnly: false, assetIds: []});
    expect(parsePreviewArguments(['--asset-id', 'second', '--corpus-only', '--asset-id', 'first'])).toEqual({corpusOnly: true, assetIds: ['second', 'first']});
  });
  it('rejects missing IDs and unknown arguments before rendering', () => {
    for (const args of [['--asset-id'], ['--asset-id', ''], ['--asset-id', '--corpus-only']]) expect(() => parsePreviewArguments(args)).toThrow('requires an asset ID');
    expect(() => parsePreviewArguments(['--missing-only'])).toThrow('Unknown preview argument');
  });
  it('selects only requested models, once each, without mutating the available list', () => {
    const assets = [{id: 'first'}, {id: 'second'}, {id: 'third'}];
    expect(selectPreviewAssets(assets, ['third', 'first', 'third'])).toEqual([assets[0], assets[2]]);
    expect(selectPreviewAssets(assets, [])).toBe(assets);
    expect(assets).toEqual([{id: 'first'}, {id: 'second'}, {id: 'third'}]);
  });
  it('rejects every unknown ID instead of silently rendering a partial selection', () => {
    expect(() => selectPreviewAssets([{id: 'first'}], ['first', 'missing'])).toThrow('Unknown preview asset ID: missing');
  });
});
