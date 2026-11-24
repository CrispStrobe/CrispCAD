// SPDX-License-Identifier: BSD-3-Clause
// Brickwright adapter over the ported kernelCAD mesh DFM checks. Screening
// only: the results are sampled, tessellation-bounded estimates, not a
// guarantee that a slicer or printer will succeed.
import type { BodyMesh } from '../kernel.js';
import { checkMinWall, type WallViolationCluster } from './minWall.js';
import { prepareFdmMesh, rankOrientations, type FdmAxisLabel, type FdmOrientationResult, type OverhangStatus } from './fdmOrientation.js';
import { TriangleBvh } from './meshBvh.js';
import type { Vec3 } from './vec3.js';

export const PRINTABILITY_CHECK_VERSION = 1;

export interface PrintabilitySettings {
  nozzleMm: number;
  maxOverhangDeg: number;
  maxBridgeMm: number;
  minWallMm: number;
  bedSizeMm: { x: number; y: number; z: number };
}

export const DEFAULT_PRINTABILITY_SETTINGS: Readonly<PrintabilitySettings> = Object.freeze({
  nozzleMm: 0.4,
  maxOverhangDeg: 45,
  maxBridgeMm: 10,
  minWallMm: 0.8,
  bedSizeMm: Object.freeze({ x: 220, y: 220, z: 250 }),
});

export interface MeshTopologyCheck {
  watertight: boolean;
  /** Edges used by exactly one triangle. */
  openEdges: number;
  /** Edges used by more than two triangles, or twice with the same direction. */
  nonManifoldEdges: number;
  degenerateTriangles: number;
}

export interface PrintOrientationSummary {
  label?: FdmAxisLabel;
  /** Build direction in the model frame; it is rotated to +Z for printing. */
  buildDirection: Vec3;
  /** Right-handed rotation about a world axis through the origin. */
  rotation: { axis: Vec3; deg: number };
  sizeMm: { x: number; y: number; z: number };
  fitsBed: boolean;
  unsupportedAreaMm2: number;
  /** Total steep regions; `overhangs` lists the largest few. */
  overhangRegions: number;
  overhangs: { status: OverhangStatus; areaMm2: number; maxOverhangDeg: number; spanMm?: number; reachMm?: number; bboxMin: Vec3; bboxMax: Vec3 }[];
  bedContactMm2: number;
  bedContactLow: boolean;
  tipRisk: boolean;
}

export interface BodyPrintability {
  id: string;
  name: string;
  triangles: number;
  topology: MeshTopologyCheck;
  minWall: { thresholdMm: number; thinnestMm: number | null; violations: WallViolationCluster[]; truncated: boolean; sampleCount: number };
  /** All six axis-aligned build directions, best first. Absent for meshes that are not watertight. */
  orientations?: PrintOrientationSummary[];
  /** The current orientation (+Z build direction), for comparison with the best. */
  current?: PrintOrientationSummary;
}

export interface PrintabilityReport {
  version: typeof PRINTABILITY_CHECK_VERSION;
  settings: PrintabilitySettings;
  bodies: BodyPrintability[];
  /** Plain-language summary flags for the whole design. */
  issues: string[];
  disclaimer: string;
}

const MAX_TRIANGLES = 500_000;
const MAX_REPORTED_OVERHANGS = 10;

/** Weld exact duplicate coordinates; manifold output is normally already welded. */
function weld(body: Pick<BodyMesh, 'positions' | 'indices'>): { vertices: number[]; triangles: number[] } {
  const map = new Map<string, number>(), remap = new Int32Array(body.positions.length / 3), vertices: number[] = [];
  for (let i = 0; i < remap.length; i++) {
    const x = body.positions[3 * i], y = body.positions[3 * i + 1], z = body.positions[3 * i + 2], key = `${x},${y},${z}`;
    let index = map.get(key);
    if (index === undefined) { index = vertices.length / 3; vertices.push(x, y, z); map.set(key, index); }
    remap[i] = index;
  }
  return { vertices, triangles: Array.from(body.indices, i => remap[i]) };
}

export function checkMeshTopology(mesh: { vertices: ArrayLike<number>; triangles: ArrayLike<number> }): MeshTopologyCheck {
  // Per undirected edge: uses in the low→high and high→low vertex direction.
  const edges = new Map<string, [number, number]>();
  let degenerateTriangles = 0;
  for (let t = 0; t < mesh.triangles.length; t += 3) {
    const v = [mesh.triangles[t], mesh.triangles[t + 1], mesh.triangles[t + 2]];
    if (v[0] === v[1] || v[1] === v[2] || v[2] === v[0]) { degenerateTriangles++; continue; }
    for (let k = 0; k < 3; k++) {
      const a = v[k], b = v[(k + 1) % 3], key = a < b ? `${a},${b}` : `${b},${a}`, uses = edges.get(key) ?? [0, 0];
      uses[a < b ? 0 : 1]++; edges.set(key, uses);
    }
  }
  let openEdges = 0, nonManifoldEdges = 0;
  for (const [forward, backward] of edges.values()) {
    if (forward + backward === 1) openEdges++;
    else if (forward !== 1 || backward !== 1) nonManifoldEdges++;
  }
  return { watertight: openEdges === 0 && nonManifoldEdges === 0 && degenerateTriangles === 0, openEdges, nonManifoldEdges, degenerateTriangles };
}

