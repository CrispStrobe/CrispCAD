// SPDX-License-Identifier: BSD-3-Clause
import {validModelLibraryCollisionReport, type ModelLibraryCollisionReport} from './model-library-qualification.js';
/** Content rights are separate from the editor's software licence. No SPDX expressions. */
export const MODEL_LIBRARY_CONTENT_LICENCES = [
  'CC0-1.0', 'MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'CC-BY-3.0', 'CC-BY-4.0',
] as const;
export type ModelLibraryContentLicence = typeof MODEL_LIBRARY_CONTENT_LICENCES[number];
/** Program formats are explicit: a .js suffix alone does not establish JSCAD. */
export const MODEL_LIBRARY_SOURCE_FORMATS = ['cad-script', 'openscad', 'jscad'] as const;
export type ModelLibrarySourceFormat = typeof MODEL_LIBRARY_SOURCE_FORMATS[number];
/** Classify metadata only; this never compiles or executes a source file. */
export function isModelLibrarySourceFormat(format: string): format is ModelLibrarySourceFormat {
  return (MODEL_LIBRARY_SOURCE_FORMATS as readonly string[]).includes(format);
}
export type ModelLibraryFile = ({url: string; path?: never} | {path: string; url?: never}) & {
  format: string;
  sha256: string;
  bytes: number;
}
/** Reproducible geometry screening policy; older records may omit this metadata. */
export interface ModelLibraryScreeningPolicy {
  maxTriangles: number;
  maxExtentMm: number;
  toMillimetresZUp: number[];
  maxAnalysisBytes: number;
  maxAnalysisTriangles: number;
}
export interface ModelLibraryContentGrant {
  spdx: ModelLibraryContentLicence;
  scope: 'asset';
  attribution: string;
  evidenceUrl: string;
  capturedOn: string;
  review: 'accepted';
  reviewer: string;
}
/** Exact local originals used by a bounded source closure. LDraw is archival, not executable source interchange. */
export interface ModelLibrarySourceBundle {
  format: 'brickwright-openscad-bundle' | 'brickwright-ldraw-bundle';
  version: 1;
  rootPath: string;
  dependencies: {
    path: string;
    file: ModelLibraryFile;
    author: string;
    sourceUrl: string;
    sourceRevision: {repositoryUrl: string; commit: string};
    licence: ModelLibraryContentGrant;
  }[];
}
export interface ModelLibraryAsset {
  id: string;
  version: string;
  title: string;
  author: string;
  sourceUrl: string;
  /** Optional for legacy records; curated repository sources use a full immutable commit. */
  sourceRevision?: {repositoryUrl: string; commit: string};
  /** A curator's assertion that the grant covers the asset, not just loader code. */
  licence: ModelLibraryContentGrant;
  original: ModelLibraryFile;
  sourceBundle?: ModelLibrarySourceBundle;
  /** Preserve editable CAD here when the primary original is a mesh. */
  editableSource?: ModelLibraryFile;
  derivatives: ModelLibraryFile[];
  modificationNotes: string;
  conversion: {
    sourceUnits: 'mm' | 'cm' | 'm' | 'in' | 'ldu';
    unitAssumption: string;
    sourceUpAxis: 'X' | 'Y' | 'Z' | '-X' | '-Y' | '-Z';
    /** Column-major affine matrix from source coordinates to millimetres, Z up. */
    toMillimetresZUp: number[];
  };
  quality?: {
    fileSha256: string;
    toolVersion: string;
    checkedOn: string;
    parseable: boolean;
    closedPositiveVolume: boolean;
    withinSizeLimits: boolean;
    withinTriangleLimits: boolean;
    screeningPolicy?: ModelLibraryScreeningPolicy;
    /** Complete versioned curation report; never a runtime collision proof. */
    collisionReport?: ModelLibraryCollisionReport;
    /** Separate collision qualification; visual import never implies physics safety. */
    physics?: {engine: 'Jolt'; engineVersion: string; qualifierVersion: string; qualified: boolean};
  };
}
export interface ModelLibraryCatalogue {
  format: 'brickwright-model-library';
  version: 1;
  assets: ModelLibraryAsset[];
}
export type ModelLibraryValidation =
  | {valid: true; catalogue: ModelLibraryCatalogue; errors: []}
  | {valid: false; errors: string[]};
