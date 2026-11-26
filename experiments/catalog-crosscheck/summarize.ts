// SPDX-License-Identifier: BSD-3-Clause
// Summarise a cross-check run: node summarize.ts results/<name>.jsonl [--native native.json]
// Writes results/<name>-summary.json and results/<name>-summary.md next to the JSONL.
//
// Native volumes (the third column) are optional input in this format:
//   { "kernel": "smlib-native", "labCommit": "<sha>", "models": {
//       "<kit>/<model>.kcad.ts": { "status": "ok", "volumeMm3": 1234.5 }
//     | { "status": "error", "error": "..." } } }
// where volumeMm3 is the sum of the model's part volumes at default parameters (the same
// quantity as `totals` here). See README "Native volumes".
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { ModelRecord, PartRecord } from './src/worker.ts';

/** The lab's committed coverage file (experiments/kernel-qualification/results-catalog-native.json):
 * build status only, failures listed, no volumes. */
interface CoverageFile { summary: { total: number; ok: number }; failures: { file: string; ok: boolean; message?: string }[] }
/** Catalog ids relative to `catalog/kits/` whichever prefix the source used. */
const catalogId = (id: string) => id.replace(/^(\.\/)?(catalog\/)?(kits\/)?/, '');
function coverageAsNative(c: CoverageFile, ids: string[]): NativeFile {
  const failed = new Map(c.failures.map(f => [catalogId(f.file), f.message ?? 'failed']));
  return { kernel: 'smlib-native (status only)', models: Object.fromEntries(ids.map(id => [id, failed.has(catalogId(id)) ? { status: 'error', error: failed.get(catalogId(id)) } : { status: 'ok' }])) };
}
interface NativeFile { kernel?: string; labCommit?: string; models: Record<string, { status: string; volumeMm3?: number; areaMm2?: number; bbox?: { min: number[]; max: number[] }; parts?: number; error?: string }> }
const count = <T>(xs: T[], key: (x: T) => string) => { const m: Record<string, number> = {}; for (const x of xs) m[key(x)] = (m[key(x)] ?? 0) + 1; return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1])); };
/** Collapse numbers and quoted names so equal causes group together. */
const normalise = (e: string) => e.replace(/“[^”]*”|"[^"]*"|'[^']*'/g, '…').replace(/(?<![A-Za-z\d])-?\d+(\.\d+)?(e-?\d+)?/g, 'N').slice(0, 160);
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const fmt = (x: number) => (Math.abs(x) >= 0.01 || x === 0 ? x.toFixed(Math.abs(x) >= 100 ? 0 : 2) : x.toExponential(1));

/** Manifold's vertices lie on the true surface, so its bbox is inside the true one; an exact
 * bbox strictly inside Manifold's is wrong (SMLib's tight bbox misses a rotated sphere's
 * extreme). Planar parts beyond 1e-6 are numerics on one side or the other. */
function cause(p: PartRecord): string {
  const m = (p.manifold as { bbox: { min: number[]; max: number[] } }).bbox, e = (p.exact as { bbox: { min: number[]; max: number[] } }).bbox;
  const tooTight = [0, 1, 2].some(i => e.min[i] > m.min[i] + 1e-6 || e.max[i] < m.max[i] - 1e-6);
  const r = p.reasons!;
  if (r.includes('bbox') && tooTight) return r.length === 1 ? 'exact bbox inside Manifold mesh bbox (SMLib tight bbox)' : 'exact bbox too tight + ' + r.filter(x => x !== 'bbox').join('+');
  if (p.tolerance!.curved === 0) {
    const relA = Math.abs(p.diff!.area) / (p.exact as { area: number }).area;
    if (r.join() === 'area' && relA > 1e-3 && p.diff!.area < 0) return 'planar loft, exact area too large with equal volume (SMLib area of stitched polyhedron)';
    if (r.join() === 'area' && relA > 1e-3) return 'planar part, Manifold area too large with equal volume (faces of exactly touching operands kept inside the mesh)';
    if (r.join() === 'area') return 'planar part, area off by < 1e-3 (float32 mesh positions far from the origin)';
    return `planar part, ${r.join('+')} beyond the 1e-6 floor (|dV|/V ≤ 1e-5: Manifold numerics or float32 polyhedron vertices at large coordinates)`;
  }
  return `curved part, ${r.join('+')} beyond faceting tolerance`;
}

