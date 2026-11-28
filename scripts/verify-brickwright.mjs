// Read-only integration proof against a separate real Brickwright checkout.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { strFromU8, unzipSync } from 'fflate';
import { attachCadProject, extractCadProject } from '@brickwright/cad-brickwright';
import { CAD_SCRIPT_REVISION, EXACT_DRAWING_DOCUMENT_VERSION, GDT_DRAWING_DOCUMENT_VERSION, SPLIT_DOCUMENT_VERSION, activeRoots, configuredDocument, createCadSession, createCommandRunner, createDocument, explodeOffsets, identityTransform, parseDocument, runStepImport, serializeDocument, staleExactFeatures } from '@brickwright/cad-core';
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
 // Document version 48 (exact drawing sheet settings): an assembly sheet of the drilled plate that
 // keeps "Exact edges (B-rep)" and automatic dimensions; the loaded sheet still has both.
 const sheeted = createCadSession(v47);
 const sheetId = sheeted.saveDrawingSheet({ title: 'Plate', source: { kind: 'assembly' }, scale: '1:1', hiddenLines: true, exactEdges: true, autoDimensions: true });
 assert.equal(EXACT_DRAWING_DOCUMENT_VERSION, 48);
 const v48 = await roundTrip(sheeted, 48);
 assert.deepEqual(v48.drawings?.map(sheet => [sheet.id, sheet.exactEdges, sheet.autoDimensions]), [[sheetId, true, true]]);
 assert.ok(Math.abs(manifold.evaluate(v48).bodies[0].volume - drilledVolume) < 1e-6, 'the sheet does not change the model');
 console.log('PASS: document version 48 (exact drawing sheet: exact edges and automatic dimensions) survives the real Brickwright SB3 writer and loader unchanged and parses with this SDK.');
 // Document version 49 (split by plane): both sides of a 30 x 30 x 10 block cut at z = 4 are split
 // nodes on the same source; the loaded document displays them with Manifold and the exact kernel
 // measures them.
 const cut = createCadSession();
 const slab = cut.add({ kind: 'box', size: [30, 30, 10] }, { name: 'Slab', transform: { ...identityTransform(), position: [0, 0, 5] } });
 const sides = cut.splitBody(slab, { normal: [0, 0, 1], offset: 4 });
 assert.equal(SPLIT_DOCUMENT_VERSION, 49); assert.equal(sides.length, 2);
 const v49 = await roundTrip(cut, 49);
 assert.deepEqual(v49.roots, sides); assert.ok(sides.every(id => v49.nodes[id].kind === 'split' && v49.nodes[id].source === slab));
 const halves = manifold.evaluate(v49).bodies.map(body => body.volume), exactHalves = exactBackend.measure(v49).bodies.map(body => body.volume);
 for (const [shown, expected] of [[halves, [5400, 3600]], [exactHalves, [5400, 3600]]]) shown.forEach((volume, i) => assert.ok(Math.abs(volume - expected[i]) < 1e-6, `split side ${i}: ${volume} mm³, expected ${expected[i]}`));
 console.log('PASS: document version 49 (split by plane) survives the real Brickwright SB3 writer and loader unchanged, parses with this SDK and displays both sides (Manifold and exact: 5400 + 3600 mm³).');
 // Document version 50 (assembly block): a nested group, an exploded view, two configurations and a
 // suppressed body, plus an assembly sheet drawn in the exploded view. The loaded document keeps the
 // block, leaves the suppressed body out of the model, and switches configurations.
 const bench = createCadSession();
 bench.setParametric({ version: 1, parameters: { width: { expression: '10 mm', unit: 'mm' } }, bindings: [] });
 const baseBox = bench.add({ kind: 'box', size: [10, 10, 10] }, { name: 'Base', transform: { ...identityTransform(), position: [0, 0, 5] } });
 const lid = bench.add({ kind: 'box', size: [10, 10, 10] }, { name: 'Lid', transform: { ...identityTransform(), position: [0, 0, 15] } });
 const pin = bench.add({ kind: 'cylinder', radius: 2, height: 10, segments: 48 }, { name: 'Pin', transform: { ...identityTransform(), position: [20, 0, 5] } });
 bench.setParametric({ ...bench.state.document.parametric, bindings: [{ nodeId: baseBox, property: 'width', expression: 'width' }] });
 const housing = bench.groupBodies('Housing', [baseBox, lid]); const hardware = bench.groupBodies('Hardware', [pin], { parent: housing });
 const assemblyHost = { bounds: async doc => manifold.evaluate(doc).bodies.map(body => ({ id: body.id, bounds: body.bounds })) };
 const benchRunner = createCommandRunner(bench, { assembly: assemblyHost });
 await benchRunner.runAsync('explode auto axis +z spacing 12 group Housing');
 const viewId = bench.state.document.assembly.views[0].id;
 bench.saveDrawingSheet({ title: 'Exploded', source: { kind: 'assembly' }, scale: '1:1', hiddenLines: false, explode: { view: viewId, factor: 1 } });
 benchRunner.run('config save Narrow');
 bench.setParametric({ ...bench.state.document.parametric, parameters: { width: { expression: '25 mm', unit: 'mm' } } });
 benchRunner.run('suppress Pin'); benchRunner.run('config save "Wide, no pin"');
 const v50 = await roundTrip(bench, 50);
 assert.deepEqual(v50.assembly, bench.state.document.assembly);
 assert.deepEqual(v50.assembly.groups.map(group => [group.id, group.name, group.members, group.parent]), [[housing, 'Housing', [baseBox, lid], undefined], [hardware, 'Hardware', [pin], housing]]);
 assert.deepEqual(v50.assembly.suppressed, [pin]); assert.deepEqual(activeRoots(v50), [baseBox, lid]);
 assert.deepEqual(configuredDocument(v50).roots, [baseBox, lid]);
 assert.deepEqual(v50.assembly.configurations.map(config => config.name), ['Narrow', 'Wide, no pin']);
 assert.deepEqual(v50.drawings?.[0].explode, { view: viewId, factor: 1 });
 const offsets = explodeOffsets(v50, viewId, 1); assert.ok(offsets.size > 0 && [...offsets.values()].every(offset => offset[0] === 0 && offset[1] === 0 && offset[2] > 0), 'exploded along +z');
 const shownBench = manifold.evaluate(v50).bodies; assert.deepEqual(shownBench.map(body => body.id), [baseBox, lid]);
 assert.ok(Math.abs(shownBench[0].volume - 2500) < 1e-6, `wide base ${shownBench[0].volume} mm³`);
 const reopened = createCadSession(v50); createCommandRunner(reopened).run('config use Narrow');
 assert.deepEqual(activeRoots(reopened.state.document), [baseBox, lid, pin]);
 assert.ok(Math.abs(manifold.evaluate(reopened.state.document).bodies[0].volume - 1000) < 1e-6, 'narrow base');
 console.log(`PASS: document version 50 (assembly: 2 nested groups, an exploded view with ${offsets.size} moved items and a sheet drawn in it, 2 configurations, 1 suppressed body) survives the real Brickwright SB3 writer and loader unchanged, parses with this SDK, leaves the suppressed body out and switches configurations.`);
 // Document version 51 (linked instances and mates): two linked instances of a bracket and a plate
 // with a bore; a coincident mate puts instance 1 on the plate and a concentric mate puts a pin in
 // the bore. The loaded document keeps one definition of the bracket (its instances follow an edit
 // of it), the exact kernel measures the instances like their part, and the mates still hold.
 const rig = createCadSession(createDocument('Rig'), { kernels }), exactHost = { run: async request => runExactRequest(exactBackend, request) };
 const plateBox = rig.add({ kind: 'box', size: [40, 40, 10] }, { name: 'Plate', transform: { ...identityTransform(), position: [0, 0, 5] } });
 const bore = rig.add({ kind: 'cylinder', radius: 3, height: 20, segments: 48 }, { name: 'Bore', transform: { ...identityTransform(), position: [10, 10, 5] } });
 rig.combine('subtract', [plateBox, bore]); const plate = rig.state.document.roots[0];
 const bracket = rig.add({ kind: 'box', size: [20, 10, 5] }, { name: 'Bracket', transform: { ...identityTransform(), position: [60, 0, 2.5] } });
 const rod = rig.add({ kind: 'cylinder', radius: 3, height: 16, segments: 48 }, { name: 'Rod', transform: { ...identityTransform(), position: [-50, 0, 8], rotation: [40, 0, 0] } });
 const rigRunner = createCommandRunner(rig, { exact: exactHost });
 rigRunner.run('instance Bracket count 2 step 0,30,0 rotate 0,0,90');
 const [firstCopy, secondCopy] = rig.state.document.roots.filter(id => rig.state.document.nodes[id].kind === 'instance');
 const faceOf = async (id, test) => { const r = await exactHost.run({ operation: 'faces', document: rig.state.document, bodies: [id] }); return r.bodies[0].faces.findIndex(test) + 1; };
 const up = f => f.surface === 'plane' && Math.abs(f.normal[2] - 1) < 1e-9, down = f => f.surface === 'plane' && Math.abs(f.normal[2] + 1) < 1e-9, round = f => f.surface === 'cylinder';
 await rigRunner.runAsync(`mate coincident ${plate} ${await faceOf(plate, up)} ${firstCopy} ${await faceOf(firstCopy, down)}`);
 await rigRunner.runAsync(`mate concentric ${plate} ${await faceOf(plate, round)} ${rod} ${await faceOf(rod, round)}`);
 const v51 = await roundTrip(rig, 51);
 assert.deepEqual(v51.assembly.mates, rig.state.document.assembly.mates); assert.equal(v51.assembly.mates.length, 2);
 assert.equal(Object.values(v51.nodes).filter(node => node.kind === 'box' && node.name === 'Bracket').length, 1, 'one definition of the bracket');
 assert.deepEqual([firstCopy, secondCopy].map(id => [v51.nodes[id].kind, v51.nodes[id].source]), [['instance', bracket], ['instance', bracket]]);
 const shownRig = new Map(manifold.evaluate(v51).bodies.map(body => [body.id, body]));
 assert.ok(Math.abs(shownRig.get(firstCopy).bounds.min[2] - 10) < 1e-6, `instance 1 sits on the plate (${shownRig.get(firstCopy).bounds.min[2]})`);
 const rodBox = shownRig.get(rod).bounds; assert.ok(Math.abs((rodBox.min[0] + rodBox.max[0]) / 2 - 10) < 1e-5 && Math.abs((rodBox.min[1] + rodBox.max[1]) / 2 - 10) < 1e-5, 'the rod is in the bore');
 const exactRig = exactBackend.measure(v51, [bracket, firstCopy, secondCopy]).bodies.map(body => body.volume);
 assert.ok(exactRig.every(volume => Math.abs(volume - 1000) < 1e-6), `exact volumes ${exactRig}`);
 const reopenedRig = createCadSession(v51, { kernels }); reopenedRig.update(bracket, { size: [20, 10, 8] });
 assert.ok([firstCopy, secondCopy].every(id => Math.abs(manifold.evaluate(reopenedRig.state.document).bodies.find(body => body.id === id).volume - 1600) < 1e-6), 'instances follow the edited part');
 assert.match((await createCommandRunner(createCadSession(v51, { kernels }), { exact: exactHost }).runAsync('mate solve').catch(error => ({ output: error.message }))).output, /2 mates hold; 0 bodies moved/);
 console.log('PASS: document version 51 (2 linked instances of one part, a coincident and a concentric mate) survives the real Brickwright SB3 writer and loader unchanged, parses with this SDK, measures the instances exactly like their part, follows an edit of the part and keeps the mates satisfied.');
 // Document version 52 (datums and tolerances on an exact sheet): datum A on the drilled plate's top
 // face, datum B on the counterbore's bore, a flatness frame on A and a position frame Ø0.1 (M) to A
 // and B, attached by stable face names from the exact kernel's drawing data; the loaded sheet keeps
 // them, and the names still resolve on the loaded model's exact B-rep.
 const faces = async doc => (await runExactRequest(exactBackend, { operation: 'drawing', document: doc, bodies: [] })).bodies.flatMap(body => body.faces);
 const holeNode = Object.values(v47.nodes).find(node => node.kind === 'hole').id, plateNode = Object.values(v47.nodes).find(node => node.kind === 'box').id;
 const v47Faces = await faces(v47);
 const topFace = v47Faces.find(face => face.name?.startsWith(plateNode + ':f') && face.surface === 'plane' && Math.abs(face.normal[2] - 1) < 1e-9)?.name;
 const boreFace = v47Faces.find(face => face.name?.startsWith(holeNode + ':f') && face.surface === 'cylinder')?.name;
 assert.ok(topFace && boreFace, 'named faces in the drawing data');
 const toleranced = createCadSession(v47);
 const datums = [{ id: 'datumA', letter: 'A', target: topFace, view: 1, at: [60, 75] }, { id: 'datumB', letter: 'B', target: boreFace, view: 0, at: [20, 160] }];
 const tolerances = [{ id: 'flat', characteristic: 'flatness', tolerance: 0.05, target: topFace, view: 1, at: [95, 72] },
  { id: 'pos', characteristic: 'position', tolerance: 0.1, diameter: true, modifier: 'M', datums: ['A', 'B'], target: boreFace, view: 0, at: [60, 165] }];
 toleranced.saveDrawingSheet({ title: 'Plate', source: { kind: 'assembly' }, scale: '1:1', hiddenLines: true, exactEdges: true, datums, tolerances });
 assert.equal(GDT_DRAWING_DOCUMENT_VERSION, 52);
 const v52 = await roundTrip(toleranced, 52);
 assert.deepEqual(v52.drawings?.[0].datums, datums); assert.deepEqual(v52.drawings?.[0].tolerances, tolerances);
 assert.deepEqual(v52.nodes, v47.nodes, 'the sheet does not change the model');
 const v52Faces = new Set((await faces(v52)).map(face => face.name));
 assert.ok(v52Faces.has(topFace) && v52Faces.has(boreFace), 'the datum faces resolve on the loaded model');
 console.log('PASS: document version 52 (2 datums and 2 tolerance frames on exact faces, by stable name) survives the real Brickwright SB3 writer and loader unchanged, parses with this SDK, leaves the model unchanged and still resolves on the exact B-rep.');
} finally { delete globalThis.localStorage; delete globalThis.window; delete globalThis.CustomEvent; }