export const MAX_MODEL_LIBRARY_BYTES = 4 * 1024 * 1024;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max = 4096): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max && !/[\u0000-\u001f]/.test(v);
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const url = (v: unknown): boolean => {
  if (!text(v, 8192)) return false;
  try { const u = new URL(v); return u.protocol === 'https:' && !u.username && !u.password; } catch { return false; }
};
const date = (v: unknown): boolean => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const parsed = new Date(v); return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === v;
};
const keys = (v: Record<string, unknown>, allowed: string): boolean => Object.keys(v).every(key => allowed.split(' ').includes(key));
/** Local identities are rooted at library/, never OS paths or network endpoints. */
export const isModelLibraryLocalPath = (v: unknown): v is string => typeof v === 'string' && v.length <= 512 && /^(?:sources|meshes|evidence)\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.[A-Za-z0-9._-]+$/.test(v);
const file = (v: unknown): v is unknown & ModelLibraryFile => object(v) && keys(v, 'url path format sha256 bytes') && ((Object.hasOwn(v, 'url') && !Object.hasOwn(v, 'path') && url(v.url)) || (Object.hasOwn(v, 'path') && !Object.hasOwn(v, 'url') && isModelLibraryLocalPath(v.path))) && text(v.format, 80) && /^[a-zA-Z0-9][a-zA-Z0-9.+_-]*$/.test(v.format) && hash(v.sha256) && Number.isSafeInteger(v.bytes) && (v.bytes as number) > 0;
const grant = (v: unknown): boolean => object(v) && keys(v, 'spdx scope attribution evidenceUrl capturedOn review reviewer') && (MODEL_LIBRARY_CONTENT_LICENCES as readonly unknown[]).includes(v.spdx) && v.scope === 'asset' && v.review === 'accepted' && text(v.reviewer, 240) && text(v.attribution) && url(v.evidenceUrl) && date(v.capturedOn);
const revision = (v: unknown): boolean => object(v) && keys(v, 'repositoryUrl commit') && url(v.repositoryUrl) && typeof v.commit === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(v.commit);
const bundlePath = (v: unknown, format = 'openscad'): v is string => typeof v === 'string' && v.length <= 512 && (format === 'ldraw' ? /^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.dat$/ : /^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.scad$/).test(v);
function invertibleAffine(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== 16 || !value.every(n => typeof n === 'number' && Number.isFinite(n)) || value[3] !== 0 || value[7] !== 0 || value[11] !== 0 || value[15] !== 1) return false;
  const m = value;
  const determinant = m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);
  return Number.isFinite(determinant) && determinant !== 0;
}
/**
 * Validate metadata only, without downloading files or establishing legal rights.
 * The accepted review and evidence fields record curation; they do not verify it.
 * Unknown versions are refused. Invalid input returns diagnostics without mutation.
 */
