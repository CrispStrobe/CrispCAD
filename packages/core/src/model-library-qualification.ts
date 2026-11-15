// SPDX-License-Identifier: BSD-3-Clause
import type {ModelLibraryAsset, ModelLibraryFile, ModelLibraryScreeningPolicy} from './model-library.js';

/** Serializable curation assertions. This is never a runtime collision proof. */
export interface ModelLibraryCollisionReport {
  format: 'brickwright-library-collision-report';
  version: 1;
  selectedFile: ModelLibraryFile;
  quality: {
    fileSha256: string; toolVersion: string; checkedOn: string;
    policy: ModelLibraryScreeningPolicy;
    checks: {parseable: 'pass'; closedPositiveVolume: 'pass'; withinSizeLimits: 'pass'; withinTriangleLimits: 'pass'};
    diagnostics: string[];
    triangles: number;
    boundsMm: {min: number[]; max: number[]};
    signedVolumeMm3: number;
    quality: Omit<NonNullable<ModelLibraryAsset['quality']>, 'physics' | 'collisionReport'>;
  };
  evidence: {
    fileSha256: string; checkedOn: string; toMillimetresZUp: number[];
    engine: 'Jolt'; engineVersion: string; qualifierVersion: string;
    qualified: true; scope: 'rigid-collision-preview'; geometrySha256: string; sourceVolumeMm3: number; hulls: number;
    certificate: {
      sourceSHA256: string; algorithm: 'manifold-compound/v1'; strategy: 'bsp'; maxHulls: number;
      missingVolumeMm3: number; extraVolumeMm3: number; numericalResidualVolumeMm3?: number; relativeError: number; boundsErrorMm: number;
      tolerance: {volumeFraction: number; boundsMm: number};
    };
    nativeCheck: {build: 'debug'; ground: false; steps: 1; stepSeconds: 0.005};
  };
}
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: unknown, names: string): v is Record<string, any> => object(v) && Object.keys(v).length === names.split(' ').length && names.split(' ').every(k => Object.hasOwn(v, k));
const same = (a: unknown, b: unknown): boolean => {
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((v, i) => same(v, b[i]));
  if (object(a)) return object(b) && Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(k => Object.hasOwn(b, k) && same(a[k], b[k]));
  return a === b;
};
const nonnegative = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const positive = (n: unknown): n is number => nonnegative(n) && n > 0;
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const vector = (v: unknown): v is number[] => Array.isArray(v) && v.length === 3 && v.every(n => typeof n === 'number' && Number.isFinite(n));
/** Called after ordinary asset/quality validation. No trust or runtime authority is granted. */
export function validModelLibraryCollisionReport(value: unknown, asset: ModelLibraryAsset): boolean {
  if (!exact(value, 'format version selectedFile quality evidence') || value.format !== 'brickwright-library-collision-report' || value.version !== 1) return false;
  const selected = value.selectedFile;
  if (!object(selected) || selected.format !== 'stl' || ![asset.original, ...asset.derivatives].some(f => same(f, selected))) return false;
  const q = value.quality, outer = asset.quality;
  if (!outer || !exact(q, 'fileSha256 toolVersion checkedOn policy checks diagnostics triangles boundsMm signedVolumeMm3 quality')) return false;
  if (q.fileSha256 !== selected.sha256 || q.toolVersion !== 'brickwright-stl-quality/1' || q.checkedOn !== outer.checkedOn || q.toolVersion !== outer.toolVersion || q.fileSha256 !== outer.fileSha256) return false;
  if (!exact(q.checks, 'parseable closedPositiveVolume withinSizeLimits withinTriangleLimits') || !Object.values(q.checks).every(v => v === 'pass')) return false;
  const {physics: _physics, collisionReport: _report, ...screen} = outer;
  if (!same(q.quality, screen) || !same(q.policy, outer.screeningPolicy) || !['parseable', 'closedPositiveVolume', 'withinSizeLimits', 'withinTriangleLimits'].every(k => (outer as any)[k] === true)) return false;
  if (!Array.isArray(q.diagnostics) || q.diagnostics.length > 100 || !q.diagnostics.every(v => typeof v === 'string' && v.length <= 4096 && !/[\u0000-\u001f]/.test(v))) return false;
  const p = q.policy;
  if (!object(p) || p.maxAnalysisBytes !== 16777216 || p.maxAnalysisTriangles !== 83333 || selected.bytes > p.maxAnalysisBytes || p.maxTriangles > p.maxAnalysisTriangles || !Number.isSafeInteger(q.triangles) || q.triangles < 1 || q.triangles > p.maxTriangles) return false;
  if (!exact(q.boundsMm, 'min max') || !vector(q.boundsMm.min) || !vector(q.boundsMm.max) || !q.boundsMm.max.every((v: number, i: number) => v >= q.boundsMm.min[i] && v - q.boundsMm.min[i] <= p.maxExtentMm) || !positive(q.signedVolumeMm3)) return false;
  const e = value.evidence;
  if (!exact(e, 'fileSha256 checkedOn toMillimetresZUp engine engineVersion qualifierVersion qualified scope geometrySha256 sourceVolumeMm3 hulls certificate nativeCheck') || e.fileSha256 !== selected.sha256 || e.checkedOn !== q.checkedOn || !same(e.toMillimetresZUp, p.toMillimetresZUp) || e.engine !== 'Jolt' || e.engineVersion !== '1.1.0-bw.9' || e.qualifierVersion !== 'brickwright-library-collision/1' || e.qualified !== true || e.scope !== 'rigid-collision-preview' || !hash(e.geometrySha256) || !positive(e.sourceVolumeMm3)) return false;
  const c = e.certificate;
  if (!(exact(c, 'sourceSHA256 algorithm strategy maxHulls missingVolumeMm3 extraVolumeMm3 relativeError boundsErrorMm tolerance') || exact(c, 'sourceSHA256 algorithm strategy maxHulls missingVolumeMm3 extraVolumeMm3 numericalResidualVolumeMm3 relativeError boundsErrorMm tolerance')) || c.sourceSHA256 !== e.geometrySha256 || c.algorithm !== 'manifold-compound/v1' || c.strategy !== 'bsp' || !Number.isSafeInteger(c.maxHulls) || c.maxHulls < 1 || c.maxHulls > 2048 || !Number.isSafeInteger(e.hulls) || e.hulls < 1 || e.hulls > c.maxHulls) return false;
  const t = c.tolerance;
  if (!exact(t, 'volumeFraction boundsMm') || !positive(t.volumeFraction) || t.volumeFraction > 0.1 || !positive(t.boundsMm) || t.boundsMm > 1 || ![c.missingVolumeMm3, c.extraVolumeMm3, c.relativeError, c.boundsErrorMm, c.numericalResidualVolumeMm3 ?? 0].every(nonnegative) || c.relativeError > t.volumeFraction || c.boundsErrorMm > t.boundsMm) return false;
  const relative = (c.missingVolumeMm3 + c.extraVolumeMm3 + (c.numericalResidualVolumeMm3 ?? 0)) / e.sourceVolumeMm3;
  if (!Number.isFinite(relative) || Math.abs(relative - c.relativeError) > Number.EPSILON * 16 * Math.max(1, relative, c.relativeError)) return false;
  if (outer.physics && (outer.physics.qualified !== true || outer.physics.engine !== e.engine || outer.physics.engineVersion !== e.engineVersion || outer.physics.qualifierVersion !== e.qualifierVersion)) return false;
  return same(e.nativeCheck, {build: 'debug', ground: false, steps: 1, stepSeconds: 0.005});
}
