// SPDX-License-Identifier: BSD-3-Clause
// Summarise a cross-check run: node summarize.ts results/<name>.jsonl [--native native.json]
// Writes results/<name>-summary.json and results/<name>-summary.md next to the JSONL.
//
// Native volumes (the third column) are optional input in this format:
//   { "kernel": "smlib-native", "labCommit": "<sha>", "models": {
//       "kits/<kit>/<model>.kcad.ts": { "status": "ok", "volumeMm3": 1234.5 }
//     | { "status": "error", "error": "..." } } }
// where volumeMm3 is the sum of the model's part volumes at default parameters (the same
// quantity as `totals` here). See README "Native volumes".
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { ModelRecord, PartRecord } from './src/worker.ts';

interface NativeFile { kernel?: string; labCommit?: string; models: Record<string, { status: string; volumeMm3?: number; error?: string }> }
const count = <T>(xs: T[], key: (x: T) => string) => { const m: Record<string, number> = {}; for (const x of xs) m[key(x)] = (m[key(x)] ?? 0) + 1; return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1])); };
/** Collapse numbers and quoted names so equal causes group together. */
const normalise = (e: string) => e.replace(/“[^”]*”|"[^"]*"|'[^']*'/g, '…').replace(/(?<![A-Za-z\d])-?\d+(\.\d+)?(e-?\d+)?/g, 'N').slice(0, 160);
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const fmt = (x: number) => (Math.abs(x) >= 0.01 || x === 0 ? x.toFixed(Math.abs(x) >= 100 ? 0 : 2) : x.toExponential(1));