export function validateModelLibraryCatalogue(value: unknown): ModelLibraryValidation {
  try { return checkModelLibraryCatalogue(value); }
  catch { return {valid: false, errors: ['Catalogue must contain plain serializable metadata.']}; }
}
function checkModelLibraryCatalogue(value: unknown): ModelLibraryValidation {
  const errors: string[] = [];
  if (!object(value) || !keys(value, 'format version assets') || value.format !== 'brickwright-model-library' || value.version !== 1 || !Array.isArray(value.assets) || value.assets.length > 1000) {
    return {valid: false, errors: ['Unsupported model library format, version or asset list (maximum 1000).']};
  }
  const ids = new Set<string>();
  value.assets.forEach((asset: unknown, index: number) => {
    const error = (message: string) => errors.push(`assets[${index}]: ${message}`);
    if (!object(asset)) { error('Expected an asset record.'); return; }
    if (!keys(asset, 'id version title author sourceUrl sourceRevision licence original sourceBundle editableSource derivatives modificationNotes conversion quality')) error('Unknown asset fields; review the schema before extending it.');
    if (!text(asset.id, 96) || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(asset.id) || ['__proto__', 'prototype', 'constructor'].includes(asset.id)) error('Invalid stable asset ID.');
    else if (ids.has(asset.id)) error('Duplicate asset ID.');
    else ids.add(asset.id);
    if (!text(asset.version, 96) || !text(asset.title, 240) || !text(asset.author, 1000) || !url(asset.sourceUrl)) error('Missing identity or HTTPS source URL.');
    if (asset.sourceRevision !== undefined) {
      const revision = asset.sourceRevision;
      if (!object(revision) || !keys(revision, 'repositoryUrl commit') || !url(revision.repositoryUrl) || typeof revision.commit !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(revision.commit)) error('Source revision requires an HTTPS repository URL and full lowercase Git commit hash.');
    }
    const licence = asset.licence;
    if (!grant(licence)) error('An allowlisted exact content licence, asset grant, attribution and reviewed evidence are required.');
    if (!file(asset.original)) error('Invalid original file identity.');
    if (asset.sourceBundle !== undefined) {
      const bundle = asset.sourceBundle;
      const sourceFormat = object(bundle) && bundle.format === 'brickwright-ldraw-bundle' ? 'ldraw' : 'openscad';
      if (!object(bundle) || !keys(bundle, 'format version rootPath dependencies') || !['brickwright-openscad-bundle', 'brickwright-ldraw-bundle'].includes(String(bundle.format)) || bundle.version !== 1 || !bundlePath(bundle.rootPath, sourceFormat) || !Array.isArray(bundle.dependencies) || !bundle.dependencies.length || bundle.dependencies.length > 31 || !file(asset.original) || !asset.original.path || asset.original.format !== sourceFormat || asset.editableSource !== undefined) error('Invalid local source bundle (maximum 32 original files).');
      else {
        const paths = new Set([bundle.rootPath]), files = new Set([asset.original.path]);
        let total = asset.original.bytes;
        for (const dependency of bundle.dependencies) {
          if (!object(dependency) || !keys(dependency, 'path file author sourceUrl sourceRevision licence') || !bundlePath(dependency.path, sourceFormat) || paths.has(dependency.path) || !file(dependency.file) || !dependency.file.path || dependency.file.format !== sourceFormat || files.has(dependency.file.path) || !text(dependency.author, 1000) || !url(dependency.sourceUrl) || !revision(dependency.sourceRevision) || !grant(dependency.licence)) { error('Every source dependency requires a distinct local original, pinned revision and reviewed grant.'); continue; }
          paths.add(dependency.path); files.add(dependency.file.path); total += dependency.file.bytes;
        }
        if (total > 32768) error('Original source bundle exceeds 32 KiB.');
      }
    }
    if (asset.editableSource !== undefined && !file(asset.editableSource)) error('Invalid editable source identity.');
    if (!Array.isArray(asset.derivatives) || asset.derivatives.length > 32 || !asset.derivatives.every(file)) error('Invalid derivative file identities (maximum 32).');
    if (!text(asset.modificationNotes)) error('Explicit modification notes are required, including when unchanged.');
    const conversion = asset.conversion;
    if (!object(conversion) || !keys(conversion, 'sourceUnits unitAssumption sourceUpAxis toMillimetresZUp') || !['mm', 'cm', 'm', 'in', 'ldu'].includes(String(conversion.sourceUnits)) || !text(conversion.unitAssumption) || !['X', 'Y', 'Z', '-X', '-Y', '-Z'].includes(String(conversion.sourceUpAxis))) error('Explicit source units, assumption and up axis are required.');
    else {
      const m = conversion.toMillimetresZUp;
      if (!Array.isArray(m) || m.length !== 16 || !m.every(n => typeof n === 'number' && Number.isFinite(n)) || m[3] !== 0 || m[7] !== 0 || m[11] !== 0 || m[15] !== 1) error('Conversion must be a finite column-major affine 4×4 matrix.');
      else {
        const determinant = m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);
        if (!Number.isFinite(determinant) || determinant === 0) error('Conversion matrix must be invertible.');
      }
    }
    if (asset.quality !== undefined) {
      const q = asset.quality;
      if (!object(q) || !keys(q, 'fileSha256 toolVersion checkedOn parseable closedPositiveVolume withinSizeLimits withinTriangleLimits screeningPolicy physics collisionReport') || !hash(q.fileSha256) || !text(q.toolVersion, 240) || !date(q.checkedOn) || !['parseable', 'closedPositiveVolume', 'withinSizeLimits', 'withinTriangleLimits'].every(key => typeof q[key] === 'boolean')) error('Invalid quality evidence.');
      else {
        const files = [asset.original, ...(Array.isArray(asset.derivatives) ? asset.derivatives : [])];
        if (!files.some(f => file(f) && f.sha256 === q.fileSha256)) error('Quality evidence must name an original or derivative hash.');
        if (files.some(f => file(f) && f.sha256 === q.fileSha256 && isModelLibrarySourceFormat(f.format))) error('Geometry quality evidence must identify rendered geometry, not program source.');
        if (!q.parseable && (q.closedPositiveVolume || q.withinSizeLimits || q.withinTriangleLimits)) error('Unparseable geometry cannot pass geometry checks.');
        if (q.screeningPolicy !== undefined) {
          const p = q.screeningPolicy;
          if (!object(p) || !keys(p, 'maxTriangles maxExtentMm toMillimetresZUp maxAnalysisBytes maxAnalysisTriangles') ||
              !Number.isSafeInteger(p.maxTriangles) || (p.maxTriangles as number) < 1 ||
              !Number.isSafeInteger(p.maxAnalysisTriangles) || (p.maxAnalysisTriangles as number) < (p.maxTriangles as number) ||
              !Number.isSafeInteger(p.maxAnalysisBytes) || (p.maxAnalysisBytes as number) < 1 ||
              typeof p.maxExtentMm !== 'number' || !Number.isFinite(p.maxExtentMm) || p.maxExtentMm <= 0 || !invertibleAffine(p.toMillimetresZUp)) error('Invalid reproducible mesh screening policy.');
        }
        if (q.collisionReport !== undefined && !validModelLibraryCollisionReport(q.collisionReport, asset as unknown as ModelLibraryAsset)) error('Invalid complete collision qualification report or bindings.');
        if (q.physics !== undefined) {
          const p = q.physics;
          if (!object(p) || !keys(p, 'engine engineVersion qualifierVersion qualified') || p.engine !== 'Jolt' || !text(p.engineVersion, 240) || !text(p.qualifierVersion, 240) || typeof p.qualified !== 'boolean') error('Invalid versioned physics evidence.');
          else if (p.qualified && !(q.parseable && q.closedPositiveVolume && q.withinSizeLimits && q.withinTriangleLimits)) error('Physics qualification requires all geometry checks to pass.');
        }
      }
    }
  });
  if (errors.length) return {valid: false, errors};
  // Clone to prevent a caller from changing accepted metadata through the input.
  try { return {valid: true, catalogue: structuredClone(value) as unknown as ModelLibraryCatalogue, errors: []}; }
  catch { return {valid: false, errors: ['Catalogue must contain serializable metadata.']}; }
}
export function parseModelLibraryCatalogue(source: string): ModelLibraryValidation {
  if (typeof source !== 'string' || new TextEncoder().encode(source).length > MAX_MODEL_LIBRARY_BYTES) return {valid: false, errors: ['Model library exceeds 4 MiB or is not text.']};
  try { return validateModelLibraryCatalogue(JSON.parse(source)); }
  catch { return {valid: false, errors: ['Invalid model library JSON.']}; }
}
