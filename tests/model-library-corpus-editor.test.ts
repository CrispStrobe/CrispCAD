// SPDX-License-Identifier: BSD-3-Clause
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';
import {createLocalModelLibraryCatalogue} from '@brickwright/cad-core';
import {checkModelLibrarySTL} from '../packages/geometry/src/model-library-quality.js';

const root = new URL('../', import.meta.url);
const read = (path: string) => readFileSync(new URL(`library/${path}`, root));
const manifest = JSON.parse(read('editor-corpus-manifest.json').toString());
const corpus = JSON.parse(read('corpus/manifest.json').toString());
const repository = corpus.repositories.find((item: any) => item.id === 'AngeloNicoli--OpenSCAD-Snippet');
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const selected = ['beam-angular', 'beam-h', 'key-simple', 'roll-holder', 'angle-shelf', 'sign-01', 'sign-02', 'washer', 'transistor', 'stairs-01', 'bookshelf-01', 'chalkboard-01', 'arrow-01', 'base-cabinet-01', 'beam-c', 'bookshelf-02', 'box-wood-01', 'chair-01', 'door-01', 'flange-01', 'ladder-01', 'sofa', 'table-01', 'vent-grid', 'base-cabinet-02', 'bed-01', 'bed-02', 'bench-01', 'bench-02', 'chair-02', 'chair-03', 'fireplace-01', 'table-02', 'table-03', 'table-small-01', 'window-01', 'building-01', 'chalkboard-02', 'cone-01', 'crystal', 'key', 'lamp-01', 'lever-handle', 'soda-cup-01', 'stairs-02', 'stairs-03', 'traffic-light', 'tootbrush', 'electric-wire-plug', 'flange-03', 'resistor', 'street-02', 'street-03', 'street-06', 'sword-01', 'x', 'banner-01', 'raccordo', 'street-01', 'street-05', 'street-04', 'eyebolt', 'ladder-02', 'wall-04', 'fence-01', 'fence-02', 'building-02', 'walking-stick', 'ingot-01', 'coin-01', 'led-01', 'sauce-bottle', 'pipe-00', 'flange-02'];

