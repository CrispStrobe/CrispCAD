// SPDX-License-Identifier: BSD-3-Clause
// Child process of run.ts: converts one kernelCAD model at a time and builds every part
// with Manifold (packages/geometry) and with the SMLib exact kernel (experiments/exact-kernel).
// Protocol (process IPC): parent sends {id, kit, file}; child answers {type:'result', record}.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { compileCode, createCadSession, type CodeProgram, type CodeShape, type CodeProfile } from '@brickwright/cad-core';
import { createGeometryKernel } from '@brickwright/cad-geometry';
// @ts-expect-error untyped script module
import { convertKernelCAD } from '../../../scripts/convert-kcad.mjs';
import { ExactKernelError, type ExactKernel, type ExactSolid } from '../../exact-kernel/src/exact-kernel.ts';
import { evaluateCadScript, lowerCodeShape, MIN_EXACT_SEGMENTS } from '../../exact-kernel/src/lower-cad-script.ts';
import { createSmlibKernel } from '../../exact-kernel/src/smlib-kernel.ts';
import { delta, tolerance, type Calibration, type CurvedKind, type Tolerance } from './tolerance.ts';

type BBox = { min: number[]; max: number[] };
export interface Build { ok: true; volume: number; area: number; bbox: BBox; wallMs: number; cpuMs: number; triangles?: number; valid?: boolean }
export interface BuildError { ok: false; code: string; error: string; wallMs: number; cpuMs: number }
export type PartClass = 'agree' | 'disagree' | 'exact-unsupported' | 'exact-failure' | 'manifold-failure' | 'both-failed';
export interface PartRecord {
  name: string;
  manifold: Build | BuildError;
  exact: Build | BuildError;
  /** Exact build of kernelCAD's intent where the converter emitted a low segment count
   * (cylinder segments are ignored by kernelCAD; torus segments facet only the tube). */
  exactIntent?: Build | BuildError;
  tolerance?: Tolerance;
  diff?: { volume: number; area: number; bbox: number; relVolume: number };
  class: PartClass;
  reasons?: string[];
}
export type ModelClass = 'agree' | 'disagree' | 'exact-unsupported' | 'kernel-failure' | 'converter-failure' | 'licence-refused' | 'timeout' | 'worker-crash';
export interface ModelRecord {
  id: string; kit: string; sha256: string;
  convert: { status: string; wallMs: number; parts?: number; skippedParts?: number; warnings?: number; error?: string };
  parts?: PartRecord[];
  totals?: { manifold: number | null; exact: number | null; exactIntent: number | null; partsBuiltByBoth: number };
  class: ModelClass;
}

const r10 = (x: number) => (Number.isFinite(x) ? +x.toPrecision(10) : x);
const roundBox = (b: BBox): BBox => ({ min: b.min.map(r10), max: b.max.map(r10) });
function clock<T>(fn: () => T): { value?: T; error?: unknown; wallMs: number; cpuMs: number } {
  const c = process.cpuUsage(), w = performance.now();
  try { const value = fn(); const d = process.cpuUsage(c); return { value, wallMs: +(performance.now() - w).toFixed(2), cpuMs: +((d.user + d.system) / 1000).toFixed(2) }; }
  catch (error) { const d = process.cpuUsage(c); return { error, wallMs: +(performance.now() - w).toFixed(2), cpuMs: +((d.user + d.system) / 1000).toFixed(2) }; }
}
const message = (e: unknown) => String((e as Error)?.message ?? e).split('\n')[0].slice(0, 300);

const manifoldKernel = await createGeometryKernel({ wasmBinary: readFileSync(new URL('../../../node_modules/manifold-3d/manifold.wasm', import.meta.url)) });
const exact: ExactKernel = await createSmlibKernel();

function meshArea(positions: ArrayLike<number>, indices: ArrayLike<number>): number {
  let a = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const p = indices[i] * 3, q = indices[i + 1] * 3, r = indices[i + 2] * 3;
    const ux = positions[q] - positions[p], uy = positions[q + 1] - positions[p + 1], uz = positions[q + 2] - positions[p + 2];
    const vx = positions[r] - positions[p], vy = positions[r + 1] - positions[p + 1], vz = positions[r + 2] - positions[p + 2];
    a += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }
  return a;
}

function buildManifold(program: CodeProgram): Build | BuildError {
  const s = createCadSession();
  try {
    const t = clock(() => { s.addCode(program, 'part'); return manifoldKernel.evaluate(s.state.document); });
    if (t.error) return { ok: false, code: 'manifold-error', error: message(t.error), wallMs: t.wallMs, cpuMs: t.cpuMs };
    const r = t.value!, bodies = r.bodies.filter(b => !b.reference && !b.hole);
    if (!bodies.length) return { ok: false, code: 'manifold-empty', error: 'No solid body.', wallMs: t.wallMs, cpuMs: t.cpuMs };
    const min = [0, 1, 2].map(i => Math.min(...bodies.map(b => b.bounds.min[i]))), max = [0, 1, 2].map(i => Math.max(...bodies.map(b => b.bounds.max[i])));
    return { ok: true, volume: r10(r.volume), area: r10(bodies.reduce((a, b) => a + meshArea(b.positions, b.indices), 0)), bbox: roundBox({ min, max }), triangles: r.triangles, wallMs: t.wallMs, cpuMs: t.cpuMs };
  } finally { s.dispose(); }
}

