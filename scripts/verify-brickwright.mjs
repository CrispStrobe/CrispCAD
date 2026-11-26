// Read-only integration proof against a separate real Brickwright checkout.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { strFromU8, unzipSync } from 'fflate';
import { attachCadProject, extractCadProject } from '@brickwright/cad-brickwright';
import { CAD_SCRIPT_REVISION, createCadSession, parseDocument, serializeDocument } from '@brickwright/cad-core';
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
} finally { delete globalThis.localStorage; delete globalThis.window; delete globalThis.CustomEvent; }
