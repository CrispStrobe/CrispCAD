// SPDX-License-Identifier: BSD-3-Clause
import 'fake-indexeddb/auto';
import {beforeAll, describe, expect, it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createPresetDocument} from '../packages/editor/src/shapes.js';
import {createCadSession, parseDocument, parseModelLibraryCatalogue, validateModelLibraryCatalogue, type ModelLibraryCatalogue} from '@brickwright/cad-core';
import {checkModelLibrarySTL, createGeometryKernel, exportSTL, type GeometryKernel} from '@brickwright/cad-geometry';
import {qualifyModelLibrarySTL, qualifyModelLibrarySTLAndAttach, isQualifiedCollision, MODEL_LIBRARY_COLLISION_QUALIFIER_VERSION, MODEL_LIBRARY_JOLT_VERSION} from '../packages/physics/src/index.js';
import {appendPortableRevision, readPortableHistory, openHistoryStore} from '../packages/history/src/index.js';
// Manifold/Jolt suite: under a loaded machine (load ~150) its tests and hooks ran up to ~10x
// their idle time, past vitest's 5 s / 10 s defaults. Explicit per-test timeouts below still win.
vi.setConfig({testTimeout:60_000,hookTimeout:120_000});
let kernel: GeometryKernel;
const identity = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
const selection = {assetId: 'fixture', file: 'original'} as const;
beforeAll(async () => {
  kernel = await createGeometryKernel({wasmBinary: readFileSync('node_modules/manifold-3d/manifold.wasm')});
});
async function fixture(tube = false) {
  const session = createCadSession();
  session.add({kind:'box', size:[10,20,30]});
  const bytes = exportSTL(kernel.evaluate(tube ? createPresetDocument('tube') : session.state.document).bodies);
  session.dispose();
  const options = {kernel, toMillimetresZUp: [...identity], checkedOn: '2026-11-13'};
  const quality = await checkModelLibrarySTL(bytes, options);
  const catalogue: ModelLibraryCatalogue = {format:'brickwright-model-library', version:1, assets:[{
    id:'fixture', version:'1', title:'Original test solid', author:'Brickwright', sourceUrl:'https://example.org/fixture',
    licence:{spdx:'BSD-3-Clause', scope:'asset', attribution:'Original test solid', evidenceUrl:'https://example.org/grant', capturedOn:'2026-11-13', review:'accepted', reviewer:'Test'},
    original:{url:'https://example.org/fixture.stl', format:'stl', sha256:quality.fileSha256, bytes:bytes.length},
    derivatives:[], modificationNotes:'Generated test fixture.', conversion:{sourceUnits:'mm',unitAssumption:'Explicit mm',sourceUpAxis:'Z',toMillimetresZUp:[...identity]}, quality:quality.quality,
  }]};
  return {bytes, catalogue, options};
}
describe('optional library Jolt collision qualification', () => {
  it('keeps the reported engine version aligned with the pinned package release', () => {
    const manifest = JSON.parse(readFileSync('packages/physics/package.json', 'utf8'));
    const installed = createRequire(import.meta.url).resolve('jolt-physics/package.json');
    const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')).packages['node_modules/jolt-physics'];
    expect(lock.resolved).toBe(manifest.dependencies['jolt-physics']);
    expect(lock.version).toBe(MODEL_LIBRARY_JOLT_VERSION);
    expect(JSON.parse(readFileSync(installed, 'utf8')).version).toBe(MODEL_LIBRARY_JOLT_VERSION);
  });
  it('creates native shapes and steps the debug engine; returns separate hash/version/policy-bound evidence', async () => {
    const f = await fixture(), before = structuredClone(f.catalogue), original = f.bytes.slice();
    const result = await qualifyModelLibrarySTL(f.catalogue, selection, f.bytes, {...f.options, maxHulls:8, volumeFraction:0.01, boundsMm:0.1});
    expect(result.evidence).toMatchObject({fileSha256:f.catalogue.assets[0].original.sha256, checkedOn:'2026-11-13', toMillimetresZUp:identity, engine:'Jolt', engineVersion:MODEL_LIBRARY_JOLT_VERSION, qualifierVersion:MODEL_LIBRARY_COLLISION_QUALIFIER_VERSION, qualified:true, scope:'rigid-collision-preview', hulls:1, nativeCheck:{ground:false,steps:1,stepSeconds:0.005}, certificate:{maxHulls:8,tolerance:{volumeFraction:0.01,boundsMm:0.1}}});
    expect(result.evidence.geometrySha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.evidence.geometrySha256).toBe(result.evidence.certificate.sourceSHA256);
    expect(result.quality.quality).not.toHaveProperty('physics');
    expect(f.catalogue).toEqual(before); expect(f.bytes).toEqual(original);
  });
  it('binds the applied conversion and changed file identity instead of reusing previous evidence', async () => {
    const f = await fixture();
    const first = await qualifyModelLibrarySTL(f.catalogue, selection, f.bytes, f.options);
    const matrix = [...identity]; matrix[0]=2; matrix[12]=7;
    f.options.toMillimetresZUp=matrix;
    const quality = await checkModelLibrarySTL(f.bytes, f.options); f.catalogue.assets[0].quality=quality.quality;
    const pending = qualifyModelLibrarySTL(f.catalogue, selection, f.bytes, f.options);
    f.bytes.fill(0); matrix.fill(0); f.catalogue.assets[0].quality!.fileSha256='a'.repeat(64);
    const second = await pending;
    expect(second.evidence.geometrySha256).not.toBe(first.evidence.geometrySha256);
    expect(second.evidence.fileSha256).toBe(first.evidence.fileSha256);
    expect(second.evidence.toMillimetresZUp[0]).toBe(2); expect(second.evidence.toMillimetresZUp[12]).toBe(7);
    await expect(qualifyModelLibrarySTL(f.catalogue, selection, f.bytes, {...f.options,toMillimetresZUp:identity})).rejects.toThrow();
  });
  it('uses a qualified compound for a non-convex tube and refuses a budget that cannot preserve it', async () => {
    const f = await fixture(true);
    await expect(qualifyModelLibrarySTL(f.catalogue, selection, f.bytes, {...f.options,maxHulls:1})).rejects.toThrow();
    const result = await qualifyModelLibrarySTL(f.catalogue, selection, f.bytes, f.options);
    expect(result.evidence.hulls).toBeGreaterThan(1);
    expect(result.evidence.certificate.relativeError).toBeLessThan(0.02);
  });
  it('persists complete reports, rejects stale bindings, and retains document and history snapshots', async () => {
    const f = await fixture(), old = structuredClone(f.catalogue);
    const catalogue = await qualifyModelLibrarySTLAndAttach(f.catalogue, selection, f.bytes, f.options);
    expect(f.catalogue).toEqual(old);
    expect(parseModelLibraryCatalogue(JSON.stringify(old)).valid).toBe(true);
    const parsed = parseModelLibraryCatalogue(JSON.stringify(catalogue));
    expect(parsed.valid).toBe(true);
    if (!parsed.valid) throw new Error('Expected valid persisted report');
    const report = catalogue.assets[0].quality!.collisionReport!;
    expect(report.selectedFile).toEqual(catalogue.assets[0].original);
    expect(report.quality.quality).not.toHaveProperty('collisionReport');
    expect(await isQualifiedCollision(JSON.parse(JSON.stringify(report)))).toBe(false);
    for (const version of ['1.1.0-bw.9', '1.1.0-bw.10']) {
      const historical = structuredClone(catalogue);
      historical.assets[0].quality!.collisionReport!.evidence.engineVersion = version;
      const summary = historical.assets[0].quality!.physics;
      if (summary) summary.engineVersion = version;
      expect(parseModelLibraryCatalogue(JSON.stringify(historical)).valid).toBe(true);
    }
    const mutations: ((c: any) => void)[] = [
      c => c.version = 2,
      c => c.assets[0].quality.collisionReport.version = 2,
      c => c.assets[0].quality.collisionReport.selectedFile.bytes++,
      c => c.assets[0].quality.collisionReport.selectedFile.url += '?changed',
      c => c.assets[0].quality.collisionReport.evidence.fileSha256 = 'a'.repeat(64),
      c => c.assets[0].quality.collisionReport.evidence.toMillimetresZUp[12] = 1,
      c => c.assets[0].quality.screeningPolicy.toMillimetresZUp[0] = 2,
      c => c.assets[0].quality.collisionReport.quality.checks.parseable = 'unchecked',
      c => c.assets[0].quality.collisionReport.quality.quality.withinSizeLimits = false,
      c => c.assets[0].quality.collisionReport.evidence.geometrySha256 = 'b'.repeat(64),
      c => c.assets[0].quality.collisionReport.evidence.engineVersion = 'unknown',
      c => c.assets[0].quality.collisionReport.evidence.qualifierVersion = 'unknown',
      c => c.assets[0].quality.collisionReport.evidence.nativeCheck.steps = 0,
      c => c.assets[0].quality.collisionReport.evidence.nativeCheck.build = 'release',
      c => c.assets[0].quality.collisionReport.evidence.certificate.relativeError = 0.01,
      c => c.assets[0].quality.collisionReport.evidence.certificate.numericalResidualVolumeMm3 = -1,
      c => c.assets[0].quality.collisionReport.evidence.certificate.numericalResidualVolumeMm3 = Infinity,
      c => c.assets[0].quality.collisionReport.evidence.certificate.numericalResidualVolumeMm3 = 10,
      c => c.assets[0].quality.collisionReport.evidence.certificate.tolerance.boundsMm = 2,
      c => c.assets[0].quality.collisionReport.evidence.hulls = 0,
      c => c.assets[0].quality.collisionReport.extra = true,
      c => c.assets[0].quality.physics = {engine:'Jolt', engineVersion:'wrong', qualifierVersion:'wrong', qualified:true},
    ];
    for (const mutate of mutations) {
      const invalid = structuredClone(catalogue); mutate(invalid);
      expect(validateModelLibraryCatalogue(invalid).valid).toBe(false);
    }
    const session = createCadSession(), id = session.add({kind:'box', size:[10,20,30]});
    const before = session.serialize(), originalDoc = structuredClone(session.state.document);
    let archive = await appendPortableRevision(undefined, originalDoc, 'Original');
    session.attachProvenance([id], {id:'qualified',asset:parsed.catalogue.assets[0],selectedFile:report.selectedFile,modificationNotes:'Recorded reviewed source.'});
    const saved = session.serialize(), savedDoc = structuredClone(session.state.document);
    expect(parseDocument(saved)).toEqual(savedDoc);
    session.undo(); expect(session.serialize()).toBe(before);
    session.redo(); expect(session.serialize()).toBe(saved);
    archive = await appendPortableRevision(archive, savedDoc, 'Report');
    const history = await readPortableHistory(archive);
    expect(history.readDocument(history.revisions[0].id)).toEqual(originalDoc);
    expect(history.readDocument(history.revisions[1].id)).toEqual(savedDoc);
    const store = await openHistoryStore(`qualification-${crypto.randomUUID()}`);
    const project = await store.importArchive(archive, {preserveIdentity:true});
    const reloaded = await readPortableHistory(await store.exportArchive(project.id));
    expect(reloaded.readDocument(reloaded.revisions[0].id)).toEqual(originalDoc);
    expect(reloaded.readDocument(reloaded.revisions[1].id)).toEqual(savedDoc);
    await store.close(); session.dispose();
    report.evidence.nativeCheck.steps = 0 as 1;
    expect(parsed.catalogue.assets[0].quality!.collisionReport!.evidence.nativeCheck.steps).toBe(1);
  });
  it('retains a local derivative identity and its conversion independently from the original', async () => {
    const f = await fixture(), asset = f.catalogue.assets[0];
    asset.derivatives = [{path:'meshes/derived.stl', format:'stl', sha256:asset.original.sha256, bytes:asset.original.bytes}];
    asset.original.sha256 = 'a'.repeat(64);
    asset.conversion.toMillimetresZUp[0] = 10;
    const catalogue = await qualifyModelLibrarySTLAndAttach(f.catalogue, {assetId:'fixture', file:{derivative:0}}, f.bytes, f.options);
    const report = catalogue.assets[0].quality!.collisionReport!;
    expect(report.selectedFile).toEqual(asset.derivatives[0]);
    expect(report.evidence.toMillimetresZUp).toEqual(identity);
    expect(catalogue.assets[0].conversion.toMillimetresZUp[0]).toBe(10);
    const before = structuredClone(f.catalogue);
    await expect(qualifyModelLibrarySTLAndAttach(f.catalogue, {assetId:'fixture', file:{derivative:0}}, new Uint8Array(f.bytes.length), f.options)).rejects.toThrow();
    expect(f.catalogue).toEqual(before);
  });
  it('refuses missing/failing screen evidence, kernel failure, invalid limits and cancellation', async () => {
    const f = await fixture();
    await expect(qualifyModelLibrarySTL(f.catalogue, selection, f.bytes, {...f.options,kernel:{...kernel,evaluate:()=>{throw new Error('Kernel refused');}}})).rejects.toThrow();
    await expect(qualifyModelLibrarySTL(f.catalogue, selection, f.bytes, {...f.options,maxHulls:0})).rejects.toThrow('limits');
    const controller = new AbortController(); controller.abort();
    await expect(qualifyModelLibrarySTL(f.catalogue, selection, f.bytes, {...f.options,signal:controller.signal})).rejects.toThrow();
    const mismatch = structuredClone(f.catalogue); mismatch.assets[0].quality!.fileSha256='a'.repeat(64);
    await expect(qualifyModelLibrarySTL(mismatch, selection, f.bytes, f.options)).rejects.toThrow();
    delete f.catalogue.assets[0].quality;
    await expect(qualifyModelLibrarySTL(f.catalogue, selection, f.bytes, f.options)).rejects.toThrow('passing curated quality');
  });
});