function measureExact(build: () => ExactSolid): Build | BuildError {
  const t = clock(() => {
    const solid = build();
    try { return { volume: exact.volume(solid), area: exact.area(solid), bbox: exact.bbox(solid), valid: exact.isValid(solid) }; }
    finally { solid.dispose(); }
  });
  if (t.error) {
    const code = t.error instanceof ExactKernelError ? t.error.code : 'exact-error';
    return { ok: false, code, error: message(t.error), wallMs: t.wallMs, cpuMs: t.cpuMs };
  }
  const v = t.value!;
  return { ok: true, volume: r10(v.volume), area: r10(v.area), bbox: roundBox(v.bbox), valid: v.valid, wallMs: t.wallMs, cpuMs: t.cpuMs };
}

/** kernelCAD's intent for low segment counts: `cylinder(h, r, n)` ignores n (exact
 * cylinder), `torus(R, r, n)` revolves an n-gon tube exactly about Z. */
function intentProfile(p: CodeProfile): CodeProfile {
  switch (p.kind) {
    case 'circle': return p.segments >= MIN_EXACT_SEGMENTS ? p : { kind: 'polygon', contours: [Array.from({ length: p.segments }, (_, i) => [p.radius * Math.cos(2 * Math.PI * i / p.segments), p.radius * Math.sin(2 * Math.PI * i / p.segments)] as [number, number])] };
    case 'move': case 'scale': case 'rotate': case 'affine': case 'resize': case 'offset': return { ...p, profile: intentProfile(p.profile) } as CodeProfile;
    case 'union': case 'subtract': case 'intersect': case 'hull': case 'minkowski': return { ...p, profiles: p.profiles.map(intentProfile) };
    default: return p;
  }
}
function intentShape(s: CodeShape): CodeShape {
  switch (s.kind) {
    case 'cylinder': return s.segments >= MIN_EXACT_SEGMENTS ? s : { ...s, segments: 48 };
    case 'revolve': return { ...s, segments: Math.max(s.segments, 48), profile: intentProfile(s.profile) };
    case 'profile-extrude': return { ...s, profile: intentProfile(s.profile) };
    case 'union': case 'subtract': case 'intersect': case 'hull': case 'minkowski': return { ...s, shapes: s.shapes.map(intentShape) };
    case 'move': case 'rotate': case 'scale': case 'mirror': case 'axisRotate': case 'affine': case 'resize': case 'repeat': return { ...s, shape: intentShape(s.shape) } as CodeShape;
    default: return s;
  }
}

/** Measured Manifold faceting factors (deficit / δ(N)) for the tolerance model. */
function calibrate(): Calibration & { samples: Record<string, unknown>[] } {
  const samples: Record<string, unknown>[] = [];
  const cal: Calibration = { volume: { prism: 1, sphere: 1, revolve: 1 }, area: { prism: 1, sphere: 1, revolve: 1 } };
  const cases: [CurvedKind, (n: number) => string, number, number, number][] = [
    // kind, source, analytic volume, analytic area, number of faceted directions
    ['prism', n => `return cylinder(10, 20, ${n});`, Math.PI * 100 * 20, 2 * Math.PI * 10 * 30, 1],
    ['sphere', n => `return sphere(10, ${n});`, 4 / 3 * Math.PI * 1000, 4 * Math.PI * 100, 1],
    ['revolve', n => `return torus(20, 5, ${n}, ${n});`, 2 * Math.PI * Math.PI * 20 * 25, 4 * Math.PI * Math.PI * 100, 2],
  ];
  for (const [kind, source, volume, area, dirs] of cases) for (const n of [8, 16, 48, 96]) {
    const b = buildManifold({ version: 1, language: 'brickwright-cad-script', source: source(n), parameters: {} } as CodeProgram);
    if (!b.ok) throw new Error(`calibration ${kind} ${n}: ${b.error}`);
    const fv = (volume - b.volume) / volume / (dirs * delta(n)), fa = (area - b.area) / area / (dirs * delta(n));
    samples.push({ kind, segments: n, volumeDeficit: r10((volume - b.volume) / volume), areaDeficit: r10((area - b.area) / area), delta: r10(delta(n)), fv: r10(fv), fa: r10(fa) });
    cal.volume[kind] = Math.max(cal.volume[kind], fv);
    cal.area[kind] = Math.max(cal.area[kind], fa);
  }
  return { ...cal, samples };
}
const calibration = calibrate();

