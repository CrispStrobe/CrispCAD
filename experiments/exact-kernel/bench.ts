// SPDX-License-Identifier: BSD-3-Clause
// Timing and WASM memory of the SMLib exact kernel in Node. Run: npm run bench
// Writes results/bench-<platform>-<arch>.json and prints a Markdown table.
import { mkdirSync, writeFileSync } from 'node:fs';
import { arch, cpus, loadavg, platform } from 'node:os';
import { performance } from 'node:perf_hooks';
import { cadScript, evaluateCadScript } from './src/lower-cad-script.ts';
import type { ExactKernel, ExactSolid } from './src/exact-kernel.ts';
import { REFERENCE_PARTS } from './tests/reference-parts.fixture.ts';

const RUNS = 5;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const MB = (b: number) => +(b / 2 ** 20).toFixed(1);
const gc = (globalThis as { gc?: () => void }).gc ?? (() => {});

const rss0 = process.memoryUsage().rss;
let t = performance.now();
const { createSmlibKernel } = await import('./src/smlib-kernel.ts');
const k: ExactKernel = await createSmlibKernel();
const loadMs = performance.now() - t;
const afterLoad = k.memory();

function time<T extends ExactSolid>(build: () => T) {
  const samples: number[] = [];
  let last: T | undefined;
  for (let i = 0; i < RUNS; i++) {
    last?.dispose();
    const start = performance.now();
    last = build();
    samples.push(performance.now() - start);
  }
  return { solid: last!, ms: median(samples), first: samples[0] };
}

const rows: Record<string, unknown>[] = [];
let peakHeap = afterLoad.heap;
const record = (id: string, build: () => ExactSolid) => {
  const { solid, ms, first } = time(build);
  const s0 = performance.now(), mesh = k.tessellate(solid), meshMs = performance.now() - s0;
  const e0 = performance.now(), step = k.exportStep(solid), stepMs = performance.now() - e0;
  const mem = k.memory();
  peakHeap = Math.max(peakHeap, mem.heap);
  rows.push({ id, buildMs: +ms.toFixed(1), firstBuildMs: +first.toFixed(1), volume: k.volume(solid), triangles: mesh.indices.length / 3, tessellateMs: +meshMs.toFixed(1), stepKB: +(step.length / 1024).toFixed(1), stepMs: +stepMs.toFixed(1), usedMB: MB(mem.used) });
  solid.dispose();
};

t = performance.now();
for (const part of REFERENCE_PARTS) record(part.id, () => evaluateCadScript(k, cadScript(part.source)));
const scorecardMs = REFERENCE_PARTS.reduce((s, p) => s + (rows.find(r => r.id === p.id)!.buildMs as number), 0);

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
  loadMs: +loadMs.toFixed(0),
  scorecardBuildMsSum: +scorecardMs.toFixed(0),
  memory: { heapAfterLoadMB: MB(afterLoad.heap), peakHeapMB: MB(peakHeap), usedAfterDisposeMB: MB(end.used), liveHandlesAfterDispose: end.handles, processRssDeltaMB: MB(process.memoryUsage().rss - rss0) },
  rows,
};
mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
writeFileSync(new URL(`./results/bench-${platform()}-${arch()}.json`, import.meta.url), JSON.stringify(result, null, 1) + '\n');

console.log(`${result.kernel} on Node ${result.node} ${result.platform}/${result.arch} (${result.cpu}), load average ${result.loadAverage1m}`);
console.log(`load ${result.loadMs} ms; 27-part scorecard ${result.scorecardBuildMsSum} ms (sum of medians); memory ${JSON.stringify(result.memory)}`);
console.log('\n| Part | Build ms (median / first) | Tessellate ms (triangles) | STEP ms (KB) |\n| --- | --- | --- | --- |');
for (const r of rows) console.log(`| ${r.id} | ${r.buildMs} / ${r.firstBuildMs} | ${r.tessellateMs} (${r.triangles}) | ${r.stepMs} (${r.stepKB}) |`);