function summarize(result: FdmOrientationResult): PrintOrientationSummary {
  return {
    ...(result.label !== undefined ? { label: result.label } : {}),
    buildDirection: result.buildDirection,
    rotation: { axis: result.rotation.axis, deg: result.rotation.deg },
    sizeMm: result.sizeMm,
    fitsBed: result.fitsBed,
    unsupportedAreaMm2: result.unsupportedAreaMm2,
    overhangRegions: result.overhangs.length,
    overhangs: result.overhangs.slice(0, MAX_REPORTED_OVERHANGS).map(({ status, areaMm2, maxOverhangDeg, spanMm, reachMm, bboxMin, bboxMax }) => ({ status, areaMm2, maxOverhangDeg, ...(spanMm !== undefined ? { spanMm } : {}), ...(reachMm !== undefined && Number.isFinite(reachMm) ? { reachMm } : {}), bboxMin, bboxMax })),
    bedContactMm2: result.bedContact.areaMm2,
    bedContactLow: result.bedContactLow,
    tipRisk: result.tipRisk,
  };
}

function validSettings(input: Partial<PrintabilitySettings>): PrintabilitySettings {
  const s: PrintabilitySettings = { ...DEFAULT_PRINTABILITY_SETTINGS, ...input, bedSizeMm: { ...DEFAULT_PRINTABILITY_SETTINGS.bedSizeMm, ...input.bedSizeMm } };
  const positive = [s.nozzleMm, s.maxBridgeMm, s.minWallMm, s.bedSizeMm.x, s.bedSizeMm.y, s.bedSizeMm.z];
  if (positive.some(v => !Number.isFinite(v) || v <= 0 || v > 1e5) || !Number.isFinite(s.maxOverhangDeg) || s.maxOverhangDeg <= 0 || s.maxOverhangDeg >= 90)
    throw new RangeError('Printability settings must be finite positive millimetres and an overhang angle between 0 and 90 degrees');
  return s;
}

/** Screen evaluated solid bodies for FDM printing: watertightness, sampled
 *  minimum wall thickness, overhangs/bridges and the six axis orientations. */
export function checkPrintability(bodies: readonly BodyMesh[], options: Partial<PrintabilitySettings> = {}): PrintabilityReport {
  const settings = validSettings(options);
  const solids = bodies.filter(b => !b.reference && !b.hole && b.indices.length > 0);
  const total = solids.reduce((n, b) => n + b.indices.length / 3, 0);
  if (total > MAX_TRIANGLES) throw new RangeError(`Printability check is limited to ${MAX_TRIANGLES} triangles; the design has ${total}`);
  const issues: string[] = [];
  const reports = solids.map((body): BodyPrintability => {
    const mesh = weld(body), topology = checkMeshTopology(mesh);
    const wall = checkMinWall(mesh, settings.minWallMm, { bvh: new TriangleBvh(mesh) });
    const report: BodyPrintability = {
      id: body.id, name: body.name, triangles: mesh.triangles.length / 3, topology,
      minWall: { thresholdMm: settings.minWallMm, thinnestMm: Number.isFinite(wall.thinnestMm) ? wall.thinnestMm : null, violations: wall.violations, truncated: wall.truncated, sampleCount: wall.sampleCount },
    };
    if (!topology.watertight) { issues.push(`${body.name}: mesh is not watertight (${topology.openEdges} open, ${topology.nonManifoldEdges} non-manifold edges)`); }
    else {
      const triCount = mesh.triangles.length / 3;
      const prep = prepareFdmMesh({ vertices: mesh.vertices, triangles: mesh.triangles, faceOfTri: Array.from({ length: triCount }, (_, i) => i), faceRefs: [] });
      const ranked = rankOrientations(prep, settings).map(summarize);
      report.orientations = ranked;
      report.current = ranked.find(r => r.label === '+z');
      const best = ranked[0];
      if (!best.fitsBed) issues.push(`${body.name}: does not fit the ${settings.bedSizeMm.x}×${settings.bedSizeMm.y}×${settings.bedSizeMm.z} mm bed in any axis orientation`);
      else if (best.unsupportedAreaMm2 > 0) issues.push(`${body.name}: needs support in every axis orientation (best ${best.label}: ${best.unsupportedAreaMm2.toFixed(1)} mm² unsupported)`);
      if (report.current && best.label !== '+z' && report.current.unsupportedAreaMm2 > best.unsupportedAreaMm2) issues.push(`${body.name}: printing with ${best.label} up reduces unsupported area`);
    }
    if (wall.violations.length) issues.push(`${body.name}: walls thinner than ${settings.minWallMm} mm (thinnest ${wall.thinnestMm.toFixed(2)} mm)`);
    return report;
  });
  return { version: PRINTABILITY_CHECK_VERSION, settings, bodies: reports, issues, disclaimer: 'Sampled engineering screening of the tessellated mesh, not a guarantee of a successful print.' };
}
