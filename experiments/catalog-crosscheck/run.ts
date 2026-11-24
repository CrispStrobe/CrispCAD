// SPDX-License-Identifier: BSD-3-Clause
// Three-way catalog cross-check harness (Phase 4 of docs/CRISPCAD-CONVERGENCE.md).
//   node run.ts --catalog <dir> [--sample 300 | --all] [--seed crosscheck-1] [--jobs 3]
//               [--timeout 300] [--name sample-300] [--native native.json] [--lab-commit sha]
// Converts each licence-admitted kernelCAD model to CAD Script, builds every part with
// Manifold and with the SMLib exact kernel in worker processes, and appends one JSON line per
// model to results/<name>.jsonl (resumable: models already in the file are skipped). Then
// summarize.ts writes results/<name>-summary.{json,md}.
import { fork, type ChildProcess } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';
import { listCatalog, stratifiedSample, type CatalogEntry } from './src/sample.ts';
import { summarize } from './summarize.ts';

const args = process.argv.slice(2);
const flag = (name: string, fallback?: string) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const catalog = flag('catalog');
if (!catalog) { process.stderr.write('Usage: node run.ts --catalog <kernelCAD catalog/kits dir> [--sample N | --all] [--seed s] [--jobs n] [--timeout s] [--name n] [--native file] [--lab-commit sha]\n'); process.exit(1); }
const all = args.includes('--all'), size = Number(flag('sample', '300')), seed = flag('seed', 'crosscheck-1')!;
const jobs = Number(flag('jobs', '3')), timeoutMs = Number(flag('timeout', '300')) * 1000, restartEvery = Number(flag('restart-every', '40'));
const name = flag('name', all ? 'full' : `sample-${size}`)!;
const dir = new URL('./results/', import.meta.url).pathname;
mkdirSync(dir, { recursive: true });
const jsonl = `${dir}${name}.jsonl`, metaPath = `${dir}${name}-run.json`;

const entries = listCatalog(catalog);
const selected = all ? entries : stratifiedSample(entries, size, seed);
const done = new Set(existsSync(jsonl) ? readFileSync(jsonl, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).id as string) : []);
const queue: CatalogEntry[] = selected.filter(e => !done.has(e.id)), total = queue.length;
process.stdout.write(`${entries.length} catalog models, ${selected.length} selected (${all ? 'all' : `stratified sample, seed ${seed}`}), ${done.size} already done, ${queue.length} to run with ${jobs} workers.\n`);

const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf8')) : {};
Object.assign(meta, {
  name, catalogModels: entries.length, selected: selected.length, mode: all ? 'all' : 'stratified-by-kit', seed: all ? null : seed,
  labCommit: flag('lab-commit', meta.labCommit ?? null), timeoutSeconds: timeoutMs / 1000, jobs,
  machine: { cpus: cpus().length, model: cpus()[0]?.model, loadAverageAtStart: loadavg().map(x => +x.toFixed(1)) },
  started: meta.started ?? new Date().toISOString(),
});

let finished = 0;
const started = Date.now();
function worker(): Promise<void> {
  return new Promise(resolve => {
    let child: ChildProcess | null = null, current: CatalogEntry | null = null, timer: NodeJS.Timeout | null = null, served = 0;
    const record = (r: unknown) => { appendFileSync(jsonl, JSON.stringify(r) + '\n'); finished++; if (finished % 10 === 0 || finished === total) process.stdout.write(`${finished}/${total} (${((Date.now() - started) / 60000).toFixed(1)} min, load ${loadavg()[0].toFixed(0)})\n`); };
    const spawn = () => {
      served = 0;
      child = fork(new URL('./src/worker.ts', import.meta.url).pathname, [], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], execArgv: ['--max-old-space-size=3072'] });
      let stderr = '';
      child.stderr!.on('data', d => { stderr = (stderr + d).slice(-2000); });
      child.on('message', (m: { type: string; record?: unknown; restart?: boolean; calibration?: unknown; versions?: unknown }) => {
        if (m.type === 'ready') { meta.calibration ??= m.calibration; meta.versions ??= m.versions; next(); return; }
        if (timer) clearTimeout(timer);
        record(m.record); current = null; served++;
        if (m.restart || served >= restartEvery) { child!.removeAllListeners('exit'); child!.kill(); spawn(); } else next();
      });
      child.on('exit', code => {
        if (timer) clearTimeout(timer);
        if (current) { record({ id: current.id, kit: current.kit, sha256: '', convert: { status: 'harness-error', wallMs: 0, error: `worker exited (${code}): ${stderr.split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)}` }, class: 'worker-crash' }); current = null; }
        if (queue.length) spawn(); else resolve();
      });
    };
    const next = () => {
      current = queue.shift() ?? null;
      if (!current) { child!.removeAllListeners('exit'); child!.kill(); resolve(); return; }
      const job = current;
      timer = setTimeout(() => {
        if (current !== job) return;
        record({ id: job.id, kit: job.kit, sha256: '', convert: { status: 'timeout', wallMs: timeoutMs }, class: 'timeout' }); current = null;
        child!.removeAllListeners('exit'); child!.kill('SIGKILL'); if (queue.length) spawn(); else resolve();
      }, timeoutMs);
      child!.send({ id: job.id, kit: job.kit, file: job.file });
    };
    spawn();
  });
}
await Promise.all(Array.from({ length: Math.max(1, Math.min(jobs, queue.length)) }, worker));
meta.finished = new Date().toISOString();
meta.lastRunMinutes = +((Date.now() - started) / 60000).toFixed(1);
meta.machine.loadAverageAtEnd = loadavg().map(x => +x.toFixed(1));
writeFileSync(metaPath, JSON.stringify(meta, null, 1) + '\n');
const native = flag('native');
const summary = summarize(jsonl, { native, meta, selectedIds: selected.map(e => e.id) });
process.stdout.write(summary.markdown + '\n');
