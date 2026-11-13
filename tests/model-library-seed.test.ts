// SPDX-License-Identifier: BSD-3-Clause
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {parseModelLibraryCatalogue} from '../packages/core/src/model-library.js';

const library = new URL('../library/', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, library));
const audit = JSON.parse(read('seed-files.json').toString()) as {
  capturedOn: string;
  files: {url: string; localPath: string; sha256: string; bytes: number; role: string}[];
};

describe('checked-in editable source seed', () => {
  it('validates archival metadata and matches every original to pinned local bytes', () => {
    const result = parseModelLibraryCatalogue(read('seed-catalogue.json').toString());
    expect(result.valid).toBe(true);
    if (!result.valid) throw new Error(result.errors.join('\n'));
    expect(result.catalogue.assets).toHaveLength(3);
    for (const asset of result.catalogue.assets) {
      expect(asset.sourceRevision?.commit).toMatch(/^[a-f0-9]{40}$/);
      expect(asset.original.url).toContain(`/${asset.sourceRevision!.commit}/`);
      const original = audit.files.find(file => file.url === asset.original.url);
      expect(original?.role).toBe('source');
      expect(original?.bytes).toBe(asset.original.bytes);
      expect(original?.sha256).toBe(asset.original.sha256);
      expect(asset.derivatives).toEqual([]);
      expect(asset.quality).toBeUndefined();
    }
  });

  it('verifies source and licence evidence hashes without fetching or executing them', () => {
    expect(audit.files).toHaveLength(6);
    for (const file of audit.files) {
      expect(file.localPath).toMatch(/^(sources|evidence)\/[a-zA-Z0-9_./-]+$/);
      expect(file.localPath).not.toContain('..');
      expect(file.url).toMatch(/^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[a-f0-9]{40}\//);
      const bytes = read(file.localPath);
      expect(bytes.byteLength).toBe(file.bytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256);
    }
    expect(read('sources/jscad/nutsAndBolts.js').toString()).toContain('@licence MIT License');
    expect(read('sources/jscad/gear.js').toString()).toContain('@licence MIT License');
    expect(read('sources/threads-scad/threads.scad').toString()).toContain('This work is released with CC0 into the public domain.');
    expect(JSON.parse(read('evidence/jscad-examples-package.json').toString()).license).toBe('MIT');
  });
});
