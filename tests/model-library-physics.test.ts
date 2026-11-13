// SPDX-License-Identifier: BSD-3-Clause
import {beforeAll, describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createPresetDocument} from '../packages/editor/src/shapes.js';
import {createCadSession, type ModelLibraryCatalogue} from '@brickwright/cad-core';
import {checkModelLibrarySTL, createGeometryKernel, exportSTL, type GeometryKernel} from '@brickwright/cad-geometry';
import {qualifyModelLibrarySTL, MODEL_LIBRARY_COLLISION_QUALIFIER_VERSION, MODEL_LIBRARY_JOLT_VERSION} from '../packages/physics/src/index.js';
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
    expect(manifest.dependencies['jolt-physics']).toBe(`https://github.com/CrispStrobe/JoltPhysics.js/releases/download/bw.9-qualified-20261029/jolt-physics-${MODEL_LIBRARY_JOLT_VERSION}.tgz`);
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
