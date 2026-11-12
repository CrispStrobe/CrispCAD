// Read-only integration proof against a separate real Brickwright checkout.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { strFromU8, unzipSync } from 'fflate';
import { attachCadProject, extractCadProject } from '@brickwright/cad-brickwright';
import { createCadSession, serializeDocument } from '@brickwright/cad-core';
const root = resolve(process.argv[2] ?? '../local/lite-work');
const require = createRequire(resolve(root, 'package.json')); const JSZip = require('jszip');
const bundle = await import(pathToFileURL(resolve(root, 'overlay/scratch-gui/src/lib/bw-project-bundle.js')));
const { SIM_LAB_STORAGE_KEY } = await import(pathToFileURL(resolve(root, 'overlay/scratch-gui/src/lib/bw-sim/model/sim-lab-persist.js')));
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
} finally { delete globalThis.localStorage; delete globalThis.window; delete globalThis.CustomEvent; }
