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
  ['Arrow_01', '6331d5b08292a58313a0700d31a4dc12fa841dc03c1ebf3c4c0a8450f580c3b9'],
  ['Base_cabinet_01', 'b41a38be1e986f7941331a2ec9292ef77a781e81c630c80520677f4f5a686864'],
  ['Beam_C', '4f2e948e657f8492a1014fa8bbb5b3b0837f118e7220cd6cd1aac467a1f5e517'],
  ['Bookshelf_02', 'd7c66316d756aa88ba7226e0f520a2c754fcb9cb8daaf3698c2790f8a6a80db0'],
  ['Box_Wood_01', '1815370f803d408dc710d1a96dc45d962a805155050f338e66386a09c827896a'],
  ['Chair_01', '4d71a0da78b93283c3fd9fb393daa51394cd51e73dde3c50d2a0c421f337a401'],
  ['Door_01', '985b9b8a104215e940059b4f90cdafa3cd7bfcbc89549b630b446af0e87df473'],
  ['Flange_01', 'd063442d8c210bf775eec5e3ec5872833c61440648cbee0577629c4939f2fd56'],
  ['Ladder_01', '42459e1d66d176e4534271be472528abe88b6de55ec06aca5d14a3be5d9ac4c2'],
  ['Sofa', 'c4078754ea3f646b214376acdce32df6b6eeccb043e0063587f7559a3d790b04'],
  ['Table_01', '86e1f12d8ac487b03ed840232665c17960528c9c565352fb74c245e46109db1e'],
  ['Vent_Grid', '6ada1d7850f6f10ebe6443af6cde6695d077401eccfb49c2f3a5833cfa956fb5'],
  ['Base_cabinet_02', '006437c80eb43cab07afffa2f0302f5a6a9b5a4031561987677c1ca2da0ff276'],
  ['Bed_01', '341762d6fd8f6cf85db9e7c3e8c77269337dc2abf03126ddb962305e34f99558'],
  ['Bed_02', '86e5c3303c974c02254cd42adf3e7c573d25bf3780eaf020f76ae1c8cbc7f71f'],
  ['Bench_01', 'a98ef5c2538ba30dab1259347f29fe2260f061af70a12ce5486eb1c686b923f9'],
  ['Bench_02', 'f7d216f47757cd3cb95d95c47f108e188744be9cd87c54ab1c545a212d3364f7'],
  ['Chair_02', 'e7745e1913a44223b778cea1a3bac81aa8f03f2c5a93f742ea8896b565802887'],
  ['Chair_03', 'b9790af1e3de2cc8bd95e166a2feb6cd2ce3c68c5a21c5a4a6ac5051763ec2ac'],
  ['Fireplace_01', '998ed78138fa59f239328a9a4b08f84b6477e3364a6c47057276e2abe91a8e89'],
  ['Table_02', '0ab12f0be96093ed8a91e3c42b8105c2d9039c21edae89c800f8d9a243944abf'],
  ['Table_03', '42871fd166513f17ab545d477bf54146ac018b9abeda6e6a02434511af0c0ae5'],
  ['Table_Small_01', 'e171e82747b68dcf94cc55b3da1768ac07f66eca08a1794905990a6372f206ad'],
  ['Window_01', '90bac453f7bd0f5dddedcbceaed083852d81074130be3518439db2813e6e1cde'],
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
  const count = corpusEditorSelection.length;
  console.log(`${count} selected corpus sources complete; ${count} runtime-checked editable models pass all STL screens.`);
}
