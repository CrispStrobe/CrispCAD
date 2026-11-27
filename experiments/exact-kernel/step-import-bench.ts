// SPDX-License-Identifier: BSD-3-Clause
// STEP import as exact bodies on the product path (@brickwright/cad-exact `importStep`: strict
// read, the stored B-rep written and read back, display tessellation), then a warm `measure exact`
// of the imported document (the B-rep cache) and its Manifold-free size. Files: STEP written by
// our exporter (box, filleted box, drilled plate) and real-world files that are already in this
// repository under permissive licences (library/sources: Adafruit, MIT).
// Writes results/step-import-<os>-<arch>.json.
//   npm run build:packages && node experiments/exact-kernel/step-import-bench.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { cpuUsage } from 'node:process';
import { createCadSession, createCommandRunner, runStepImport, serializeDocument } from '@brickwright/cad-core';
import type { ExactCommandHost } from '@brickwright/cad-core';
import { createExactBackend, exactKernelIdentity, runExactRequest } from '@brickwright/cad-exact';

const backend = await createExactBackend();
const host: ExactCommandHost = { run: async request => runExactRequest(backend, request) };
const kernels = [exactKernelIdentity];
async function ours(name: string, build: (s: ReturnType<typeof createCadSession>) => Promise<void> | void) {
  const s = createCadSession(undefined, { kernels });
  await build(s);
  return { name, bytes: new TextEncoder().encode(backend.exportStep(s.state.document).step), source: 'CrispCAD exact export' };
}
const files = [
  await ours('box.step', s => { s.add({ kind: 'box', size: [20, 30, 10] }); }),
  await ours('filleted-box.step', async s => { s.add({ kind: 'box', size: [20, 30, 10] }, { name: 'Block' }); await createCommandRunner(s, { exact: host }).runAsync('fillet 2 Block'); }),
  await ours('plate-12-holes.step', s => {
    const loops = [{ kind: 'outline', id: 'outline', points: [[0, 0], [100, 0], [100, 100], [0, 100]] }, ...Array.from({ length: 12 }, (_, i) => ({ kind: 'circle', id: `hole${i}`, center: [12.5 + (i % 4) * 25, 15 + Math.floor(i / 4) * 35], radius: 3, segments: 64 }))];
    s.addSketchExtrusion({ kind: 'region', id: 'plate', loops } as never, { distance: 5 });
  }),
  ...['adafruit-electronics/830 Battery Holder 4xAA.step', 'adafruit-motors/711 DC Toy Motor/711 DC Toy Motor.step', 'adafruit-motors/3777 TT Motor/3777 TT Motor.step', 'adafruit-electronics/4884 Feather RP2040.step']
    .map(path => ({ name: path.split('/').pop()!, bytes: new Uint8Array(readFileSync(`library/sources/${path}`)), source: 'Adafruit_CAD_Parts (MIT)' })),
];
const rows = [];
for (const file of files) {
  const session = createCadSession(undefined, { kernels }), wall = performance.now(), cpu = cpuUsage();
  try {
    const done = await runStepImport(session, host, file);
    const used = cpuUsage(cpu), importMs = Math.round(performance.now() - wall);
    const warm = performance.now(); backend.measure(session.state.document);
    const doc = session.state.document, bodies = done.ids.map(id => doc.nodes[id]).filter(n => n.kind === 'exact-body');
    rows.push({
      file: file.name, source: file.source, kib: Math.round(file.bytes.byteLength / 1024), bodies: bodies.length, importWallMs: importMs, importCpuMs: Math.round((used.user + used.system) / 1000),
      warmMeasureMs: Math.round(performance.now() - warm),
      storedBrepKiB: Math.round(bodies.reduce((sum, n) => sum + (n.kind === 'exact-body' ? n.brep.text.length : 0), 0) / 1024),
      triangles: bodies.reduce((sum, n) => sum + (n.kind === 'exact-body' ? n.display.indices.length / 3 : 0), 0),
      documentKiB: Math.round(new TextEncoder().encode(serializeDocument(doc)).byteLength / 1024),
    });
  } catch (error) {
    rows.push({ file: file.name, source: file.source, kib: Math.round(file.bytes.byteLength / 1024), refused: error instanceof Error ? error.message : String(error), wallMs: Math.round(performance.now() - wall) });
  }
  console.log(JSON.stringify(rows.at(-1)));
  session.dispose();
}
const result = { node: process.version, date: new Date().toISOString(), kernel: backend.info, wasmMemoryMiB: Math.round(backend.kernel.memory().heap / 1048576), rows };
writeFileSync(new URL(`results/step-import-${process.platform}-${process.arch}.json`, import.meta.url), JSON.stringify(result, null, 1) + '\n');