describe('explicit corpus to editor selection', () => {
  it('admits exactly seventy-four selected standalone sources with unchanged pinned originals and full MIT grants', () => {
    expect(selected).toHaveLength(74);
    expect(manifest.selection).toMatchObject({count: selected.length, runtimeChecked: selected.length, complete: true});
    expect(manifest.assets.map((asset: any) => asset.id)).toEqual(selected.map(slug => `corpus-angelo-${slug}`));
    const street03 = manifest.assets.find((asset: any) => asset.id === 'corpus-angelo-street-03');
    const street06 = manifest.assets.find((asset: any) => asset.id === 'corpus-angelo-street-06');
    expect(street03.original.sha256).not.toBe(street06.original.sha256);
    expect(street03.derivatives[0].sha256).toBe(street06.derivatives[0].sha256);
    for (const street of [street03, street06]) expect(street.modificationNotes).toContain('counts source files, not unique shapes');
    expect(manifest.assets.find((asset: any) => asset.id === 'corpus-angelo-x').title).toBe('Crossed cubes (x)');
    const catalogue = createLocalModelLibraryCatalogue(manifest);
    expect(catalogue.assets).toHaveLength(selected.length);
    const fullNotice = read('evidence/corpus-selection-MIT-LICENSE.txt').toString().replace(/\s+/g, ' ').trim();
    expect(fullNotice).toContain('Permission is hereby granted');
    expect(fullNotice).toContain('THE SOFTWARE IS PROVIDED "AS IS"');
    for (const asset of manifest.assets) {
      const record = repository.files.find((item: any) => item.path === asset.corpusSelection.upstreamPath);
      expect(asset.sourceRevision.commit).toBe('4f9e3d4d16b5e427186c1f89e10c2181c437dee6');
      expect(asset.original.url).toBe(record.source_url);
      expect(asset.sourceRevision.sourceUrl).toBe(record.source_url);
      expect(asset.original.sha256).toBe(record.sha256);
      expect(read(asset.original.path)).toEqual(read(asset.corpusSelection.archivedPath));
      expect(record.dependency_blockers).toEqual([]);
      expect(asset.licence.spdx).toBe('MIT');
      expect(asset.licence.attribution).toContain(fullNotice);
      for (const file of [asset.original, ...asset.derivatives, ...asset.licence.localEvidence]) {
        const bytes = read(file.path);
        expect(bytes.length).toBe(file.bytes);
        expect(hash(bytes)).toBe(file.sha256);
      }
    }
  });

  it('screens all selected meshes independently and keeps physics qualification absent', async () => {
    for (const asset of manifest.assets) {
      const mesh = asset.derivatives.find((file: any) => file.format === 'stl');
      const result = await checkModelLibrarySTL(read(mesh.path), {checkedOn: '2026-11-14', toMillimetresZUp: asset.conversion.toMillimetresZUp, maxTriangles: 10000, maxExtentMm: 200});
      expect(result.quality, asset.id).toEqual(asset.quality);
      expect(Object.values(result.checks), asset.id).toEqual(['pass', 'pass', 'pass', 'pass']);
      expect(asset.quality.fileSha256).toBe(mesh.sha256);
      expect(asset.quality.physics).toBeUndefined();
      expect(result.diagnostics).toEqual([]);
    }
  });

  it('retains independently calculable volumes and source coordinates', () => {
    // Beam H: three 0.4 mm³ boxes, minus two 0.02 mm³ overlaps.
    const h = manifest.assets.find((asset: any) => asset.id === 'corpus-angelo-beam-h');
    expect(h.measurements.signedVolumeMm3).toBeCloseTo(1.16, 5);
    h.measurements.boundsMm.min.forEach((value: number, index: number) => expect(value).toBeCloseTo([-0.5, -0.55, -2][index], 6));
    h.measurements.boundsMm.max.forEach((value: number, index: number) => expect(value).toBeCloseTo([0.5, 0.55, 2][index], 6));
    const angular = manifest.assets.find((asset: any) => asset.id === 'corpus-angelo-beam-angular');
    expect(angular.measurements.signedVolumeMm3).toBeCloseTo(0.78, 5);
    // C profile: (3×3 − 2.7×2.4) mm² ×10 mm, scaled by 0.1 on every axis.
    const c = manifest.assets.find((asset: any) => asset.id === 'corpus-angelo-beam-c');
    expect(c.measurements.signedVolumeMm3).toBeCloseTo(0.0252, 7);
    c.measurements.boundsMm.min.forEach((value: number, index: number) => expect(value).toBeCloseTo([0, 0, -0.5][index], 6));
    c.measurements.boundsMm.max.forEach((value: number, index: number) => expect(value).toBeCloseTo([0.3, 0.3, 0.5][index], 6));
    // Raccordo intersects a 0.5 mm cube with one quarter of a regular 40-gon prism.
    // The # modifier highlights the cube and must retain that intersection operand.
    const raccordo = manifest.assets.find((asset: any) => asset.id === 'corpus-angelo-raccordo');
    expect(raccordo.corpusSelection.upstreamPath).toBe('Basic Example/Raccordo.scad');
    expect(raccordo.measurements.signedVolumeMm3).toBeCloseTo(40 * 0.25 * Math.sin(Math.PI / 20) / 16, 7);
    expect(raccordo.measurements.boundsMm).toEqual({min: [0, 0, 0], max: [0.5, 0.5, 0.5]});
    expect(raccordo.modificationNotes).toContain('highlighted solid geometry is retained');
    const street01 = manifest.assets.find((asset: any) => asset.id === 'corpus-angelo-street-01');
    expect(street01.measurements.signedVolumeMm3).toBeCloseTo(4 * 2 * 0.2, 6);
    // Ingot is a tapered 2×1 mm profile: h/3 × (bottom area + top area + geometric mean).
    const ingot = manifest.assets.find((asset: any) => asset.id === 'corpus-angelo-ingot-01');
    expect(ingot.measurements.signedVolumeMm3).toBeCloseTo(0.5 / 3 * (2 + 1.28 + 1.6), 6);
    expect(ingot.measurements.boundsMm).toEqual({min: [-1, -0.5, 0], max: [1, 0.5, 0.5]});
    // Full-render $preview=false selects 30 segments for the annular pipe.
    const pipe = manifest.assets.find((asset: any) => asset.id === 'corpus-angelo-pipe-00');
    expect(pipe.measurements.signedVolumeMm3).toBeCloseTo(15 * 30 / 2 * (2 ** 2 - 1.75 ** 2) * Math.sin(2 * Math.PI / 30), 4);
    expect(pipe.modificationNotes).toContain('fixed full-render context $preview=false');
    // Flange Size=0 is a 64-gon radius 100 prism minus four 60-gon radius 10 holes.
    const flange = manifest.assets.find((asset: any) => asset.id === 'corpus-angelo-flange-02');
    expect(flange.measurements.signedVolumeMm3).toBeCloseTo(10 * (64 / 2 * 100 ** 2 * Math.sin(2 * Math.PI / 64) - 4 * 60 / 2 * 10 ** 2 * Math.sin(2 * Math.PI / 60)), 1);
    expect(flange.measurements.boundsMm).toEqual({min: [-100, -100, 0], max: [100, 100, 10]});
    expect(flange.modificationNotes).toContain('fixed full-render context $preview=false');
    expect(flange.modificationNotes).toContain('constant dimension selector Size=0');
    street01.measurements.boundsMm.min.forEach((value: number, index: number) => expect(value).toBeCloseTo([-2, -1, -0.1][index], 6));
    street01.measurements.boundsMm.max.forEach((value: number, index: number) => expect(value).toBeCloseTo([2, 1, 0.1][index], 6));
  });

  it('reproduces selected archives, meshes and manifest locally without writes or network', () => {
    expect(execFileSync(process.execPath, ['scripts/generate-corpus-editor-library.mjs', '--check'], {cwd: fileURLToPath(root), encoding: 'utf8', timeout: 60000})).toContain(`${selected.length} selected corpus sources complete; ${selected.length} runtime-checked`);
  });
});
