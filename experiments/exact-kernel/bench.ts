// SPDX-License-Identifier: BSD-3-Clause
// Timing and WASM memory of the SMLib exact kernel in Node. Run: npm run bench
// Writes results/bench-<platform>-<arch>.json and prints a Markdown table.
import { mkdirSync, writeFileSync } from 'node:fs';
import { arch, cpus, loadavg, platform } from 'node:os';
import { performance } from 'node:perf_hooks';
import { cadScript, evaluateCadScript } from './src/lower-cad-script.ts';
import type { ExactKernel, ExactSolid } from '@crispcad/exact-kernel';
import { REFERENCE_PARTS } from './tests/reference-parts.fixture.ts';

const RUNS = 5;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const MB = (b: number) => +(b / 2 ** 20).toFixed(1);
const gc = (globalThis as { gc?: () => void }).gc ?? (() => {});

const rss0 = process.memoryUsage().rss;
const cpu0 = process.cpuUsage(), t0 = performance.now();
const { createSmlibKernel } = await import('@crispcad/exact-kernel');
const k: ExactKernel = await createSmlibKernel();
const loadMs = performance.now() - t0, loadCpu = process.cpuUsage(cpu0);
const afterLoad = k.memory();

/** Wall and process CPU milliseconds. The kernel is single-threaded WASM, so CPU time is the
 * better measure on a shared, loaded machine; wall time is what a user waits. */
function clock<T>(fn: () => T): { value: T; wall: number; cpu: number } {
  const c = process.cpuUsage(), w = performance.now();
  const value = fn();
  const d = process.cpuUsage(c);
  return { value, wall: performance.now() - w, cpu: (d.user + d.system) / 1000 };
}
function time<T extends ExactSolid>(build: () => T) {
  const samples: { wall: number; cpu: number }[] = [];
  let last: T | undefined;
  for (let i = 0; i < RUNS; i++) {
    last?.dispose();
    const run = clock(build);
    last = run.value;
    samples.push(run);
  }
  return { solid: last!, wall: median(samples.map(s => s.wall)), cpu: median(samples.map(s => s.cpu)), firstCpu: samples[0].cpu };
}

const rows: Record<string, unknown>[] = [];
let peakHeap = afterLoad.heap;
const record = (id: string, build: () => ExactSolid) => {
  const { solid, wall, cpu, firstCpu } = time(build);
  const mesh = clock(() => k.tessellate(solid)), step = clock(() => k.exportStep(solid));
  const mem = k.memory();
  peakHeap = Math.max(peakHeap, mem.heap);
  const r1 = (x: number) => +x.toFixed(1);
  rows.push({ id, buildCpuMs: r1(cpu), buildWallMs: r1(wall), firstBuildCpuMs: r1(firstCpu), volume: k.volume(solid), triangles: mesh.value.indices.length / 3, tessellateCpuMs: r1(mesh.cpu), tessellateWallMs: r1(mesh.wall), stepKB: r1(step.value.length / 1024), stepCpuMs: r1(step.cpu), usedMB: MB(mem.used) });
  solid.dispose();
};

for (const part of REFERENCE_PARTS) record(part.id, () => evaluateCadScript(k, cadScript(part.source)));
const sum = (key: string) => +REFERENCE_PARTS.reduce((s, p) => s + (rows.find(r => r.id === p.id)![key] as number), 0).toFixed(0);

const holes = 'return subtract(move([50, 40, 2.5], box(100, 80, 5)), forRange(i, 0, 7, 1, forRange(j, 0, 5, 1, move([10 + 11.5 * i, 10 + 12 * j, 2.5], cylinder(2, 7, 48)))));';
record('stress: plate-48-holes', () => evaluateCadScript(k, cadScript(holes)));
record('stress: filleted-shelled-box', () => k.scope(() => k.shell(k.fillet(k.box([60, 40, 30]), 4), 2, [0, 0, 1])));
record('stress: 12-fillet bracket', () => k.scope(() => k.fillet(evaluateCadScript(k, cadScript('return subtract(union(move([20, 10, 4], box(40, 20, 8)), move([4, 10, 18], box(8, 20, 20))), move([25, 10, 4], cylinder(3, 10, 48)));')), 1, 'all')));

gc(); await new Promise(r => setTimeout(r, 50)); gc();
const end = k.memory();
const result = {
  date: new Date().toISOString().slice(0, 10),
  node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0]?.model, loadAverage1m: +loadavg()[0].toFixed(0),
  kernel: `${k.name}@${k.version}`, runsPerPart: RUNS,
  loadWallMs: +loadMs.toFixed(0), loadCpuMs: +((loadCpu.user + loadCpu.system) / 1000).toFixed(0),
  scorecard: { buildCpuMs: sum('buildCpuMs'), buildWallMs: sum('buildWallMs'), tessellateCpuMs: sum('tessellateCpuMs'), stepCpuMs: sum('stepCpuMs') },
  memory: { heapAfterLoadMB: MB(afterLoad.heap), peakHeapMB: MB(peakHeap), usedAfterDisposeMB: MB(end.used), liveHandlesAfterDispose: end.handles, processRssDeltaMB: MB(process.memoryUsage().rss - rss0) },
  rows,
};
mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
writeFileSync(new URL(`./results/bench-${platform()}-${arch()}.json`, import.meta.url), JSON.stringify(result, null, 1) + '\n');

console.log(`${result.kernel} on Node ${result.node} ${result.platform}/${result.arch} (${result.cpu}), load average ${result.loadAverage1m}`);
console.log(`load ${result.loadWallMs} ms wall / ${result.loadCpuMs} ms CPU; 27-part scorecard (sums of medians, ms) ${JSON.stringify(result.scorecard)}; memory ${JSON.stringify(result.memory)}`);
console.log('\n| Part | Build CPU ms (median; first) | Build wall ms | Tessellate CPU ms (triangles) | STEP CPU ms (KB) |\n| --- | --- | --- | --- | --- |');
for (const r of rows) console.log(`| ${r.id} | ${r.buildCpuMs}; ${r.firstBuildCpuMs} | ${r.buildWallMs} | ${r.tessellateCpuMs} (${r.triangles}) | ${r.stepCpuMs} (${r.stepKB}) |`);
