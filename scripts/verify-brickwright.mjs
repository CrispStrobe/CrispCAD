// Read-only integration proof against a separate real Brickwright checkout.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { strFromU8, unzipSync } from 'fflate';
import { attachCadProject, extractCadProject } from '@brickwright/cad-brickwright';
import { CAD_SCRIPT_REVISION, createCadSession, createCommandRunner, identityTransform, parseDocument, runStepImport, serializeDocument, staleExactFeatures } from '@brickwright/cad-core';
import { createExactBackend, exactKernelIdentity, runExactRequest } from '@brickwright/cad-exact';
import { createGeometryKernel } from '@brickwright/cad-geometry';
const root = resolve(process.argv[2] ?? '../local/lite-work');
const require = createRequire(resolve(root, 'package.json')); const JSZip = require('jszip');
const bundle = await import(pathToFileURL(resolve(root, 'overlay/scratch-gui/src/lib/bw-project-bundle.js')));
const { SIM_LAB_STORAGE_KEY } = await import(pathToFileURL(resolve(root, 'overlay/scratch-gui/src/lib/bw-sim/model/sim-lab-persist.js')));
const { CAD_STORAGE_KEY } = await import(pathToFileURL(resolve(root, 'overlay/scratch-gui/src/lib/bw-cad-project.js')));
const { readFile } = await import('node:fs/promises');
const ldraw = await readFile(resolve(root, 'overlay/scratch-gui/static/sim-lab/models/driving-base.ldr'), 'utf8');
const saved = new Map([[SIM_LAB_STORAGE_KEY, JSON.stringify({ name: 'Existing LEGO model', ldraw })]]);
globalThis.localStorage = { get length() { return saved.size; }, key: i => [...saved.keys()][i] ?? null, getItem: k => saved.get(k) ?? null, setItem: (k, v) => saved.set(k, String(v)), removeItem: k => saved.delete(k) };
globalThis.window = { dispatchEvent() {} }; globalThis.CustomEvent = class { constructor(type) { this.type = type; } };
try {
 const zip = new JSZip(); zip.file('project.json', JSON.stringify({ targets: [{ isStage: true, name: 'Stage', blocks: {}, costumes: [], sounds: [] }], meta: { semver: '3.0.0' } }));
 const base = new Blob([await zip.generateAsync({ type: 'uint8array' })]);
 const existing = new Uint8Array(await (await bundle.attachBrickwrightState(base)).arrayBuffer());
 const session = createCadSession(); session.add({ kind: 'box', size: [20, 30, 40] });
 const attached = attachCadProject(existing, session.state.document);
 const original = unzipSync(existing), after = unzipSync(attached);
 for (const [path, bytes] of Object.entries(original)) assert.deepEqual(after[path], bytes);
 assert.equal(serializeDocument(extractCadProject(attached)), session.serialize());
 saved.clear(); const result = await bundle.extractBrickwrightState(attached.buffer.slice(attached.byteOffset, attached.byteOffset + attached.byteLength));
 assert.notEqual(result?.outcome, 'refused'); assert.equal(JSON.parse(saved.get(SIM_LAB_STORAGE_KEY)).ldraw, ldraw);
 console.log('PASS: real Brickwright SB3 writer → CAD adapter → real Brickwright loader; LEGO model and all original entries preserved.');
 // Document version 41 (exact fillet/chamfer/shell): this SDK writes and reads it, and the
 // Brickwright bundle keeps it byte for byte. Brickwright's own CAD editor opens it only after
 // it syncs an SDK with version 41 (docs/INTEGRATION.md).
 const exact = createCadSession(); const block = exact.add({ kind: 'box', size: [20, 30, 10] });
 exact.addExactFeatures([{ source: block, settings: { operation: 'fillet', size: 2, edges: 'all' } }]);
 assert.equal(exact.state.document.version, 41);
 const v41 = attachCadProject(existing, exact.state.document);
 assert.deepEqual(extractCadProject(v41), exact.state.document);
 saved.clear(); const loaded = await bundle.extractBrickwrightState(v41.buffer.slice(v41.byteOffset, v41.byteOffset + v41.byteLength));
 assert.notEqual(loaded?.outcome, 'refused'); assert.equal(saved.get(CAD_STORAGE_KEY), exact.serialize());
 assert.deepEqual(parseDocument(saved.get(CAD_STORAGE_KEY)), exact.state.document);
 console.log('PASS: document version 41 (exact features) survives the real Brickwright SB3 writer and loader unchanged and parses with this SDK.');
 // Document version 42 (CAD Script revision 2, ruled lofts): the same byte-for-byte path. An
 // older vendored SDK refuses the version instead of triangulating the lofts (docs/INTEGRATION.md).
 const ruled = createCadSession();
 ruled.addCode({ version: CAD_SCRIPT_REVISION, language: 'brickwright-cad-script', parameters: {}, source: 'return loft([[[0,0,0],[20,0,0],[20,20,0],[0,20,0]],[[10,-4,15],[24,10,15],[10,24,15],[-4,10,15]]]);' });
 assert.equal(ruled.state.document.version, 42);
 const v42 = attachCadProject(existing, ruled.state.document);
 assert.deepEqual(extractCadProject(v42), ruled.state.document);
 saved.clear(); const loadedRuled = await bundle.extractBrickwrightState(v42.buffer.slice(v42.byteOffset, v42.byteOffset + v42.byteLength));
 assert.notEqual(loadedRuled?.outcome, 'refused'); assert.equal(saved.get(CAD_STORAGE_KEY), ruled.serialize());
 assert.deepEqual(parseDocument(saved.get(CAD_STORAGE_KEY)), ruled.state.document);
 console.log('PASS: document version 42 (ruled lofts) survives the real Brickwright SB3 writer and loader unchanged and parses with this SDK.');
 // Document version 43 (CAD Script smoothLoft): the same byte-for-byte path.
 const smooth = createCadSession();
 smooth.addCode({ version: CAD_SCRIPT_REVISION, language: 'brickwright-cad-script', parameters: {}, source: 'return smoothLoft([[[0,0,0],[20,0,0],[20,20,0],[0,20,0]],[[-2,-2,10],[22,-2,10],[22,22,10],[-2,22,10]],[[4,4,25],[16,4,25],[16,16,25],[4,16,25]]]);' });
 assert.equal(smooth.state.document.version, 43);
 const v43 = attachCadProject(existing, smooth.state.document);
 assert.deepEqual(extractCadProject(v43), smooth.state.document);
 saved.clear(); const loadedSmooth = await bundle.extractBrickwrightState(v43.buffer.slice(v43.byteOffset, v43.byteOffset + v43.byteLength));
 assert.notEqual(loadedSmooth?.outcome, 'refused'); assert.equal(saved.get(CAD_STORAGE_KEY), smooth.serialize());
 assert.deepEqual(parseDocument(saved.get(CAD_STORAGE_KEY)), smooth.state.document);
 console.log('PASS: document version 43 (smooth lofts) survives the real Brickwright SB3 writer and loader unchanged and parses with this SDK.');
 // The same byte-for-byte path for a document, then a parse with this SDK.
 const roundTrip = async (session, version) => {
  assert.equal(session.state.document.version, version);
  // As saved: a live document may hold properties set to undefined (version 47's hole physics),
  // which no file keeps.
  const expected = parseDocument(session.serialize());
  const sb3 = attachCadProject(existing, session.state.document);
  assert.deepEqual(extractCadProject(sb3), expected);
  saved.clear(); const loadedDoc = await bundle.extractBrickwrightState(sb3.buffer.slice(sb3.byteOffset, sb3.byteOffset + sb3.byteLength));
  assert.notEqual(loadedDoc?.outcome, 'refused'); assert.equal(saved.get(CAD_STORAGE_KEY), session.serialize());
  const parsed = parseDocument(saved.get(CAD_STORAGE_KEY)); assert.deepEqual(parsed, expected);
  return parsed;
 };
 const exactBackend = await createExactBackend(); const kernels = [exactKernelIdentity];
 const host = { run: async request => runExactRequest(exactBackend, request) };
 // Document version 44 (exact fillet of chosen edges): the edges are recorded as stable
 // references (the two faces each edge bounds), resolved again on the loaded document.
 const chosen = createCadSession(undefined, { kernels });
 chosen.add({ kind: 'box', size: [20, 30, 10] }, { name: 'Block', transform: { ...identityTransform(), position: [0, 0, 5] } });
 const filleted = await createCommandRunner(chosen, { exact: host }).runAsync('fillet 1 Block edges 1 4');
 assert.equal(filleted.edited, true);
 const chosenNode = chosen.state.document.nodes[chosen.state.document.roots[0]];
 assert.equal(chosenNode.kind, 'exact-feature'); assert.equal(chosenNode.edges?.references?.length, 2);
 const v44 = await roundTrip(chosen, 44);
 assert.deepEqual(staleExactFeatures(v44), []);
 const reloaded = createCadSession(v44, { kernels });
 // The references resolve on the loaded document's B-rep: the kernel rebuilds the fillet.
 const relisted = await createCommandRunner(reloaded, { exact: host }).runAsync(`edges ${v44.roots[0]}`);
 assert.equal(relisted.edited, false); assert.match(relisted.output, /Fillet of Block \(.+\): \d+ edges/);
 console.log('PASS: document version 44 (fillet of chosen edges, stable edge references) survives the real Brickwright SB3 writer and loader unchanged and parses with this SDK.');
 // Document version 45 (STEP import as exact bodies): the B-rep and the kernel's display mesh are
 // stored, so the loaded document opens and displays with Manifold alone, without the kernel.
 const part = createCadSession(); part.add({ kind: 'box', size: [20, 30, 40] }, { name: 'Part' });
 const { step } = exactBackend.exportStep(part.state.document);
 const stepSession = createCadSession(undefined, { kernels });
 const stepImport = await runStepImport(stepSession, host, { name: 'part.step', bytes: new TextEncoder().encode(step) });
 assert.equal(stepImport.ids.length, 1);
 assert.equal(stepSession.state.document.nodes[stepSession.state.document.roots[0]].kind, 'exact-body');
 const v45 = await roundTrip(stepSession, 45);
 const manifold = await createGeometryKernel({ wasmBinary: await readFile(new URL('../node_modules/manifold-3d/manifold.wasm', import.meta.url)) });
 const withoutKernel = createCadSession(v45); assert.deepEqual(withoutKernel.state.document, v45);
 const shown = manifold.evaluate(v45).bodies; assert.equal(shown.length, 1);
 assert.ok(Math.abs(shown[0].volume - 24000) / 24000 < 1e-6, `exact body displays ${shown[0].volume} mm³, expected 24000`);
 withoutKernel.dispose?.();
 console.log('PASS: document version 45 (STEP import as exact bodies) survives the real Brickwright SB3 writer and loader unchanged, parses with this SDK and opens without the kernel (Manifold displays 24000 mm³).');
 // Document version 46 (CAD Script loft pairing "closest"): the same byte-for-byte path.
 const paired = createCadSession();
 paired.addCode({ version: CAD_SCRIPT_REVISION, language: 'brickwright-cad-script', parameters: {}, source: 'return loft([[[0,0,0],[20,0,0],[20,20,0],[0,20,0]],[[20,20,15],[0,20,15],[0,0,15],[20,0,15]]], {pairing: "closest"});' });
 await roundTrip(paired, 46);
 console.log('PASS: document version 46 (loft pairing "closest") survives the real Brickwright SB3 writer and loader unchanged and parses with this SDK.');
 // Document version 47 (standard holes): a counterbored through hole in a plate, the same path,
 // then displayed by Manifold from the loaded document.
 const drilled = createCadSession();
 drilled.add({ kind: 'box', size: [30, 30, 10] }, { name: 'Plate', transform: { ...identityTransform(), position: [0, 0, 5] } });
 createCommandRunner(drilled).run('hole counterbore M4 through 10 at 0,0,10 in Plate');
 const v47 = await roundTrip(drilled, 47);
 assert.ok(Object.values(v47.nodes).some(node => node.kind === 'hole'), 'a hole node');
 const drilledVolume = manifold.evaluate(v47).bodies[0].volume;
 assert.ok(drilledVolume > 8000 && drilledVolume < 9000, `drilled plate ${drilledVolume} mm³`);
 console.log(`PASS: document version 47 (standard holes) survives the real Brickwright SB3 writer and loader unchanged, parses with this SDK and displays (${drilledVolume.toFixed(1)} mm³).`);
} finally { delete globalThis.localStorage; delete globalThis.window; delete globalThis.CustomEvent; }
