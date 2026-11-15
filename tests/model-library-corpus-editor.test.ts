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
const selected = ['beam-angular', 'beam-h', 'key-simple', 'roll-holder', 'angle-shelf', 'sign-01', 'sign-02', 'washer', 'transistor', 'stairs-01', 'bookshelf-01', 'chalkboard-01', 'arrow-01', 'base-cabinet-01', 'beam-c', 'bookshelf-02', 'box-wood-01', 'chair-01', 'door-01', 'flange-01', 'ladder-01', 'sofa', 'table-01', 'vent-grid', 'base-cabinet-02', 'bed-01', 'bed-02', 'bench-01', 'bench-02', 'chair-02', 'chair-03', 'fireplace-01', 'table-02', 'table-03', 'table-small-01', 'window-01', 'building-01', 'chalkboard-02', 'cone-01', 'crystal', 'key', 'lamp-01', 'lever-handle', 'soda-cup-01', 'stairs-02', 'stairs-03', 'traffic-light', 'tootbrush', 'electric-wire-plug', 'flange-03', 'resistor', 'street-02', 'street-03', 'street-06', 'sword-01', 'x', 'banner-01', 'raccordo', 'street-01', 'street-05', 'street-04', 'eyebolt', 'ladder-02', 'wall-04', 'fence-01', 'fence-02', 'building-02', 'walking-stick', 'ingot-01', 'coin-01', 'led-01', 'sauce-bottle', 'pipe-00', 'flange-02', 'cup-01', 'ring', 'pipe-90', 'key-old-01', 'hole-plate', 'mech-piece-01', 'mech-piece-02', 'arc-02', 'circular-blade', 'gear-01', 'gear-02', 'mallet', 'tower', 'weights-01', 'tree-01', 'nut-lq', 'rod-01', 'animation-gear-02', 'animation-mechanism-01', 'shaft-01', 'shaft-02-with-keyway', 'coin-02', 'scene-city-street', 'bricks', 'arc-01', 'flag-france'];

