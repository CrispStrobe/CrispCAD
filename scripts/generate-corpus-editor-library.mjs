// SPDX-License-Identifier: BSD-3-Clause
// A bounded, explicit selection of locally archived sources; never crawls or downloads.
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createCadSession, createLocalModelLibraryCatalogue, importOpenSCAD, getOpenSCADImportWarnings} from '../packages/core/dist/index.js';
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
// An optional third field records an explicit upstream path outside Asset_SCAD/.
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
  ['Building_01', 'eba8bbb81ae6386c9ee6b10f3fc10fa7e03570531512cd323d5d5c86c5affb9e'],
  ['Chalkboard_02', 'a00f5ae45f5e6c3ec12593d6d13edf430e3c78fbbbe4174f8ed95c839eae20a9'],
  ['Cone_01', '269b04d28730537e908451b7f98d86db1e98688f8276c01a1ef76ec89b2771b8'],
  ['Crystal', 'e7078daf5d4400417f71b3bac879e378ffde2fb3d1502a6325ce6b579ce49357'],
  ['Key', 'f4e7eca7c681f802d4f12a863b1cea7ac2e2ec11307860f91bf78baf2cdee193'],
  ['Lamp_01', 'e071c9c40e71a53ba4e71e9181dbf2f80f9fadb8fc825fc8e4bd7a23321f5d2b'],
  ['Lever_Handle', '73bfdfda782031cc02f19beaaf09afefa8c70f0cccd7adc94e48f51c4f31952f'],
  ['Soda_Cup_01', '0c87476d81f593f5c83f7926ba252157e33db9696d2a57441f7be1aa438fb653'],
  ['Stairs_02', '145a171b992ed382f067b8bf401b2b26c55a1f1f34603b3e2ac8793fcac22a45'],
  ['Stairs_03', '4dd7b321fae87319e812f0efe2d639c276e3efa9a4cef0d34241ad02150ce3e1'],
  ['Traffic_Light', '1d2f42b407266586ae8f92e783230c5921545b85c9608395fc2a589f485a2774'],
  ['Tootbrush', '78ef474639a08e177e2d9b30c4032f4b20fbb06b9329e40f5602069e6f04c44d'],
  ['Electric_Wire_Plug', '1c3212ab39e2f94694253387fd7a87e79e6d0d997c0f5365c493bf3ef4542fd2'],
  ['Flange_03', '4e02943239e0eb8445fc45fd096e57099b23c8f1e2e9d169a6d1419214ba95e7'],
  ['Resistor', '7a996ef79fc368c1332daa8b284aafcd004090aadc2f5b7aec25f07d5beaf363'],
  ['Street_02', '9c114a059e7a07b137e11bde20c9ddc047631de9309ec8b99f2b4fc556da3060'],
  ['Street_03', '5e2efcd002e43aafc5ad52fecb0f5425413872fb0e38169ef98b45d22675ac9d'],
  ['Street_06', '68fcc501eccb2cf50fde2f2dd479569e0a3a9d8967b75a2db598d70aff4c3d88'],
  ['Sword_01', 'a45892b776435978d1b95920b6be5d885770485b7d69d15ca243b35059e26667'],
  ['x', '7f2e6f3bc1fad63176233084c00d562d81637db7b32ca667b75e5e11dee2efdb'],
  ['Banner_01', 'd81bfa138ae7a43ea33c09e6ddbd06585fd4d1fbe53336427c18f0a8c920f6a1'],
  ['Raccordo', '0ef3163346d94601be2f9bae46aaf072bc6a4e3903d88063c2ab76d63998f69d', 'Basic Example/Raccordo.scad'],
  ['Street_01', '4901bec62feb143eafb7758557b6f88942234771e06ed4a98d596d76e54da37d'],
  ['Street_05', '26b28e095a3a9d571a5842152baaf7e6a247e45d185173a1ddfd525f3d953ec8'],
  ['Street_04', '9560ea338991cc8a202a620a3ede99e199120f253dd7cff4d7d84111c376d033'],
  ['Eyebolt', 'b213df3b014b63a5387cae3d7d317a0b0b78f48d1c2876d7ff7ff45168165370'],
  ['Ladder_02', '984c71e0c8673964304653c73d9614896a55fd6da2f7e3579826532b9ac120d0'],
  ['Wall_04', 'c0c86bf56cee50e83215477ba5446999c02436718227f31023dd061596dcfa5b'],
  ['Fence_01', '4eea49150404cc80f3ba1ef96c18f7b503f7adf97e3070be24289efb5ce1460d'],
  ['Fence_02', '58464ec8083b253f64de30407e1cbc1b41a2c567239c3e4e7ed6016f120f6728'],
  ['Building_02', '33e61ca81c87958bd63eb9997d462b5ceab7efc5043837f07efbcf30da89fa3e'],
  ['Walking_Stick', 'c03f703be343096ead430017effe50e184518052f25cad0276a8a21ff8a4a986'],
  ['Ingot_01', '6f3d5d101289b7637c0f8f27b2881bde600b16cddd602bab974d82a9d937cac2'],
  ['Coin_01', '951c586e3b1b6257d90ab7feb3b4307946c379ed740368dfb4c8689f3059ad7b'],
  ['Led_01', '8aad38e223ae0cfeb7e00f3bd8e594cc3a531120b51c8ebac96d3123074071d7'],
  ['Sauce_Bottle', '5bd635f4e9179b0a9716a6ec38c4b346b989f94d48d41c7e9ab6522926f59e23'],
  ['Pipe_00', '1dcd758ab9c4f969c099ccbe6936de341a7dc004751607f2464db28cf5bb5381'],
  ['Flange_02', '9c3a3c5d4c767d2eca1fadcca92f51dc8d83c971196f2c343bda46015d0edede'],
  ['Cup_01', '12f442660d6c5fd577a5e69f9c11e0a51a4fc242cc15938d9b11113877686379'],
  ['Ring', '4123a8998c6ce0a0b3e562f3e7a12198a4542f2cccc86ce6610c3d2a034e82cf'],
  ['Pipe_90', '7ecb93cf2a98f86eed7bf94af4c6ce59f56f3ff76276406634421ba7a5ced64e'],
  ['Key_Old_01', '3d1268c24366ec678a8e18e748e1281596c9aa65a502cb5ef901da8daaf0d323'],
  ['Hole_Plate', '769b1d58cebc6678909c5fbcb299cc1ffad25af502ceb2e3f0a954cf6aeefad2'],
  ['Mech_Piece_01', '1a7a5d33362e378705d73473efec55b9d4ce08da7f78c358e1a73a9e60cf339e'],
  ['Mech_Piece_02', '1934959de53fdd98aca22ce2051ba2aedc2e0d8255ac53297eb49c7370317774'],
  ['Arc_02', '0202799423c511dc55c8caff15e5dfea1cbabd449342eee4bafb3be59104e803'],
  ['Circular_Blade', 'cb24327b57fdaf2aa12968cb23cdbac695a18e89f83e7fb8125c89bad9ea6d53'],
  ['Gear_01', 'eb63fd7b57dc965f3e1b4ba0ea44714fa76ba009935cb3459cbc88716817d97d'],
  ['Gear_02', '2abb0cd7ebc2157e780c97156587a72d897f95f0b8a6e38d7bbc7ec36f8bc6bf'],
  ['Mallet', '88884ddc1fdf9fe5ab848c118d2ea94e01e70676d72da3b3ebc432fb5b10a832'],
  ['Tower', '4855a5c04e1d79e5eff5de58a2b5866908ab3a22c31a3ec88a4f99ee12a2b26d'],
  ['Weights_01', '9d65acddd758fe6bdb0424e423caeaae6be9dc94c7a1414bc229f7198a98b0e2'],
  ['Tree_01', '31a9130ea9b53c0d503fb86aeec221ec871cb21ea96987262d846ef5ca2bc756'],
  ['Nut_LQ', 'deb3b2a4fe017c0734780512f781edb7809fe9434e72028b13a3f0a52581ea2f'],
  ['Rod_01', '11cf0a57740fc1805fe86c6a424602b0799ae0f561f573e246a0bd49abef9eaa'],
  ['Animation_Gear_02', '88e34079b1cc328209d4b2ce38a1fe38a2bfd3f57853afabe04b401cccec535f', 'Animation_SCAD/Gear_02.scad'],
  ['Animation_Mechanism_01', '2072ec9e27a91885decf095635cf0f20458f2d6c64dfe32f98062a3e067e0a7c', 'Animation_SCAD/Mechanism_01.scad'],
  ['Shaft_01', '41b9cf67da8fd47d263966280fce9af1dfcaa1e1b05e8a182d8e9cba1257aee7'],
  ['Shaft_02_With_Keyway', '7d48549ed36d24d8b399e7ffcf4e18b55bf93d2cc8bef43a17bf9cc64aa923b7'],
  ['Coin_02', '92421043b2f2c5d6574e752a5e04454b5146a39452e57d21566c193ab60799bd'],
];
// Only this admission batch gains warning metadata; earlier qualification records stay immutable.
const warningQualifiedNames = new Set(['Coin_02', 'Shaft_01', 'Shaft_02_With_Keyway', 'Hole_Plate', 'Mech_Piece_01', 'Mech_Piece_02', 'Arc_02', 'Circular_Blade', 'Gear_01', 'Gear_02', 'Mallet', 'Tower', 'Weights_01', 'Tree_01', 'Nut_LQ', 'Rod_01', 'Animation_Gear_02', 'Animation_Mechanism_01']);
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
  for (const [name, expectedHash, selectedPath] of corpusEditorSelection) {
    const upstreamPath = selectedPath ?? `Asset_SCAD/${name}.scad`;
    const record = repository.files.find(item => item.path === upstreamPath);
    const bytes = await read(`corpus/repos/${repositoryId}/${upstreamPath}`);
    if (!record || record.sha256 !== expectedHash || hash(bytes) !== expectedHash || record.size_bytes !== bytes.length || record.spdx !== 'MIT' || record.commit !== commit || record.dependency_blockers?.length || !record.license_evidence.includes('LICENSE')) throw new Error(`Review required: selected source changed: ${upstreamPath}`);
    const slug = name.toLowerCase().replace(/[ _]+/g, '-');
    const sourcePath = `sources/corpus-selection/${slug}.scad`;
    // Preserve the previous derivative bytes and their history/provenance identity.
    const meshPath = `meshes/corpus-selection/${slug}${name === 'Walking_Stick' ? '-scoped-fn-v2' : ''}.stl`;
    const title = name === 'x' ? 'Crossed cubes (x)' : name.replaceAll('_', ' ');
    const selectionNote = name === 'Coin_02' ? ' The authored unsupported text center argument is ignored with a warning; default left/baseline text alignment is retained. Text uses the bundled Droid Sans substitute; font metrics and appearance are not upstream-certified.' : ['Street_03', 'Street_06'].includes(name)
      ? ' Street 03 and Street 06 are distinct upstream source files with identical derived geometry; this collection counts source files, not unique shapes.'
      : name === 'Raccordo' ? ' OpenSCAD # highlighting is omitted; the highlighted solid geometry is retained.'
      : name === 'Pipe_00' ? ' Translation uses the fixed full-render context $preview=false, preserving the source-selected 30-segment circular profiles.'
      : name === 'Flange_02' ? ' Translation uses the fixed full-render context $preview=false and the source constant dimension selector Size=0; the authored 64-segment outer profile and four 60-segment holes are retained.'
      : ['Cup_01', 'Ring', 'Pipe_90', 'Key_Old_01'].includes(name)
        ? ' Brickwright interprets the authored two-component 3D translations [0,0] as [0,0,0]. Translation uses the fixed full-render context $preview=false. Qualification covers only the instantiated default top-level model.'
          + (['Ring', 'Pipe_90'].includes(name) ? ' Original unused repeat helpers containing an unresolved ring call are retained unchanged and are outside this qualification.' : '') : '';
    const session = createCadSession();
    const program = importOpenSCAD(bytes.toString('utf8'));
    const admissionNotes = warningQualifiedNames.has(name)
      ? ' Qualification covers only the instantiated default top-level model.'
        + (['Rod_01', 'Animation_Gear_02', 'Animation_Mechanism_01'].includes(name) ? ' The unchanged authored default is evaluated at the builtin unbound-time fallback $t=0; motion and alternate frames are not retained or qualified. Gear engagement, kinematics and mechanical performance are not certified.' : '')
        + (name === 'Animation_Mechanism_01' ? ' At $t=0 the derived mesh matches the static Key source; this collection counts source files, not unique shapes.' : '')
        + (['Weights_01', 'Tree_01', 'Nut_LQ'].includes(name) ? ' Comprehensions are converted by the bounded fixed-cardinality subset for the authored defaults; alternate cardinality choices are outside this qualification.' : '')
        + (name === 'Hole_Plate' ? ' The authored % background cube is excluded from rendered geometry; Hole_Diameter retains its authored cylinder-radius meaning.' : '')
        + ' Import warnings captured at qualification: ' + (getOpenSCADImportWarnings(program).join(' ') || 'None.')
      : '';
    session.addCode(program, title);
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
      modificationNotes: 'Byte-identical upstream editable source retained. Brickwright original bounded OpenSCAD importer translates geometry to editable CAD Script; cosmetic color wrappers are ignored. Rendered by the existing Manifold runtime and screened as STL. No upstream compiler, repair, simplification or placement applied. Not certified for manufacturing or physics.' + selectionNote + admissionNotes + (name === 'Walking_Stick' ? ' Corrected scoped $fn propagation uses a new derivative path; the earlier walking-stick.stl remains unchanged for historical provenance.' : ''),
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
  const outputs = await generateCorpusEditorLibrary();
  // Published mesh paths are immutable: corrections need an explicit new derivative path.
  if (write) for (const [path, expected] of outputs) {
    if (!path.startsWith('meshes/')) continue;
    let current;
    try { current = await read(path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (current && !current.equals(expected)) throw new Error(`Existing mesh differs; preserve ${path} and select a new derivative version path.`);
  }
  for (const [path, expected] of outputs) {
    const target = new URL(`library/${path}`, root);
    if (write) { await mkdir(dirname(fileURLToPath(target)), {recursive: true}); await writeFile(target, expected); }
    else if (!(await read(path)).equals(expected)) throw new Error(`Selected corpus output differs: ${path}`);
  }
  const count = corpusEditorSelection.length;
  console.log(`${count} selected corpus sources complete; ${count} runtime-checked editable models pass all STL screens.`);
}