function comparePart(name: string, program: CodeProgram): PartRecord {
  const manifold = buildManifold(program);
  const exactBuild = measureExact(() => evaluateCadScript(exact, program));
  const record: PartRecord = { name, manifold, exact: exactBuild, class: 'agree' };
  let shape: CodeShape | undefined;
  try { shape = compileCode(program).shape; } catch { /* reported by both builds */ }
  if (!exactBuild.ok && exactBuild.code === 'unsupported' && /segments is ambiguous/.test(exactBuild.error) && shape) {
    const s = intentShape(shape);
    record.exactIntent = measureExact(() => { const r = exact.scope(() => lowerCodeShape(exact, s)); if (!r) throw new ExactKernelError('invalid-input', 'The program produces no solid.'); return r; });
  }
  if (!manifold.ok) { record.class = exactBuild.ok ? 'manifold-failure' : 'both-failed'; return record; }
  if (!exactBuild.ok) { record.class = exactBuild.code === 'unsupported' ? 'exact-unsupported' : 'exact-failure'; return record; }
  const diag = Math.hypot(...[0, 1, 2].map(i => exactBuild.bbox.max[i] - exactBuild.bbox.min[i]));
  const tol = tolerance(shape!, calibration, { volume: exactBuild.volume, area: exactBuild.area, diag });
  const dv = manifold.volume - exactBuild.volume, da = manifold.area - exactBuild.area;
  const db = Math.max(...[0, 1, 2].flatMap(i => [Math.abs(manifold.bbox.min[i] - exactBuild.bbox.min[i]), Math.abs(manifold.bbox.max[i] - exactBuild.bbox.max[i])]));
  record.tolerance = { ...tol, volume: r10(tol.volume), area: r10(tol.area), bbox: r10(tol.bbox) };
  record.diff = { volume: r10(dv), area: r10(da), bbox: r10(db), relVolume: r10(dv / exactBuild.volume) };
  const reasons = [Math.abs(dv) > tol.volume && 'volume', Math.abs(da) > tol.area && 'area', db > tol.bbox && 'bbox', exactBuild.valid === false && 'exact-invalid'].filter(Boolean) as string[];
  if (reasons.length) { record.class = 'disagree'; record.reasons = reasons; }
  return record;
}

function processModel(job: { id: string; kit: string; file: string }): ModelRecord {
  const source = readFileSync(job.file, 'utf8'), sha256 = createHash('sha256').update(source).digest('hex');
  const t = clock(() => convertKernelCAD(source));
  if (t.error) {
    const code = (t.error as { code?: string })?.code;
    const status = code === 'licence' ? 'licence' : code === 'unsupported-feature' ? 'unsupported' : code === 'resource-limit' ? 'limited' : 'failed';
    return { id: job.id, kit: job.kit, sha256, convert: { status, wallMs: t.wallMs, error: message(t.error) }, class: status === 'licence' ? 'licence-refused' : 'converter-failure' };
  }
  const converted = t.value as { parts: { name: string; program: CodeProgram }[]; skippedParts: unknown[]; warnings: unknown[] };
  const parts = converted.parts.map(p => comparePart(p.name, p.program));
  const sum = (pick: (p: PartRecord) => Build | BuildError | undefined) => parts.every(p => pick(p)?.ok) ? r10(parts.reduce((s, p) => s + (pick(p) as Build).volume, 0)) : null;
  const intentSum = parts.some(p => p.exactIntent) && parts.every(p => p.exact.ok || p.exactIntent?.ok) ? r10(parts.reduce((s, p) => s + ((p.exact.ok ? p.exact : p.exactIntent) as Build).volume, 0)) : null;
  const classes = new Set(parts.map(p => p.class));
  const cls: ModelClass = !parts.length ? 'converter-failure' : classes.has('disagree') ? 'disagree' : classes.has('manifold-failure') || classes.has('both-failed') || classes.has('exact-failure') ? 'kernel-failure' : classes.has('exact-unsupported') ? 'exact-unsupported' : 'agree';
  return {
    id: job.id, kit: job.kit, sha256,
    convert: { status: converted.skippedParts.length ? 'partial' : 'converted', wallMs: t.wallMs, parts: parts.length, skippedParts: converted.skippedParts.length, warnings: converted.warnings.length },
    parts, totals: { manifold: sum(p => p.manifold), exact: sum(p => p.exact), exactIntent: intentSum, partsBuiltByBoth: parts.filter(p => p.manifold.ok && p.exact.ok).length },
    class: cls,
  };
}

process.on('message', (job: { id: string; kit: string; file: string }) => {
  let record: ModelRecord;
  try { record = processModel(job); }
  catch (error) { record = { id: job.id, kit: job.kit, sha256: '', convert: { status: 'harness-error', wallMs: 0, error: message(error) }, class: 'worker-crash' }; }
  // A WASM trap may leave SMLib's memory damaged; ask the parent for a fresh process.
  const crashed = ((exact.memory() as unknown as { crashes?: number }).crashes ?? 0) > 0;
  process.send!({ type: 'result', record, restart: crashed });
});
process.send!({ type: 'ready', calibration, versions: { node: process.version, exact: `${exact.name} ${exact.version}` } });