export function summarize(jsonl: string, options: { native?: string; meta?: Record<string, unknown>; selectedIds?: string[] } = {}) {
  const all = readFileSync(jsonl, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as ModelRecord);
  const wanted = options.selectedIds ? new Set(options.selectedIds) : null;
  const models = wanted ? all.filter(m => wanted.has(m.id)) : all;
  const parts = models.flatMap(m => (m.parts ?? []).map(p => ({ model: m.id, ...p })));
  const both = parts.filter(p => p.manifold.ok && p.exact.ok) as (PartRecord & { model: string; manifold: { volume: number; cpuMs: number }; exact: { volume: number; cpuMs: number } })[];
  const intent = parts.filter(p => p.manifold.ok && p.exactIntent?.ok) as (PartRecord & { model: string; manifold: { volume: number }; exactIntent: { volume: number } })[];
  const disagree = both.filter(p => p.class === 'disagree').sort((a, b) => Math.abs(b.diff!.relVolume) - Math.abs(a.diff!.relVolume));
  const agreeRel = both.filter(p => p.class === 'agree').map(p => Math.abs(p.diff!.relVolume));
  // Planar: no curved constructs and no twisted ruled-loft quads (whose fans differ from the ruled surface under Booleans).
  const planarAgree = both.filter(p => p.class === 'agree' && p.tolerance!.curved === 0 && !p.tolerance!.ruledVolume).map(p => Math.abs(p.diff!.relVolume));

  const summary: Record<string, unknown> = {
    run: options.meta ?? (existsSync(jsonl.replace(/\.jsonl$/, '-run.json')) ? JSON.parse(readFileSync(jsonl.replace(/\.jsonl$/, '-run.json'), 'utf8')) : null),
    models: models.length,
    modelClasses: count(models, m => m.class),
    convertStatus: count(models, m => m.convert.status),
    convertErrors: count(models.filter(m => m.convert.error), m => normalise(m.convert.error!)),
    parts: parts.length,
    partClasses: count(parts, p => p.class),
    disagreementReasons: count(disagree, p => p.reasons!.join('+')),
    /** Diagnosis of each disagreement (see README "Causes"). */
    disagreementCauses: count(disagree, cause),
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
    /** Model totals: Manifold against the exact build (kernelCAD intent where the converter
     * emitted low segment counts). This estimates what the converter's faceting costs against
     * kernelCAD's exact geometry; path arcs the converter already turned into polygons are not
     * visible here (only the native column shows them). */
    modelTotals: (() => {
      const rel = models.filter(m => m.totals?.manifold != null && (m.totals.exact ?? m.totals.exactIntent) != null).map(m => m.totals!.manifold! / (m.totals!.exact ?? m.totals!.exactIntent)! - 1).sort((a, b) => a - b);
      const q = (f: number) => (rel.length ? rel[Math.min(rel.length - 1, Math.floor(f * rel.length))] : null);
      return { models: rel.length, exactlyEqual: rel.filter(x => Math.abs(x) <= 1e-6).length, within1e3: rel.filter(x => Math.abs(x) <= 1e-3).length, within1e2: rel.filter(x => Math.abs(x) <= 1e-2).length, beyond5e2: rel.filter(x => Math.abs(x) > 5e-2).length, p05: q(0.05), median: q(0.5), p95: q(0.95), min: rel[0] ?? null };
    })(),
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

  const threeWay = new Map<string, string>();
  if (options.native) {
    const raw = JSON.parse(readFileSync(options.native, 'utf8')) as NativeFile | CoverageFile;
    const statusOnly = !('models' in raw);
    const native: NativeFile = 'models' in raw ? raw : coverageAsNative(raw, models.map(m => m.id));
    const byId = new Map(Object.entries(native.models).map(([k, v]) => [catalogId(k), v]));
    const three = models.map(m => {
      const n = byId.get(catalogId(m.id));
      if (n && statusOnly) return { id: m.id, class: `native ${n.status === 'ok' ? 'built' : 'failed'} / ours ${m.class}` };
      if (!n) return { id: m.id, class: 'native-missing' };
      if (n.status !== 'ok' || typeof n.volumeMm3 !== 'number') return { id: m.id, class: m.totals?.manifold != null ? 'native-failed' : 'all-failed' };
      const M = m.totals?.manifold ?? null, E = m.totals?.exact ?? m.totals?.exactIntent ?? null, N = n.volumeMm3;
      const skipped = m.convert.skippedParts ?? 0, row = { id: m.id, convert: m.convert.status, parts: m.parts?.length ?? 0, nativeParts: n.parts ?? null, skipped };
      if (M == null && E == null) return { ...row, class: m.parts?.length ? 'ours-failed' : 'converter-failed', N };
      const tolM = (m.parts ?? []).reduce((s, p) => s + (p.tolerance?.volume ?? 0), 0) + 1e-6 * Math.abs(N);
      const tolE = 1e-6 * Math.abs(N) + 1e-9;
      const en = E != null && Math.abs(E - N) <= tolE, mn = M != null && Math.abs(M - N) <= tolM, me = M != null && E != null && Math.abs(M - E) <= tolM;
      // Exact area (sum) and box (union) over the parts, as the lab sums and unions them.
      const exactParts = (m.parts ?? []).map(p => (p.exact.ok ? p.exact : p.exactIntent?.ok ? p.exactIntent : null) as { area: number; bbox: { min: number[]; max: number[] } } | null);
      let relArea: number | null = null, dBox: number | null = null;
      if (E != null && exactParts.every(Boolean) && typeof n.areaMm2 === 'number') relArea = exactParts.reduce((s, b) => s + b!.area, 0) / n.areaMm2 - 1;
      if (E != null && exactParts.every(Boolean) && n.bbox) {
        const lo = [0, 1, 2].map(i => Math.min(...exactParts.map(b => b!.bbox.min[i]))), hi = [0, 1, 2].map(i => Math.max(...exactParts.map(b => b!.bbox.max[i])));
        dBox = Math.max(...[0, 1, 2].flatMap(i => [Math.abs(lo[i] - n.bbox!.min[i]), Math.abs(hi[i] - n.bbox!.max[i])]));
      }
      const cls = skipped && !en ? 'converter-partial'
        : E == null ? (mn ? 'exact-failed, manifold ≈ native' : 'exact-failed, manifold ≠ native')
        : en && (mn || M == null) ? 'all-agree' : me && !en ? 'converter-error' : en && !me ? 'manifold-error' : mn && !en ? 'exact-error' : 'unresolved';
      return { ...row, class: cls, M, E, N, relConverter: E != null ? E / N - 1 : M! / N - 1, relArea, dBox };
    });
    // Exact vs native on area and box where the exact volume agrees (same kernel, so 1e-6).
    const volOk = three.filter(t => t.class === 'all-agree' || t.class === 'manifold-error') as { id: string; relArea?: number | null; dBox?: number | null; N?: number }[];
    const nativeMeasures = statusOnly ? null : {
      volumeAgreeing: volOk.length,
      areaWithin1e6: volOk.filter(t => t.relArea != null && Math.abs(t.relArea) <= 1e-6).length,
      areaWithin1e3: volOk.filter(t => t.relArea != null && Math.abs(t.relArea) <= 1e-3).length,
      areaBeyond1e3: volOk.filter(t => t.relArea != null && Math.abs(t.relArea) > 1e-3).map(t => ({ id: t.id, relArea: t.relArea })),
      bboxWithin1e3mm: volOk.filter(t => t.dBox != null && t.dBox <= 1e-3).length,
      bboxBeyond1e3mm: volOk.filter(t => t.dBox != null && t.dBox > 1e-3).map(t => ({ id: t.id, dBox: t.dBox })),
    };
    for (const t of three) threeWay.set(t.id, t.class);
    summary.native = { source: { kernel: native.kernel, labCommit: native.labCommit, statusOnly }, classes: count(three, t => t.class), exactVsNative: nativeMeasures, models: statusOnly ? three.filter(t => t.class.startsWith('native failed')) : three.filter(t => t.class !== 'all-agree' || ('relArea' in t && t.relArea != null && Math.abs(t.relArea) > 1e-6) || ('dBox' in t && t.dBox != null && t.dBox > 1e-3)) };
  }

  const out = jsonl.replace(/\.jsonl$/, '');
  // Compact per-model table (committable for the full run): id, class, convert status, parts, totals.
  writeFileSync(`${out}-models.json`, JSON.stringify(models.map(m => ({ id: m.id, class: m.class, convert: m.convert.status, ...(m.convert.error ? { error: m.convert.error } : {}), parts: m.parts?.length ?? 0, partClasses: count(m.parts ?? [], p => p.class), totals: m.totals ?? null, ...(threeWay.has(m.id) ? { native: threeWay.get(m.id) } : {}) })), null, 0).replace(/},{"id"/g, '},\n{"id"') + '\n');
  writeFileSync(`${out}-summary.json`, JSON.stringify(summary, null, 1) + '\n');
  const table = (title: string, rec: Record<string, number>, limit = 15) => [`| ${title} | Count |`, '| --- | ---: |', ...Object.entries(rec).slice(0, limit).map(([k, v]) => `| ${k.replace(/\|/g, '\\|')} | ${v} |`)].join('\n');
  const t = summary.timing as Record<string, number>, a = summary.agreement as Record<string, number>, i = summary.intent as Record<string, number>;
  const markdown = [
    `# Catalog cross-check: ${models.length} models, ${parts.length} parts`, '',
    table('Model class', summary.modelClasses as Record<string, number>), '',
    table('Part class', summary.partClasses as Record<string, number>), '',
    table('Disagreement (part) reason', summary.disagreementReasons as Record<string, number>), '',
    table('Disagreement (part) cause', summary.disagreementCauses as Record<string, number>), '',
    table('Converter outcome', summary.convertStatus as Record<string, number>), '',
    table('Converter error', summary.convertErrors as Record<string, number>, 8), '',
    table('Exact unsupported (part)', summary.exactUnsupported as Record<string, number>, 10), '',
    table('Exact failure (part)', summary.exactFailures as Record<string, number>, 10), '',
    table('Manifold failure (part)', summary.manifoldFailures as Record<string, number>, 10), '',
    `Parts built by both kernels: ${a.partsBuiltByBoth}; median |ΔV|/V of agreeing parts ${fmt(a.medianRelVolumeAgreeing)}; planar agreeing parts ${a.planarPartsAgreeing}, max |ΔV|/V ${a.maxRelVolumeAgreeingPlanar == null ? '–' : fmt(a.maxRelVolumeAgreeingPlanar)}.`,
    `Low-segment intent probe: ${i.parts} parts (${i.agreeWithinFacetingOfEmittedSegments} agree with Manifold within the faceting of the emitted N), median Manifold/intent − 1 = ${fmt(i.medianRelVolume)}, min ${i.minRelVolume == null ? '–' : fmt(i.minRelVolume)}; ${i.modelsOnlyLowSegmentUnsupported} exact-unsupported models are unsupported only for that reason.`,
    (() => { const t = summary.modelTotals as Record<string, number>; return `Model totals, Manifold vs exact (kernelCAD intent for low segments), ${t.models} models: ${t.exactlyEqual} within 1e-6, ${t.within1e3} within 1e-3, ${t.within1e2} within 1e-2, ${t.beyond5e2} beyond 5e-2; median ${fmt(t.median)}, 5th percentile ${fmt(t.p05)}, min ${fmt(t.min)}.`; })(),
    `CPU: Manifold ${(t.manifoldCpuMsTotal / 1000).toFixed(0)} s total (median part ${fmt(t.manifoldCpuMsMedianPart)} ms); exact ${(t.exactCpuMsTotal / 1000).toFixed(0)} s total (median part ${fmt(t.exactCpuMsMedianPart)} ms, max ${(t.exactCpuMsMaxPart / 1000).toFixed(1)} s).`,
    ...(summary.native ? ['', table('Three-way class (with native volumes)', (summary.native as { classes: Record<string, number> }).classes, 20), ...(() => {
      const x = (summary.native as { exactVsNative: { volumeAgreeing: number; areaWithin1e6: number; areaWithin1e3: number; bboxWithin1e3mm: number } | null }).exactVsNative;
      return x ? ['', `Exact vs native where the volumes agree (${x.volumeAgreeing} models): area within 1e-6 for ${x.areaWithin1e6}, within 1e-3 for ${x.areaWithin1e3}; box within 1e-3 mm for ${x.bboxWithin1e3mm}.`] : [];
    })()] : ['', 'Native (lab) volumes: not provided; see README "Native volumes".']),
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
