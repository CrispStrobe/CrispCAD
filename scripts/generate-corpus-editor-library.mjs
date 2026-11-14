// SPDX-License-Identifier: BSD-3-Clause
// A bounded, explicit selection of locally archived sources; never crawls or downloads.
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createCadSession, createLocalModelLibraryCatalogue, importOpenSCAD} from '../packages/core/dist/index.js';
import {createGeometryKernel, exportSTL, checkModelLibrarySTL} from '../packages/geometry/dist/index.js';

const root = new URL('../', import.meta.url);
const repositoryId = 'AngeloNicoli--OpenSCAD-Snippet';
const repositoryUrl = 'https://github.com/AngeloNicoli/OpenSCAD-Snippet';
const commit = '4f9e3d4d16b5e427186c1f89e10c2181c437dee6';
const evidenceHash = '87a0009986b86613038e43d55c995a3fcb2103ddd5f05446993a4c47c9a4991d';
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = path => readFile(new URL(`library/${path}`, root));
const file = (path, bytes) => ({path, sha256: hash(bytes), bytes: bytes.length});
// Upstream basenames and hashes are deliberately pinned, not inferred from a glob.
export const corpusEditorSelection = [
  ['Beam_Angular', '8142509187db00f7fb9ff29d724860057f08635dbc5f53c1e5c886f369c1c167'],
  ['Beam_H', '153a723f5a51db683a5e3ec6ead8335cba4b97d3f594371e816460a3fcb2cf21'],
  ['Key_Simple', '524aec01efaf1757485c8855d74c77599d07c6c06e6972a6273f13d974650200'],
  ['Roll_Holder', '321dc8517eb2a5ae2a6f8ef2779a8103b800843911f5e828905310ac2b4ee17e'],
  ['Angle Shelf', 'c6f96091369c15109983dc38858360770412f2796b806ac8950bb02ddc8b33a8'],
  ['Sign_01', '6d4e32ed84be5cbebc2c770479a6b0335d7a60d12f65c1baa217c342770534e0'],
  ['Sign_02', 'a38bc139438edd67eeb04e9b101b493cc36bbed1d238d9b4220a9f698a4f186f'],
  ['Washer', '0549eed9f9084c2b96c6ff38b1078648a2a251f6eac3be014a21643a29489aa8'],
  ['Transistor', '05a5aaee99cbacf9d841368a3155911e7ee8959cdbedbcd69c793bc03f29c868'],
  ['Stairs_01', '051e38d01a320faf319723e8dc257eb3df35e365b82c5226cec05c410f990b08'],
  ['Bookshelf_01', '6ec7ca3193e9821ee281e8ea1c8183fc418892b38b6701863be77cbaf209631e'],
  ['Chalkboard_01', '23c77731a79447bc6ad6a5d74e9e7c77ccb852bc63056cf23b236ec4f2de80b6'],
];
export async function generateCorpusEditorLibrary() {
  const corpus = JSON.parse((await read('corpus/manifest.json')).toString());
  const repository = corpus.repositories.find(item => item.id === repositoryId);
  if (!repository || repository.commit !== commit || repository.url !== repositoryUrl || repository.license !== 'MIT') throw new Error('Review required: selected corpus repository identity changed.');
  const evidence = await read(`corpus/repos/${repositoryId}/LICENSE`);
  const evidenceRecord = repository.files.find(item => item.path === 'LICENSE');
  if (hash(evidence) !== evidenceHash || evidenceRecord?.sha256 !== evidenceHash || evidenceRecord.size_bytes !== evidence.length) throw new Error('Review required: selected corpus licence evidence changed.');
  const evidencePath = 'evidence/corpus-selection-MIT-LICENSE.txt';
  const outputs = new Map([[evidencePath, evidence]]);
  const wasm = await readFile(new URL('node_modules/manifold-3d/manifold.wasm', root));
  const kernel = await createGeometryKernel({wasmBinary: wasm});
  const assets = [];
  for (const [name, expectedHash] of corpusEditorSelection) {
    const upstreamPath = `Asset_SCAD/${name}.scad`;
    const record = repository.files.find(item => item.path === upstreamPath);
    const bytes = await read(`corpus/repos/${repositoryId}/${upstreamPath}`);
    if (!record || record.sha256 !== expectedHash || hash(bytes) !== expectedHash || record.size_bytes !== bytes.length || record.spdx !== 'MIT' || record.commit !== commit || record.dependency_blockers?.length || !record.license_evidence.includes('LICENSE')) throw new Error(`Review required: selected source changed: ${upstreamPath}`);
    const slug = name.toLowerCase().replace(/[ _]+/g, '-');
    const sourcePath = `sources/corpus-selection/${slug}.scad`;
    const meshPath = `meshes/corpus-selection/${slug}.stl`;
    const title = name.replaceAll('_', ' ');
    const session = createCadSession();
    session.addCode(importOpenSCAD(bytes.toString('utf8')), title);
    const evaluated = kernel.evaluate(session.state.document);
    if (!evaluated.bodies.length || !(evaluated.volume > 0)) throw new Error(`Selected source produced no positive solid: ${name}`);
    const mesh = Buffer.from(exportSTL(evaluated.bodies));
    const screening = await checkModelLibrarySTL(mesh, {checkedOn: '2026-11-14', toMillimetresZUp: identity, maxTriangles: 10000, maxExtentMm: 200});
    if (!screening.quality || Object.values(screening.checks).some(result => result !== 'pass')) throw new Error(`Selected mesh screening failed: ${name}: ${JSON.stringify(screening.diagnostics)}`);
    outputs.set(sourcePath, bytes);
    outputs.set(meshPath, mesh);
    assets.push({
      id: `corpus-angelo-${slug}`, title, author: record.author_attribution, version: commit,
      sourceRevision: {repositoryUrl, commit, sourceUrl: record.source_url},
      corpusSelection: {repositoryId, upstreamPath, archivedPath: `corpus/repos/${repositoryId}/${upstreamPath}`, sha256: expectedHash},
      licence: {spdx: 'MIT', scope: 'asset', attribution: `${record.author_attribution}. Source: ${record.source_url}. ${evidence.toString('utf8').replace(/\s+/g, ' ').trim()}`,
        evidenceUrl: evidenceRecord.source_url, localEvidence: [{...file(evidencePath, evidence), url: evidenceRecord.source_url}], capturedOn: repository.captured_at,
        review: 'accepted', reviewer: `${repository.reviewed_by}; explicit standalone editor selection and runtime screening 2026-11-14`},
      original: {...file(sourcePath, bytes), url: record.source_url, format: 'openscad'},
      derivatives: [{...file(meshPath, mesh), format: 'stl'}],
      modificationNotes: 'Byte-identical upstream editable source retained. Brickwright original bounded OpenSCAD importer translates geometry to editable CAD Script; cosmetic color wrappers are ignored. Rendered by the existing Manifold runtime and screened as STL. No upstream compiler, repair, simplification or placement applied. Not certified for manufacturing or physics.',
      conversion: {sourceUnits: 'mm', sourceUpAxis: 'Z', unitAssumption: 'The source has no explicit unit declaration. Curator assumes millimetres and Z up; original coordinates are preserved. This is not upstream dimensional certification.', toMillimetresZUp: identity},
      quality: screening.quality, measurements: {triangles: screening.triangles, boundsMm: screening.boundsMm, signedVolumeMm3: screening.signedVolumeMm3}, diagnostics: screening.diagnostics,
    });
  }
  const generator = await readFile(fileURLToPath(import.meta.url));
  const manifest = {format: 'brickwright-local-fixture-library', version: 1, collection: 'selected-source-corpus', capturedOn: '2026-11-14', pathBase: 'library/',
    reproduction: {command: 'node scripts/generate-corpus-editor-library.mjs --check', generator: {path: '../scripts/generate-corpus-editor-library.mjs', sha256: hash(generator)}, packageLockSha256: hash(await readFile(new URL('package-lock.json', root))), manifoldWasmSha256: hash(wasm)},
    selection: {repositoryId, commit, count: assets.length, runtimeChecked: assets.length, complete: true}, assets};
  createLocalModelLibraryCatalogue(manifest);
  outputs.set('editor-corpus-manifest.json', Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
  return outputs;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const write = process.argv.includes('--write');
  if (!write && !process.argv.includes('--check')) throw new Error('Use --write or --check.');
  for (const [path, expected] of await generateCorpusEditorLibrary()) {
    const target = new URL(`library/${path}`, root);
    if (write) { await mkdir(dirname(fileURLToPath(target)), {recursive: true}); await writeFile(target, expected); }
    else if (!(await read(path)).equals(expected)) throw new Error(`Selected corpus output differs: ${path}`);
  }
  console.log('12 selected corpus sources complete; 12 runtime-checked editable models pass all STL screens.');
}
