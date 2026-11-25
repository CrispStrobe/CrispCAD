// SPDX-License-Identifier: BSD-3-Clause
// The product path in Node, matching tests/browser/exact-kernel.spec.ts: the 27 reference parts
// as one document (code objects 400 mm apart), through @brickwright/cad-exact: kernel load,
// measure exact (cold and warm), export step. Writes results/node-product-<os>-<arch>.json.
//   npm run build:packages && node experiments/exact-kernel/product-bench.ts
import { writeFileSync } from 'node:fs';
import { cpuUsage, memoryUsage } from 'node:process';
import { createCadSession } from '@brickwright/cad-core';
import { createExactBackend } from '@brickwright/cad-exact';
import { REFERENCE_PARTS } from './tests/reference-parts.fixture.ts';

const session = createCadSession();
REFERENCE_PARTS.forEach((part, i) => session.addCode({ version: 1, language: 'brickwright-cad-script', parameters: {}, source: part.source }, part.id, { position: [(i % 9) * 400, Math.floor(i / 9) * 400, 0] }));
const document = session.state.document;
const time = <T>(run: () => T | Promise<T>) => async () => {
  const wall = performance.now(), cpu = cpuUsage(), value = await run();
  const used = cpuUsage(cpu);
  return { value, wallMs: Math.round(performance.now() - wall), cpuMs: Math.round((used.user + used.system) / 1000) };
};
const rss = memoryUsage().rss;
const load = await time(() => createExactBackend())();
const backend = load.value;
const cold = await time(() => backend.measure(document))();
const warm = await time(() => backend.measure(document))();
const step = await time(() => backend.exportStep(document))();
for (const [i, body] of cold.value.bodies.entries()) {
  const expected = REFERENCE_PARTS[i].volume;
  if (Math.abs(body.volume - expected) / expected > 1e-6) throw new Error(`${body.name}: ${body.volume} != ${expected}`);
}
const result = {
  project: 'node', node: process.version, date: new Date().toISOString(), parts: REFERENCE_PARTS.length,
  load: { wallMs: load.wallMs, cpuMs: load.cpuMs },
  coldMeasure: { wallMs: cold.wallMs, cpuMs: cold.cpuMs },
  warmMeasure: { wallMs: warm.wallMs, cpuMs: warm.cpuMs },
  exportStep: { wallMs: step.wallMs, cpuMs: step.cpuMs, stepBytes: step.value.bytes },
  wasmMemoryMiB: Math.round(backend.kernel.memory().heap / 1048576),
  rssGrowthMiB: Math.round((memoryUsage().rss - rss) / 1048576),
  liveHandles: backend.kernel.memory().handles,
};
console.log(JSON.stringify(result));
writeFileSync(new URL(`results/node-product-${process.platform}-${process.arch}.json`, import.meta.url), JSON.stringify(result, null, 2) + '\n');
