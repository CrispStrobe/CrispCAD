// SPDX-License-Identifier: BSD-3-Clause
// Where the CPU time of STEP import as exact bodies goes, phase by phase, and the import before and
// after 2026-11-27's speed-up, measured in one run on the same bodies (so a loaded machine slows
// both alike):
//   read file    the kernel's strict read of the whole file (importStepBodies)
//   measures     volume, area and exact box of each body
//   export step  each body re-written as one-solid STEP (the stored B-rep)
//   read back    that STEP read again and measured (import checked it until 2026-11-27; now the
//                first exact request that reads the stored B-rep checks it against the measures)
//   display      the display tessellation and its weld/closure check, at the exact features'
//                tolerance (0.01 mm, 10°, before) and at STEP_IMPORT_DISPLAY_TOLERANCE (after)
//   npm run build:packages && node experiments/exact-kernel/step-import-profile.ts [file.step ...]
// Writes results/step-import-profile-<os>-<arch>.json when run without arguments.
import { readFileSync, writeFileSync } from 'node:fs';
import { cpuUsage } from 'node:process';
import { EXACT_DISPLAY_TOLERANCE, STEP_IMPORT_DISPLAY_TOLERANCE } from '@brickwright/cad-core';
import { createSmlibKernel } from '@crispcad/exact-kernel';
import { displayTessellation } from '@brickwright/cad-exact';

const k = await createSmlibKernel();
const defaults = ['adafruit-electronics/830 Battery Holder 4xAA.step', 'adafruit-motors/711 DC Toy Motor/711 DC Toy Motor.step', 'adafruit-motors/3777 TT Motor/3777 TT Motor.step', 'adafruit-electronics/4884 Feather RP2040.step'].map(path => `library/sources/${path}`);
const files = process.argv.slice(2).length ? process.argv.slice(2) : defaults;
const rows = [];
for (const file of files) {
  const bytes = new Uint8Array(readFileSync(file)), cpu: Record<string, number> = {};
  const time = <T>(phase: string, fn: () => T): T => { const c = cpuUsage(); try { return fn(); } finally { const u = cpuUsage(c); cpu[phase] = (cpu[phase] ?? 0) + (u.user + u.system) / 1000; } };
  let before = 0, after = 0;
  const row = k.scope(() => {
    const read = time('read file', () => k.importStepBodies(bytes, { maxBodies: 64 }));
    for (const { solid } of read.bodies) {
      time('measures', () => { k.volume(solid); k.area(solid); k.bbox(solid); });
      const text = time('export step', () => k.exportStep(solid));
      time('read back', () => { const b = k.importStepBodies(text, { maxBodies: 1 }).bodies[0].solid; k.volume(b); k.area(b); k.bbox(b); });
      before += time('display before', () => displayTessellation(k, solid, 'body', EXACT_DISPLAY_TOLERANCE)).indices.length / 3;
      after += time('display after', () => displayTessellation(k, solid, 'body', STEP_IMPORT_DISPLAY_TOLERANCE)).indices.length / 3;
    }
    const common = cpu['read file'] + cpu.measures + cpu['export step'];
    return {
      file: file.split('/').pop(), kib: Math.round(bytes.byteLength / 1024), bodies: read.bodies.length,
      cpuMs: Object.fromEntries(Object.entries(cpu).map(([p, v]) => [p, Math.round(v)])),
      importBeforeMs: Math.round(common + cpu['read back'] + cpu['display before']), importAfterMs: Math.round(common + cpu['display after']),
      trianglesBefore: before, trianglesAfter: after,
    };
  });
  console.log(JSON.stringify(row));
  rows.push(row);
}
if (!process.argv.slice(2).length) writeFileSync(new URL(`results/step-import-profile-${process.platform}-${process.arch}.json`, import.meta.url), JSON.stringify({ node: process.version, date: new Date().toISOString(), kernel: k.version, before: EXACT_DISPLAY_TOLERANCE, after: STEP_IMPORT_DISPLAY_TOLERANCE, rows }, null, 1) + '\n');
