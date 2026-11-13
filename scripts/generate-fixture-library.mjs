// SPDX-License-Identifier: BSD-3-Clause
// Selected local fixture only; no network or upstream application execution.
import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createCadSession, importOpenSCAD} from '../packages/core/dist/index.js';
import {createGeometryKernel, exportSTL, checkModelLibrarySTL} from '../packages/geometry/dist/index.js';

const root = new URL('../', import.meta.url);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const commit = 'e1bbc8eec047c2fb604b71f7e4793c3e0189fd6d';
const repositoryUrl = 'https://github.com/Ghostkeeper/SlicerTestModels';
const read = path => readFile(new URL(`library/${path}`, root));
const localFile = (path, bytes) => ({path, sha256: hash(bytes), bytes: bytes.length});
const pins = [
  ['sources/slicer-test-models/cube.scad', 'a07e6cec5cad312fc338cc4779f0163a44edce73b35dab03e1b16129ac543330', 'basic/cube.scad'],
  ['evidence/slicer-test-models-README.md', '0b106b8a989e50360e58379504af6adec203916c3dd2b410abaf2ff11b34a302', 'README.md'],
  ['evidence/slicer-test-models-LICENSE.md', '868ac549cfeb406ca91595670341fd468ac2e49147b8eebff098752110ae626d', 'LICENSE.md'],
];

export async function generateFixtureLibrary() {
  const archived = [];
  for (const [path, expected, upstream] of pins) {
    const bytes = await read(path);
    if (hash(bytes) !== expected) throw new Error(`Review required: pinned fixture source/evidence changed: ${path}`);
    archived.push({...localFile(path, bytes), url: `https://raw.githubusercontent.com/Ghostkeeper/SlicerTestModels/${commit}/${upstream}`});
  }
  const source = await read(pins[0][0]);
  const program = importOpenSCAD(source.toString('utf8'));
  const session = createCadSession();
  session.addCode(program, '10 mm geometric cube fixture');
  const wasm = await readFile(new URL('node_modules/manifold-3d/manifold.wasm', root));
  const kernel = await createGeometryKernel({wasmBinary: wasm});
  const mesh = Buffer.from(exportSTL(kernel.evaluate(session.state.document).bodies));
  const screening = await checkModelLibrarySTL(mesh, {checkedOn: '2026-11-13', toMillimetresZUp: identity, maxTriangles: 100, maxExtentMm: 10});
  if (!screening.quality || Object.values(screening.checks).some(check => check !== 'pass')) throw new Error('Fixture mesh screening failed.');
  const meshPath = 'meshes/slicer-test-models/cube.stl';
  const authorEvidencePath = 'evidence/slicer-test-models-cube-author.json';
  const authorEvidence = await read(authorEvidencePath);
  if (hash(authorEvidence) !== 'b2a1f6fecd268b57021d59acef8c5a86827e9e12db99bbffce2f149141a70f7c') throw new Error('Review required: fixture author evidence changed.');
  const generator = await readFile(fileURLToPath(import.meta.url));
  const manifest = {
    format: 'brickwright-local-fixture-library', version: 1, capturedOn: '2026-11-13', pathBase: 'library/',
    reproduction: {command: 'npm run library:fixtures:check', generator: {path: '../scripts/generate-fixture-library.mjs', sha256: hash(generator)},
      packageLockSha256: hash(await readFile(new URL('package-lock.json', root))), manifoldWasmSha256: hash(wasm)},
    assets: [{id: 'slicer-test-models-cube-10', title: '10 mm geometric cube fixture', author: 'Ghostkeeper', version: commit,
      sourceRevision: {repositoryUrl, commit, sourceUrl: `${repositoryUrl}/blob/${commit}/basic/cube.scad`},
      authorEvidence: localFile(authorEvidencePath, authorEvidence),
      licence: {spdx: 'CC0-1.0', scope: 'asset', attribution: 'Cube by Ghostkeeper, SlicerTestModels; CC0-1.0. Voluntary credit retained.',
        evidenceUrl: `${repositoryUrl}/blob/${commit}/README.md`, localEvidence: archived.slice(1), capturedOn: '2026-11-13', review: 'accepted', reviewer: 'Codex pinned per-model origin and repository model grant audit'},
      original: {...archived[0], format: 'openscad'},
      derivatives: [{...localFile(meshPath, mesh), format: 'stl'}],
      modificationNotes: 'Unmodified editable source retained; translated by Brickwright importOpenSCAD and rendered using its CAD Script compiler and Manifold kernel. No upstream compiler executed, repair, simplification or placement applied. Source coordinates preserved. Upstream calls this a slicer fixture and explicitly excludes calibration from its scope.',
      conversion: {sourceUnits: 'mm', sourceUpAxis: 'Z', unitAssumption: 'Source cube(10) has no unit declaration. Curator assumes millimetres and Z up; source origin remains [0,0,0]. This is not upstream physical calibration certification.', toMillimetresZUp: identity},
      quality: screening.quality, measurements: {triangles: screening.triangles, boundsMm: screening.boundsMm, signedVolumeMm3: screening.signedVolumeMm3}, diagnostics: screening.diagnostics}],
  };
  return new Map([[meshPath, mesh], ['fixtures-manifest.json', json(manifest)]]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const write = process.argv.includes('--write');
  if (!write && !process.argv.includes('--check')) throw new Error('Use --write or --check.');
  for (const [path, expected] of await generateFixtureLibrary()) {
    if (write) await writeFile(new URL(`library/${path}`, root), expected);
    else if (!(await read(path)).equals(expected)) throw new Error(`Fixture differs: ${path}`);
  }
  console.log('1 editable geometric fixture reproduced; 1 passes all STL screens.');
}
