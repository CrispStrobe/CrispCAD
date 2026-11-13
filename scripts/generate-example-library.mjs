// SPDX-License-Identifier: BSD-3-Clause
// Local assets only: no network, catalogue insertion, or document/history writes.
import {createHash} from 'node:crypto';
import {readFile, writeFile, mkdir, readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {codeExamples, codeExampleProgram, createCadSession} from '../packages/core/dist/index.js';
import {createGeometryKernel, exportSTL, checkModelLibrarySTL} from '../packages/geometry/dist/index.js';

const root = new URL('../', import.meta.url);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const sourceCommit = '893ad7b0e56bcddecb5737a7f1a6d78ad9d7fcba';
const repositoryUrl = 'https://github.com/CrispStrobe/brickwright-cad';
const capturedOn = '2026-11-13';
const localFile = (path, format, bytes) => ({path, format, sha256: hash(bytes), bytes: bytes.length});

/** Build every output in memory; check mode never writes or fetches anything. */
export async function generateExampleLibrary() {
  const outputs = new Map();
  const moduleBytes = await readFile(new URL('packages/core/src/code-examples.ts', root));
  // The immutable provenance link must describe these exact original programs.
  if (hash(moduleBytes) !== '8b705fd547f68c80081f4723a3f9517558848a893a9bf98d8fc127de3c5d0a1f') {
    throw new Error('Example module changed: review and pin its committed source before updating this collection.');
  }
  const licenceBytes = await readFile(new URL('LICENSE', root));
  if (hash(licenceBytes) !== 'ed121de3496066a2ddc8c11b30b48142165ab84bdb066fee351392ecaccf36ad') {
    throw new Error('Licence changed: review the pinned asset grant before updating this collection.');
  }
  if (codeExamples.length !== 34) throw new Error('Review the collection inventory before changing its 34-example scope.');
  const wasm = await readFile(new URL('node_modules/manifold-3d/manifold.wasm', root));
  outputs.set('evidence/brickwright-examples-LICENSE.txt', licenceBytes);
  outputs.set('sources/brickwright/code-examples.ts', moduleBytes);
  const kernel = await createGeometryKernel({wasmBinary: wasm});
  const assets = [];
  for (const example of codeExamples) {
    const source = Buffer.from(`${example.source}\n`);
    const sourcePath = `sources/brickwright/${example.id}.cad`;
    const meshPath = `meshes/brickwright/${example.id}.stl`;
    const session = createCadSession();
    session.addCode(codeExampleProgram(example.id), example.title.en);
    const geometry = kernel.evaluate(session.state.document);
    const mesh = Buffer.from(exportSTL(geometry.bodies));
    const screening = await checkModelLibrarySTL(mesh, {checkedOn: capturedOn, toMillimetresZUp: identity});
    if (!screening.quality) throw new Error(`${example.id}: incomplete mesh screening`);
    outputs.set(sourcePath, source);
    outputs.set(meshPath, mesh);
    assets.push({
      id: `brickwright-${example.id}`, exampleId: example.id, version: 1,
      title: example.title.en, group: example.group,
      author: 'Christian Ströbele (CrispStrobe) / Brickwright CAD contributors',
      sourceRevision: {repositoryUrl, commit: sourceCommit,
        sourceUrl: `${repositoryUrl}/blob/${sourceCommit}/packages/core/src/code-examples.ts`},
      licence: {spdx: 'BSD-3-Clause', scope: 'asset',
        attribution: 'Copyright (c) 2026, Christian Ströbele (CrispStrobe). BSD-3-Clause; original Brickwright CAD Script example.',
        evidenceUrl: `${repositoryUrl}/blob/${sourceCommit}/LICENSE`,
        localEvidence: localFile('evidence/brickwright-examples-LICENSE.txt', 'txt', licenceBytes),
        capturedOn, review: 'accepted', reviewer: 'Brickwright original-source licence audit'},
      original: localFile(sourcePath, 'cad-script', source),
      derivatives: [localFile(meshPath, 'stl', mesh)],
      modificationNotes: 'Editable program extracted verbatim with a final newline from the pinned example module; default parameters rendered to binary STL. No repair, simplification, placement or physics qualification.',
      conversion: {sourceUnits: 'mm', sourceUpAxis: 'Z',
        unitAssumption: 'CAD Script lengths resolve to millimetres (including explicit cm/in literals); coordinates are Z up. STL retains these millimetre coordinates.',
        toMillimetresZUp: identity},
      quality: screening.quality,
      measurements: {triangles: screening.triangles, boundsMm: screening.boundsMm, signedVolumeMm3: screening.signedVolumeMm3},
      diagnostics: screening.diagnostics,
    });
  }
  const generator = await readFile(fileURLToPath(import.meta.url));
  const lock = await readFile(new URL('package-lock.json', root));
  const manifest = {format: 'brickwright-local-example-library', version: 1, capturedOn,
    pathBase: 'library/',
    reproduction: {command: 'npm run library:examples:check', generator: localFile('../scripts/generate-example-library.mjs', 'mjs', generator),
      packageLockSha256: hash(lock), manifoldWasmSha256: hash(wasm),
      sourceModule: localFile('sources/brickwright/code-examples.ts', 'typescript', moduleBytes)},
    assets};
  outputs.set('examples-manifest.json', json(manifest));
  return {outputs, manifest};
}

export async function checkOrWriteExampleLibrary(write = false) {
  const {outputs, manifest} = await generateExampleLibrary();
  const errors = [];
  for (const [path, expected] of outputs) {
    const target = new URL(`library/${path}`, root);
    if (write) { await mkdir(new URL('.', target), {recursive: true}); await writeFile(target, expected); }
    else {
      try { if (!(await readFile(target)).equals(expected)) errors.push(`${path}: differs from reproducible output`); }
      catch (error) { if (error.code === 'ENOENT') errors.push(`${path}: missing`); else throw error; }
    }
  }
  for (const directory of ['sources/brickwright', 'meshes/brickwright']) {
    for (const name of await readdir(new URL(`library/${directory}/`, root))) {
      if (!outputs.has(`${directory}/${name}`)) errors.push(`${directory}/${name}: unexpected file`);
    }
  }
  if (errors.length) throw new Error(errors.join('\n'));
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some(arg => !['--check', '--write'].includes(arg)) || process.argv.includes('--check') && process.argv.includes('--write')) {
    throw new Error('Use --check (default) or --write.');
  }
  const manifest = await checkOrWriteExampleLibrary(process.argv.includes('--write'));
  const passed = manifest.assets.filter(a => Object.values(a.quality).includes(false) === false).length;
  console.log(`${manifest.assets.length} original editable examples reproduced; ${passed} pass all STL screens; no physics qualification.`);
}