describe('explicit corpus to editor selection', () => {
  it('admits exactly one hundred selected source roots with unchanged pinned originals and full MIT grants', () => {
    expect(selected).toHaveLength(100);
    expect(manifest.selection).toMatchObject({count: selected.length, runtimeChecked: selected.length, complete: true});
    expect(manifest.assets.map((asset: any) => asset.id)).toEqual(selected.map(slug => `corpus-angelo-${slug}`));
    const street03 = manifest.assets.find((asset: any) => asset.id === 'corpus-angelo-street-03');
    const street06 = manifest.assets.find((asset: any) => asset.id === 'corpus-angelo-street-06');
    expect(street03.original.sha256).not.toBe(street06.original.sha256);
    expect(street03.derivatives[0].sha256).toBe(street06.derivatives[0].sha256);
    for (const street of [street03, street06]) expect(street.modificationNotes).toContain('counts source files, not unique shapes');
    expect(manifest.assets.find((asset: any) => asset.id === 'corpus-angelo-x').title).toBe('Crossed cubes (x)');
    for (const slug of ['cup-01', 'ring', 'pipe-90', 'key-old-01']) {
      const asset = manifest.assets.find((asset: any) => asset.id === `corpus-angelo-${slug}`);
      expect(asset.modificationNotes).toContain('Brickwright interprets the authored two-component 3D translations [0,0] as [0,0,0]');
      expect(asset.modificationNotes).toContain('fixed full-render context $preview=false');
      expect(asset.modificationNotes).toContain('only the instantiated default top-level model');
      if (slug === 'ring' || slug === 'pipe-90') expect(asset.modificationNotes).toContain('unresolved ring call');
    }
    for (const asset of manifest.assets.slice(78)) {
      expect(asset.modificationNotes).toContain('only the instantiated default top-level model');
      expect(asset.modificationNotes).toContain('Import warnings captured at qualification:');
      expect(asset.modificationNotes).toContain('Source colours and transparency are not retained');
    }
    const plate = manifest.assets.find((asset: any) => asset.id === 'corpus-angelo-hole-plate');
    expect(plate.modificationNotes).toContain('authored % background cube is excluded');
    expect(plate.modificationNotes).toContain('authored cylinder-radius meaning');
    for (const slug of ['weights-01', 'tree-01', 'nut-lq']) {
      const asset = manifest.assets.find((asset: any) => asset.id === `corpus-angelo-${slug}`);
      expect(asset.modificationNotes).toContain('bounded fixed-cardinality subset for the authored defaults');
    }
    for (const slug of ['rod-01', 'animation-gear-02', 'animation-mechanism-01']) {
      const asset = manifest.assets.find((asset: any) => asset.id === `corpus-angelo-${slug}`);
      expect(asset.modificationNotes).toContain('builtin unbound-time fallback $t=0');
      expect(asset.modificationNotes).toContain('Unbound animation time uses $t=0; motion is not retained.');
      expect(asset.modificationNotes).toContain('Gear engagement, kinematics and mechanical performance are not certified');
    }
    expect(manifest.assets.find((asset: any) => asset.id === 'corpus-angelo-animation-gear-02').corpusSelection.upstreamPath).toBe('Animation_SCAD/Gear_02.scad');
    expect(manifest.assets.find((asset: any) => asset.id === 'corpus-angelo-animation-mechanism-01').corpusSelection.upstreamPath).toBe('Animation_SCAD/Mechanism_01.scad');
    const mechanism = manifest.assets.find((asset: any) => asset.id === 'corpus-angelo-animation-mechanism-01');
    const staticKey = manifest.assets.find((asset: any) => asset.id === 'corpus-angelo-key');
    expect(mechanism.original.sha256).not.toBe(staticKey.original.sha256);
    expect(mechanism.derivatives[0].sha256).toBe(staticKey.derivatives[0].sha256);
    expect(mechanism.modificationNotes).toContain('counts source files, not unique shapes');
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

  it('preserves every complete record from the first 93 editor selections', () => {
    // Canonical digest pins provenance and qualification together, beyond just mesh identity.
    expect(hash(Buffer.from(JSON.stringify(manifest.assets.slice(0, 78))))).toBe('e9620e4d5abeacff56a9a1fcbe6b70b47e4a1ebb8c3d81d29425d5cbcfcb7c61');
    expect(hash(Buffer.from(JSON.stringify(manifest.assets.slice(0, 90))))).toBe('d11cbd3e39866caf6e7b2c41cabe17daeed22ff1011c9924232f1d7e66ca5e86');
    expect(hash(Buffer.from(JSON.stringify(manifest.assets.slice(0, 93))))).toBe('80bf476a8360f4a58c54d90961ea49355751b7132feec3825fbc79950335000f');
  });

  it('retains the complete Walking Stick v1 qualification, original mesh and preview after scoped-fn correction', () => {
    const history = JSON.parse(read('corpus-audit/qualification-history/walking-stick-v1.json').toString());
    expect(history.format).toBe('brickwright-model-library-qualification-history');
    expect(history.sourceManifest.gitCommit).toBe('23d27d7794356ce0aaf9727e637326df739e3028');
    // Canonical digest covers the entire original record, including grant evidence and measurements.
    expect(hash(Buffer.from(JSON.stringify(history.asset)))).toBe('6a46b4b147acfd8ebb39834a7508c9e57b90e91a05ca842928dba991a685acf8');
    const legacy = history.asset;
    expect(legacy.derivatives[0].path).toBe('meshes/corpus-selection/walking-stick.stl');
    expect(legacy.derivatives[0].sha256).toBe('8901e38895159c7eab8de5002c741c3019e0ec587fa55667cdfa28fc2a15627a');
    const mesh = read(legacy.derivatives[0].path);
    expect(hash(mesh)).toBe(legacy.derivatives[0].sha256);
    expect(mesh.length).toBe(legacy.derivatives[0].bytes);
    expect(legacy.quality.fileSha256).toBe(legacy.derivatives[0].sha256);
    const preview = read(history.preview.path);
    expect(preview.length).toBe(history.preview.bytes);
    expect(hash(preview)).toBe(history.preview.sha256);
    const current = manifest.assets.find((asset: any) => asset.id === legacy.id);
    expect(current.original).toEqual(legacy.original);
    expect(current.derivatives[0].path).toBe('meshes/corpus-selection/walking-stick-scoped-fn-v2.stl');
    expect(current.derivatives[0].sha256).not.toBe(legacy.derivatives[0].sha256);
  });

  it('screens all selected meshes independently and keeps physics qualification absent', async () => {
    for (const asset of manifest.assets) {
      const mesh = asset.derivatives.find((file: any) => file.format === 'stl');
      const result = await checkModelLibrarySTL(read(mesh.path), {checkedOn: asset.quality.checkedOn, toMillimetresZUp: asset.conversion.toMillimetresZUp, maxTriangles: 10000, maxExtentMm: 200});
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
    // Nut LQ is a regular hexagon (circumradius 1) minus a 30-gon hole (radius 0.7), height 1.
    const nut = manifest.assets.find((asset: any) => asset.id === 'corpus-angelo-nut-lq');
    expect(nut.measurements.signedVolumeMm3).toBeCloseTo(3 * Math.sin(Math.PI / 3) - 15 * 0.7 ** 2 * Math.sin(Math.PI / 15), 5);
    const tree = manifest.assets.find((asset: any) => asset.id === 'corpus-angelo-tree-01');
    tree.measurements.boundsMm.min.forEach((value: number, index: number) => expect(value).toBeCloseTo([-1, -Math.sin(2 * Math.PI / 5), -1.5][index], 6));
    tree.measurements.boundsMm.max.forEach((value: number, index: number) => expect(value).toBeCloseTo([1, Math.sin(2 * Math.PI / 5), 1.75][index], 6));
    street01.measurements.boundsMm.min.forEach((value: number, index: number) => expect(value).toBeCloseTo([-2, -1, -0.1][index], 6));
    street01.measurements.boundsMm.max.forEach((value: number, index: number) => expect(value).toBeCloseTo([2, 1, 0.1][index], 6));
  });

  it('reproduces selected archives, meshes and manifest locally without writes or network', () => {
    expect(execFileSync(process.execPath, ['scripts/generate-corpus-editor-library.mjs', '--check'], {cwd: fileURLToPath(root), encoding: 'utf8', timeout: 60000})).toContain(`${selected.length} selected corpus sources complete; ${selected.length} runtime-checked`);
  },65000); // Match the child process's 60-second integration budget.
});