export function summarize(jsonl: string, options: { native?: string; meta?: Record<string, unknown>; selectedIds?: string[] } = {}) {
  const all = readFileSync(jsonl, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as ModelRecord);
  const wanted = options.selectedIds ? new Set(options.selectedIds) : null;
  const models = wanted ? all.filter(m => wanted.has(m.id)) : all;
  const parts = models.flatMap(m => (m.parts ?? []).map(p => ({ model: m.id, ...p })));
  const both = parts.filter(p => p.manifold.ok && p.exact.ok) as (PartRecord & { model: string; manifold: { volume: number; cpuMs: number }; exact: { volume: number; cpuMs: number } })[];
  const intent = parts.filter(p => p.manifold.ok && p.exactIntent?.ok) as (PartRecord & { model: string; manifold: { volume: number }; exactIntent: { volume: number } })[];
  const disagree = both.filter(p => p.class === 'disagree').sort((a, b) => Math.abs(b.diff!.relVolume) - Math.abs(a.diff!.relVolume));
  const agreeRel = both.filter(p => p.class === 'agree').map(p => Math.abs(p.diff!.relVolume));
  const planarAgree = both.filter(p => p.class === 'agree' && p.tolerance!.curved === 0).map(p => Math.abs(p.diff!.relVolume));

  const summary: Record<string, unknown> = {
    run: options.meta ?? (existsSync(jsonl.replace(/\.jsonl$/, '-run.json')) ? JSON.parse(readFileSync(jsonl.replace(/\.jsonl$/, '-run.json'), 'utf8')) : null),
    models: models.length,
    modelClasses: count(models, m => m.class),
    convertStatus: count(models, m => m.convert.status),
    convertErrors: count(models.filter(m => m.convert.error), m => normalise(m.convert.error!)),
    parts: parts.length,
    partClasses: count(parts, p => p.class),
    disagreementReasons: count(disagree, p => p.reasons!.join('+')),
    exactUnsupported: count(parts.filter(p => p.class === 'exact-unsupported'), p => normalise((p.exact as { error: string }).error)),
    exactFailures: count(parts.filter(p => p.class === 'exact-failure' || p.class === 'both-failed'), p => `${(p.exact as { code: string }).code}: ${normalise((p.exact as { error: string }).error)}`),
    manifoldFailures: count(parts.filter(p => !p.manifold.ok), p => normalise((p.manifold as { error: string }).error)),
    agreement: {
      partsBuiltByBoth: both.length,
      medianRelVolumeAgreeing: median(agreeRel),
      maxRelVolumeAgreeingPlanar: planarAgree.length ? Math.max(...planarAgree) : null,
      planarPartsAgreeing: planarAgree.length,
    },
    intent: {
      parts: intent.length,
      note: 'Parts the converter emitted with < 16 segments (cylinder/torus); exact kernel run on kernelCAD intent (exact cylinder, n-gon torus tube). relVolume = Manifold/intent - 1.',
      medianRelVolume: median(intent.map(p => p.manifold.volume / p.exactIntent.volume - 1)),
      minRelVolume: intent.length ? Math.min(...intent.map(p => p.manifold.volume / p.exactIntent.volume - 1)) : null,
      agreeWithinFacetingOfEmittedSegments: intent.filter(p => p.intentAgrees).length,
      byRelVolume: count(intent, p => (p.manifold.volume / p.exactIntent.volume - 1).toFixed(4)),
      modelsOnlyLowSegmentUnsupported: models.filter(m => m.class === 'exact-unsupported' && (m.parts ?? []).every(p => p.class === 'agree' || (p.class === 'exact-unsupported' && p.intentAgrees))).length,
    },
    timing: {
      manifoldCpuMsTotal: Math.round(parts.reduce((s, p) => s + p.manifold.cpuMs, 0)),
      exactCpuMsTotal: Math.round(parts.reduce((s, p) => s + p.exact.cpuMs, 0)),
      manifoldCpuMsMedianPart: median(parts.map(p => p.manifold.cpuMs)),
      exactCpuMsMedianPart: median(parts.map(p => p.exact.cpuMs)),
      exactCpuMsMaxPart: Math.max(0, ...parts.map(p => p.exact.cpuMs)),
      convertWallMsMedian: median(models.map(m => m.convert.wallMs)),
    },
    worstDisagreements: disagree.slice(0, 40).map(p => ({ model: p.model, part: p.name, reasons: p.reasons, relVolume: p.diff!.relVolume, dVolume: p.diff!.volume, dArea: p.diff!.area, dBbox: p.diff!.bbox, tolerance: { volume: p.tolerance!.volume, area: p.tolerance!.area, bbox: p.tolerance!.bbox, minSegments: p.tolerance!.minSegments, approximate: p.tolerance!.approximate } })),
    disagreeingModels: count(disagree, p => p.model),
  };

  if (options.native) {
    const native = JSON.parse(readFileSync(options.native, 'utf8')) as NativeFile;
    const three = models.map(m => {
      const n = native.models[m.id];
      if (!n) return { id: m.id, class: 'native-missing' };
      if (n.status !== 'ok' || typeof n.volumeMm3 !== 'number') return { id: m.id, class: m.totals?.manifold != null ? 'native-failed' : 'all-failed' };
      const M = m.totals?.manifold ?? null, E = m.totals?.exact ?? m.totals?.exactIntent ?? null, N = n.volumeMm3;
      if (M == null && E == null) return { id: m.id, class: 'ours-failed', N };
      const tolM = (m.parts ?? []).reduce((s, p) => s + (p.tolerance?.volume ?? 0), 0) + 1e-6 * Math.abs(N);
      const tolE = 1e-6 * Math.abs(N) + 1e-9;
      const en = E != null && Math.abs(E - N) <= tolE, mn = M != null && Math.abs(M - N) <= tolM, me = M != null && E != null && Math.abs(M - E) <= tolM;
      const cls = en && (mn || M == null) ? 'all-agree' : me && !en ? 'converter-error' : en && !me ? 'manifold-error' : mn && E != null && !en ? 'exact-error' : 'unresolved';
      return { id: m.id, class: cls, M, E, N, relConverter: E != null ? E / N - 1 : M! / N - 1 };
    });
    summary.native = { source: { kernel: native.kernel, labCommit: native.labCommit }, classes: count(three, t => t.class), models: three };
  }

  const out = jsonl.replace(/\.jsonl$/, '');
  writeFileSync(`${out}-summary.json`, JSON.stringify(summary, null, 1) + '\n');
  const table = (title: string, rec: Record<string, number>, limit = 15) => [`| ${title} | Count |`, '| --- | ---: |', ...Object.entries(rec).slice(0, limit).map(([k, v]) => `| ${k.replace(/\|/g, '\\|')} | ${v} |`)].join('\n');
  const t = summary.timing as Record<string, number>, a = summary.agreement as Record<string, number>, i = summary.intent as Record<string, number>;
  const markdown = [
    `# Catalog cross-check: ${models.length} models, ${parts.length} parts`, '',
    table('Model class', summary.modelClasses as Record<string, number>), '',
    table('Part class', summary.partClasses as Record<string, number>), '',
    table('Disagreement (part) reason', summary.disagreementReasons as Record<string, number>), '',
    table('Converter outcome', summary.convertStatus as Record<string, number>), '',
    table('Converter error', summary.convertErrors as Record<string, number>, 8), '',
    table('Exact unsupported (part)', summary.exactUnsupported as Record<string, number>, 10), '',
    table('Exact failure (part)', summary.exactFailures as Record<string, number>, 10), '',
    table('Manifold failure (part)', summary.manifoldFailures as Record<string, number>, 10), '',
    `Parts built by both kernels: ${a.partsBuiltByBoth}; median |ΔV|/V of agreeing parts ${fmt(a.medianRelVolumeAgreeing)}; planar agreeing parts ${a.planarPartsAgreeing}, max |ΔV|/V ${a.maxRelVolumeAgreeingPlanar == null ? '–' : fmt(a.maxRelVolumeAgreeingPlanar)}.`,
    `Low-segment intent probe: ${i.parts} parts (${i.agreeWithinFacetingOfEmittedSegments} agree with Manifold within the faceting of the emitted N), median Manifold/intent − 1 = ${fmt(i.medianRelVolume)}, min ${i.minRelVolume == null ? '–' : fmt(i.minRelVolume)}; ${i.modelsOnlyLowSegmentUnsupported} exact-unsupported models are unsupported only for that reason.`,
    `CPU: Manifold ${(t.manifoldCpuMsTotal / 1000).toFixed(0)} s total (median part ${fmt(t.manifoldCpuMsMedianPart)} ms); exact ${(t.exactCpuMsTotal / 1000).toFixed(0)} s total (median part ${fmt(t.exactCpuMsMedianPart)} ms, max ${(t.exactCpuMsMaxPart / 1000).toFixed(1)} s).`,
    ...(summary.native ? ['', table('Three-way class (with native volumes)', (summary.native as { classes: Record<string, number> }).classes)] : ['', 'Native (lab) volumes: not provided; see README "Native volumes".']),
  ].join('\n');
  writeFileSync(`${out}-summary.md`, markdown + '\n');
  return { summary, markdown };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2), file = args.find(a => a.endsWith('.jsonl'));
  if (!file) { process.stderr.write('Usage: node summarize.ts results/<name>.jsonl [--native native.json]\n'); process.exit(1); }
  const i = args.indexOf('--native');
  process.stdout.write(summarize(file, { native: i < 0 ? undefined : args[i + 1] }).markdown + '\n');
}
