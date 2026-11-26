// SPDX-License-Identifier: BSD-3-Clause
// Faceting tolerance for comparing a Manifold build (circles as N-gons) with an exact
// B-rep build (true circles) of the same compiled CAD Script.
//
// Every curved construct in a CodeShape tree is collected with its segment count N and a
// nominal size (volume, surface, radius). The inscribed N-gon of a circle has the area
// ratio sin(2π/N)/(2π/N), so its relative volume deficit is
//   δ(N) = 1 − sin(2π/N) / (2π/N)   (≈ (2π/N)²/6: 2.85e-3 at N = 48, 9.97e-2 at N = 8)
// for prisms and full revolutions. A Boolean can turn a deficit into a surplus but cannot
// make it larger than the curved volume involved, so the absolute volume tolerance is
//   2 · Σ f_kind · δ(N_i) · V_i  +  1e-6 · V
// with V_i the nominal volume of curved construct i and f_kind a factor measured once per
// run against Manifold (see `calibrate` in worker.ts; 1 for prisms, larger for spheres).
// Area uses the same sum over nominal surfaces; the bbox may shrink by r·(1 − cos(π/N)) per
// curved construct (vertices lie on the circle, edge midpoints inside it), times a measured
// factor for rotated constructs (Manifold's sphere has coarser vertex spacing than π/N).
import { shapeBoundsBySide, smoothLoftCurves, smoothLoftRing, twistedLoftQuad, type CodeShape, type CodeProfile, type Vec3 } from '@brickwright/cad-core';

export type CurvedKind = 'prism' | 'sphere' | 'revolve';
export interface Curved { kind: CurvedKind; segments: number; volume: number; surface: number; radius: number }
export interface Calibration { volume: Record<CurvedKind, number>; area: Record<CurvedKind, number>; bbox: Record<CurvedKind, number> }
export interface Tolerance { volume: number; area: number; bbox: number; minSegments: number | null; curved: number; approximate: boolean; /** Loft quads whose mesh differs from the exact surface: twisted ruled-loft quads (CAD Script revision 2) and smoothLoft quads. */ loftQuads?: number; /** Of those, the quads a Boolean operand can reach. */ exposedQuads?: number; /** |Σ mesh − surface area| of the unreachable quads plus Σ (|mesh − surface| + 2 · thickness · extent) of the reachable ones, mm². */ loftArea?: number; /** |Σ enclosed volume difference| of the unreachable quads plus the unsigned gap volume of the reachable ones, mm³. */ loftVolume?: number }

export const delta = (n: number) => { const a = 2 * Math.PI / n; return 1 - Math.sin(a) / a; };
export const chord = (n: number) => 1 - Math.cos(Math.PI / n);

interface Mass { area: number; cx: number; cy: number; perimeter: number; min: [number, number]; max: [number, number] }
const EMPTY: Mass = { area: 0, cx: 0, cy: 0, perimeter: 0, min: [0, 0], max: [0, 0] };

/** Nominal area, centroid, perimeter and bounds of a profile. Exact for polygons, rectangles
 * and circles under move/rotate/scale; approximate (and flagged) for Booleans and the rest. */
function profileMass(p: CodeProfile, curved: Curved[] | null, flags: { approximate: boolean }, height: number): Mass {
  switch (p.kind) {
    case 'empty': return EMPTY;
    case 'polygon': {
      let area = 0, sx = 0, sy = 0, perimeter = 0;
      const min: [number, number] = [Infinity, Infinity], max: [number, number] = [-Infinity, -Infinity];
      for (const c of p.contours) for (let i = 0; i < c.length; i++) {
        const [x0, y0] = c[i], [x1, y1] = c[(i + 1) % c.length], cross = x0 * y1 - x1 * y0;
        area += cross; sx += (x0 + x1) * cross; sy += (y0 + y1) * cross; perimeter += Math.hypot(x1 - x0, y1 - y0);
        min[0] = Math.min(min[0], x0); min[1] = Math.min(min[1], y0); max[0] = Math.max(max[0], x0); max[1] = Math.max(max[1], y0);
      }
      area /= 2;
      return Math.abs(area) < 1e-300 ? { ...EMPTY, perimeter, min, max } : { area: Math.abs(area), cx: sx / (6 * area), cy: sy / (6 * area), perimeter, min, max };
    }
    case 'circle': {
      const r = p.radius;
      curved?.push({ kind: 'prism', segments: p.segments, volume: Math.PI * r * r * height, surface: 2 * Math.PI * r * r + 2 * Math.PI * r * height, radius: r });
      return { area: Math.PI * r * r, cx: 0, cy: 0, perimeter: 2 * Math.PI * r, min: [-r, -r], max: [r, r] };
    }
    case 'rectangle': {
      const [w, h] = p.size, x0 = p.center ? -w / 2 : 0, y0 = p.center ? -h / 2 : 0;
      return { area: w * h, cx: x0 + w / 2, cy: y0 + h / 2, perimeter: 2 * (w + h), min: [x0, y0], max: [x0 + w, y0 + h] };
    }
    case 'move': {
      const m = profileMass(p.profile, curved, flags, height), [dx, dy] = p.vector;
      return { ...m, cx: m.cx + dx, cy: m.cy + dy, min: [m.min[0] + dx, m.min[1] + dy], max: [m.max[0] + dx, m.max[1] + dy] };
    }
    case 'rotate': {
      const m = profileMass(p.profile, curved, flags, height), a = p.angle * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
      const corners = [[m.min[0], m.min[1]], [m.max[0], m.min[1]], [m.min[0], m.max[1]], [m.max[0], m.max[1]]].map(([x, y]) => [c * x - s * y, s * x + c * y]);
      return { ...m, cx: c * m.cx - s * m.cy, cy: s * m.cx + c * m.cy, min: [Math.min(...corners.map(q => q[0])), Math.min(...corners.map(q => q[1]))], max: [Math.max(...corners.map(q => q[0])), Math.max(...corners.map(q => q[1]))] };
    }
    case 'scale': case 'affine': case 'resize': {
      const inner: Curved[] = [];
      const m = profileMass(p.profile, curved ? inner : null, flags, height);
      let sx = 1, sy = 1, tx = 0, ty = 0;
      if (p.kind === 'scale') [sx, sy] = p.vector;
      else if (p.kind === 'affine') { sx = Math.hypot(p.matrix[0], p.matrix[3]); sy = Math.hypot(p.matrix[1], p.matrix[4]); tx = p.matrix[2]; ty = p.matrix[5]; flags.approximate ||= Math.abs(p.matrix[1]) + Math.abs(p.matrix[3]) > 1e-12; }
      else { const size = (p as Extract<CodeProfile, { kind: 'resize' }>).size, w = m.max[0] - m.min[0], h = m.max[1] - m.min[1]; sx = size[0] && w ? size[0] / w : 1; sy = size[1] && h ? size[1] / h : 1; flags.approximate = true; }
      const f = Math.abs(sx * sy), g = Math.max(Math.abs(sx), Math.abs(sy));
      for (const c of inner) curved!.push({ ...c, volume: c.volume * f, surface: c.surface * g * g, radius: c.radius * g });
      const xs = [m.min[0] * sx + tx, m.max[0] * sx + tx], ys = [m.min[1] * sy + ty, m.max[1] * sy + ty];
      return { area: m.area * f, cx: m.cx * sx + tx, cy: m.cy * sy + ty, perimeter: m.perimeter * g, min: [Math.min(...xs), Math.min(...ys)], max: [Math.max(...xs), Math.max(...ys)] };
    }
    case 'offset': {
      const m = profileMass(p.profile, curved, flags, height), d = Math.abs(p.distance);
      if (p.round) curved?.push({ kind: 'prism', segments: p.segments, volume: Math.PI * d * d * height, surface: 2 * Math.PI * d * d + 2 * Math.PI * d * height, radius: d });
      const sign = Math.sign(p.distance);
      return { area: Math.max(0, m.area + sign * (m.perimeter * d + (p.round ? Math.PI : 4) * d * d)), cx: m.cx, cy: m.cy, perimeter: m.perimeter + sign * 2 * Math.PI * d, min: [m.min[0] - p.distance, m.min[1] - p.distance], max: [m.max[0] + p.distance, m.max[1] + p.distance] };
    }
    case 'text': flags.approximate = true; return EMPTY;
    case 'union': case 'subtract': case 'intersect': case 'hull': case 'minkowski': {
      const ms = p.profiles.map(c => profileMass(c, curved, flags, height)).filter(m => m.area > 0 || m.perimeter > 0);
      if (!ms.length) return EMPTY;
      flags.approximate ||= ms.length > 1;
      const min: [number, number] = [Math.min(...ms.map(m => m.min[0])), Math.min(...ms.map(m => m.min[1]))], max: [number, number] = [Math.max(...ms.map(m => m.max[0])), Math.max(...ms.map(m => m.max[1]))];
      const area = p.kind === 'subtract' ? Math.max(0, ms[0].area - ms.slice(1).reduce((s, m) => s + m.area, 0)) : p.kind === 'intersect' ? Math.min(...ms.map(m => m.area)) : p.kind === 'union' ? ms.reduce((s, m) => s + m.area, 0) : (max[0] - min[0]) * (max[1] - min[1]);
      const w = ms.reduce((s, m) => s + m.area, 0) || 1;
      return { area, cx: ms.reduce((s, m) => s + m.cx * m.area, 0) / w, cy: ms.reduce((s, m) => s + m.cy * m.area, 0) / w, perimeter: ms.reduce((s, m) => s + m.perimeter, 0), min, max };
    }
  }
}

// 8-point Gauss-Legendre on [0, 1].
const GL_X = [-0.9602898564975363, -0.7966664774136267, -0.5255324099163290, -0.1834346424956498, 0.1834346424956498, 0.5255324099163290, 0.7966664774136267, 0.9602898564975363].map(x => (x + 1) / 2);
const GL_W = [0.1012285362903763, 0.2223810344533745, 0.3137066458778873, 0.3626837833783620, 0.3626837833783620, 0.3137066458778873, 0.2223810344533745, 0.1012285362903763].map(w => w / 2);
type P3 = readonly number[];
const cross3 = (u: P3, v: P3) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
const sub3 = (a: P3, b: P3) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a: P3, b: P3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len3 = (u: P3) => Math.hypot(u[0], u[1], u[2]);

/** One side quad of a loft mesh between two rings: corners a, b (lower ring, vertex j, j+1) and
 * d, c above them. The mesh has two triangles (planar quad) or the four-triangle fan around the
 * corners' mean (twisted). `surface(u, v)` is the exact kernel's surface over the quad: the ruled
 * (bilinear) patch for `loft`, the smooth surface for `smoothLoft`. */
export interface LoftQuad { corners: [P3, P3, P3, P3]; surface: (u: number, v: number) => number[]; /** A ruled patch lies within its corners' hull, so it cannot widen the box. */ ruled?: boolean }
/** How a quad's mesh and the exact surface differ. `area` is mesh − surface (signed), `volume` the
 * volume enclosed by the mesh minus that under the surface (signed, along the outward normal),
 * `gap` the unsigned volume between them and `thickness` their largest normal distance. */
export interface QuadDifference { area: number; volume: number; gap: number; thickness: number; extent: number }

/** Compare one quad's mesh with the surface: each mesh triangle is split into K² sub-triangles
 * and the surface point at the same (u, v) is measured along the triangle's normal (midpoint
 * rule); the surface area by 8 × 8 Gauss-Legendre. */
export function quadDifference(q: LoftQuad, K = 6): QuadDifference {
  const [a, b, c, d] = q.corners;
  const twisted = Math.abs(dot3(sub3(b, a), cross3(sub3(c, a), sub3(d, a)))) > 1e-9 * len3(sub3(b, a)) * len3(sub3(c, a)) * len3(sub3(d, a));
  const m = [0, 1, 2].map(e => (a[e] + b[e] + c[e] + d[e]) / 4);
  // Mesh triangles as (parameter, point) corner triples.
  const tris: [number[], P3][][] = twisted
    ? [[[[0, 0], a], [[1, 0], b], [[.5, .5], m]], [[[1, 0], b], [[1, 1], c], [[.5, .5], m]], [[[1, 1], c], [[0, 1], d], [[.5, .5], m]], [[[0, 1], d], [[0, 0], a], [[.5, .5], m]]]
    : [[[[0, 0], a], [[1, 0], b], [[1, 1], c]], [[[0, 0], a], [[1, 1], c], [[0, 1], d]]];
  let meshArea = 0, volume = 0, gap = 0, thickness = 0;
  for (const tri of tris) {
    const [[p0, q0], [p1, q1], [p2, q2]] = tri, normal = cross3(sub3(q1, q0), sub3(q2, q0)), twice = len3(normal);
    if (!twice) continue;
    meshArea += twice / 2;
    const unit = normal.map(x => x / twice);
    for (let i = 0; i < K; i++) for (let k = 0; k < K - i; k++) for (const up of [false, true]) {
      if (up && k === K - i - 1) continue;
      const w1 = up ? (i + 2 / 3) / K : (i + 1 / 3) / K, w2 = up ? (k + 2 / 3) / K : (k + 1 / 3) / K, w0 = 1 - w1 - w2;
      const u = w0 * p0[0] + w1 * p1[0] + w2 * p2[0], v = w0 * p0[1] + w1 * p1[1] + w2 * p2[1];
      const L = [0, 1, 2].map(e => w0 * q0[e] + w1 * q1[e] + w2 * q2[e]), dev = dot3(sub3(q.surface(u, v), L), unit);
      // dev > 0: the surface lies outside the mesh there, so the mesh encloses less.
      volume -= dev * (twice / 2) / (K * K); gap += Math.abs(dev) * (twice / 2) / (K * K); thickness = Math.max(thickness, Math.abs(dev));
    }
  }
  let surfaceArea = 0;
  const h = 1e-6;
  for (let i = 0; i < 8; i++) for (let k = 0; k < 8; k++) {
    const u = GL_X[i], v = GL_X[k];
    const pu = sub3(q.surface(Math.min(1, u + h), v), q.surface(Math.max(0, u - h), v)).map(x => x / (Math.min(1, u + h) - Math.max(0, u - h)));
    const pv = sub3(q.surface(u, Math.min(1, v + h)), q.surface(u, Math.max(0, v - h))).map(x => x / (Math.min(1, v + h) - Math.max(0, v - h)));
    surfaceArea += GL_W[i] * GL_W[k] * len3(cross3(pu, pv));
  }
  const extent = Math.max(len3(sub3(c, a)), len3(sub3(d, b)), len3(sub3(b, a)), len3(sub3(c, d)), len3(sub3(d, a)), len3(sub3(c, b)));
  return { area: meshArea - surfaceArea, volume, gap, thickness, extent };
}

/** The ruled (bilinear) patch through a quad's corners. */
export const bilinear = (a: P3, b: P3, c: P3, d: P3) => (u: number, v: number) => [0, 1, 2].map(e => (1 - u) * (1 - v) * a[e] + u * (1 - v) * b[e] + u * v * c[e] + (1 - u) * v * d[e]);

/** The side quads of a revision-2 loft's twisted quads (planar quads are exact in both builds). */
export function ruledQuads(sections: readonly (readonly P3[])[]): LoftQuad[] {
  const out: LoftQuad[] = [];
  for (let s = 0; s + 1 < sections.length; s++) for (let j = 0; j < sections[s].length; j++) {
    const n = sections[s].length, a = sections[s][j], b = sections[s][(j + 1) % n], c = sections[s + 1][(j + 1) % n], d = sections[s + 1][j];
    if (!twistedLoftQuad(a as Vec3, b as Vec3, c as Vec3, d as Vec3)) continue;
    out.push({ corners: [a, b, c, d], surface: bilinear(a, b, c, d), ruled: true });
  }
  return out;
}

/** The side quads of a `smoothLoft` mesh, each with the smooth surface over it. The mesh rings
 * (ascending Z, counter-clockwise) are read from the compiled polyhedron; each ring's surface
 * parameter is found from its Z. */
export function smoothQuads(shape: { points: Vec3[]; faces: number[][]; smooth: Vec3[][] }): LoftQuad[] {
  const curves = smoothLoftCurves(shape.smooth), count = shape.smooth[0].length;
  const ringPoints = Math.max(...shape.faces.at(-1)!) + 1, rings: Vec3[][] = [];
  for (let r = 0; r < ringPoints; r += count) rings.push(shape.points.slice(r, r + count));
  const clockwise = shape.smooth[0].reduce((sum, p, i) => { const q = shape.smooth[0][(i + 1) % count]; return sum + p[0] * q[1] - q[0] * p[1]; }, 0) < 0;
  const z = (v: number) => smoothLoftRing(curves, v)[0][2], z0 = z(0), z1 = z(1);
  const paramAt = (target: number) => { let lo = 0, hi = 1; for (let i = 0; i < 64; i++) { const mid = (lo + hi) / 2; if ((z(mid) - target) * (z1 - z0) < 0) lo = mid; else hi = mid; } return (lo + hi) / 2; };
  // Ring r of the normalized mesh, vertex j, at parameter v: authored vertex (clockwise ? count-1-j : j).
  const vertex = (j: number) => clockwise ? count - 1 - j : j;
  const params = rings.map(r => paramAt(r[0][2]));
  const out: LoftQuad[] = [];
  for (let r = 0; r + 1 < rings.length; r++) for (let j = 0; j < count; j++) {
    const j1 = (j + 1) % count, v0 = params[r], v1 = params[r + 1];
    const surface = (u: number, v: number) => { const ring = smoothLoftRing(curves, v0 + (v1 - v0) * v), p = ring[vertex(j)], q = ring[vertex(j1)]; return [0, 1, 2].map(e => (1 - u) * p[e] + u * q[e]); };
    out.push({ corners: [rings[r][j], rings[r][j1], rings[r + 1][j1], rings[r + 1][j]], surface });
  }
  return out;
}

// ---- 3x4 affine maps (row-major [r00 r01 r02 t0; ...]) and boxes, for where a Boolean can cut ----
type M34 = number[];
type Box = { min: number[]; max: number[] };
const IDENTITY: M34 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
const mul = (a: M34, b: M34): M34 => { const o: number[] = []; for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) o.push(a[r * 4] * b[c] + a[r * 4 + 1] * b[4 + c] + a[r * 4 + 2] * b[8 + c] + (c === 3 ? a[r * 4 + 3] : 0)); return o; };
const apply = (m: M34, p: P3) => [0, 1, 2].map(r => m[r * 4] * p[0] + m[r * 4 + 1] * p[1] + m[r * 4 + 2] * p[2] + m[r * 4 + 3]);
function axisMatrix(axis: P3, degrees: number): M34 {
  const l = len3(axis) || 1, [x, y, z] = axis.map(v => v / l), a = degrees * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), t = 1 - c;
  return [t * x * x + c, t * x * y - s * z, t * x * z + s * y, 0, t * x * y + s * z, t * y * y + c, t * y * z - s * x, 0, t * x * z - s * y, t * y * z + s * x, t * z * z + c, 0];
}
function localMatrix(s: CodeShape): M34 {
  switch (s.kind) {
    case 'move': return [1, 0, 0, s.vector[0], 0, 1, 0, s.vector[1], 0, 0, 1, s.vector[2]];
    case 'scale': return [s.vector[0], 0, 0, 0, 0, s.vector[1], 0, 0, 0, 0, s.vector[2], 0];
    case 'rotate': return mul(axisMatrix([0, 0, 1], s.vector[2]), mul(axisMatrix([0, 1, 0], s.vector[1]), axisMatrix([1, 0, 0], s.vector[0])));
    case 'axisRotate': return axisMatrix(s.vector, s.angle);
    case 'mirror': { const l = len3(s.vector); if (l < 1e-12) return IDENTITY; const n = s.vector.map(v => v / l); return [1 - 2 * n[0] * n[0], -2 * n[0] * n[1], -2 * n[0] * n[2], 0, -2 * n[1] * n[0], 1 - 2 * n[1] * n[1], -2 * n[1] * n[2], 0, -2 * n[2] * n[0], -2 * n[2] * n[1], 1 - 2 * n[2] * n[2], 0]; }
    case 'affine': return s.matrix.slice(0, 12);
    default: return IDENTITY;
  }
}
const boxOf = (points: readonly P3[], m: M34, pad = 0): Box => {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const p of points) { const q = apply(m, p); for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], q[i] - pad); max[i] = Math.max(max[i], q[i] + pad); } }
  return { min, max };
};
/** Conservative world box of a subtree under `m`. */
function shapeBox(s: CodeShape, m: M34): Box {
  const { limit } = shapeBoundsBySide(s);
  if (![...limit.min, ...limit.max].every(Number.isFinite)) return { min: [-Infinity, -Infinity, -Infinity], max: [Infinity, Infinity, Infinity] };
  const corners: number[][] = [];
  for (const x of [limit.min[0], limit.max[0]]) for (const y of [limit.min[1], limit.max[1]]) for (const z of [limit.min[2], limit.max[2]]) corners.push([x, y, z]);
  return boxOf(corners, m);
}
const overlaps = (a: Box, b: Box) => [0, 1, 2].every(i => a.min[i] < b.max[i] && b.min[i] < a.max[i]);
const shifted = (b: Box, d: P3): Box => ({ min: b.min.map((v, i) => v + d[i]), max: b.max.map((v, i) => v + d[i]) });

interface LoftFlags { approximate: boolean; bboxPad: number; loftArea: number; loftVolume: number; exposedArea: number; exposedVolume: number; loftQuads: number; exposedQuads: number }

/** Allowance for the loft quads of one polyhedron. A quad that no other operand of an enclosing
 * Boolean can reach (its world box overlaps none of theirs) ends up whole in the result, so
 * only the signed sums matter: mesh − surface area, and enclosed volume (zero for a ruled fan,
 * whose volume is the ruled volume; the sampling error for a smooth loft). A quad that some
 * operand can reach may be cut: the cut can expose any part of the gap between mesh and surface
 * (its unsigned volume), the kept part of the quad can differ in area by up to its whole
 * |mesh − surface| area, and each cut face crossing the gap differs by at most thickness ×
 * extent, at most two such faces per quad. */
function loftAllowance(quads: LoftQuad[], m: M34, context: Box[], det: number, linear: number, flags: LoftFlags) {
  let area = 0, volume = 0;
  for (const q of quads) {
    const diff = quadDifference(q), box = boxOf(q.corners, m, diff.thickness * linear);
    flags.loftQuads++;
    if (!q.ruled) flags.bboxPad = Math.max(flags.bboxPad, diff.thickness * linear);
    if (context.some(b => overlaps(box, b))) {
      flags.exposedQuads++;
      flags.exposedArea += (Math.abs(diff.area) + 2 * diff.thickness * diff.extent) * linear * linear;
      flags.exposedVolume += diff.gap * det;
    } else { area += diff.area; volume += diff.volume; }
  }
  flags.loftArea += Math.abs(area) * linear * linear; flags.loftVolume += Math.abs(volume) * det;
}

/** Collect the curved constructs of a CodeShape tree with their nominal sizes. `factor` is
 * the volume multiplier of enclosing scales, `linear` the largest linear scale; `world` maps the
 * subtree to the part's coordinates and `context` holds the world boxes of the operands that
 * enclosing Booleans combine it with (anything there may cut it). */
export function collectCurved(shape: CodeShape, out: Curved[] = [], flags: LoftFlags = { approximate: false, bboxPad: 0, loftArea: 0, loftVolume: 0, exposedArea: 0, exposedVolume: 0, loftQuads: 0, exposedQuads: 0 }, factor = 1, linear = 1, world: M34 = IDENTITY, context: Box[] = []): { curved: Curved[] } & LoftFlags {
  const push = (c: Curved) => out.push({ ...c, volume: c.volume * factor, surface: c.surface * linear * linear, radius: c.radius * linear });
  const walk = (s: CodeShape, f = factor, l = linear, w = world, ctx = context) => collectCurved(s, out, flags, f, l, w, ctx);
  switch (shape.kind) {
    case 'cylinder': { const r = shape.radius, h = shape.height; push({ kind: 'prism', segments: shape.segments, volume: Math.PI * r * r * h, surface: 2 * Math.PI * r * (r + h), radius: r }); break; }
    case 'frustum': { const a = shape.bottom, b = shape.top, h = shape.height, r = Math.max(a, b); push({ kind: 'prism', segments: shape.segments, volume: Math.PI * h * (a * a + a * b + b * b) / 3, surface: Math.PI * (a * a + b * b) + Math.PI * (a + b) * Math.hypot(h, a - b), radius: r }); break; }
    case 'sphere': { const r = shape.radius; push({ kind: 'sphere', segments: shape.segments, volume: 4 / 3 * Math.PI * r ** 3, surface: 4 * Math.PI * r * r, radius: r }); break; }
    case 'profile-extrude': {
      const inner: Curved[] = [];
      profileMass(shape.profile, inner, flags, Math.abs(shape.height));
      if (shape.twist !== 0 || shape.scaleTop[0] !== 1 || shape.scaleTop[1] !== 1) flags.approximate = true;
      for (const c of inner) push(c);
      break;
    }
    case 'revolve': {
      const inner: Curved[] = [];
      const m = profileMass(shape.profile, inner, flags, 1), sweep = Math.min(360, Math.abs(shape.angle)) * Math.PI / 180;
      const xbar = Math.abs(m.cx) || (Math.abs(m.min[0]) + Math.abs(m.max[0])) / 2, rmax = Math.max(Math.abs(m.min[0]), Math.abs(m.max[0]));
      const volume = sweep * xbar * m.area, surface = sweep * xbar * m.perimeter + (sweep < 2 * Math.PI ? 2 * m.area : 0);
      push({ kind: 'revolve', segments: shape.segments, volume, surface, radius: rmax });
      // Curved profile items (a torus tube) are faceted a second time, around the axis.
      for (const c of inner) push({ kind: 'revolve', segments: c.segments, volume: sweep * xbar * c.volume, surface: sweep * xbar * 2 * Math.PI * c.radius, radius: c.radius });
      break;
    }
    case 'union': case 'subtract': case 'intersect': {
      const boxes = shape.shapes.map(s => shapeBox(s, world));
      shape.shapes.forEach((s, i) => walk(s, factor, linear, world, [...context, ...boxes.filter((_, j) => j !== i)]));
      break;
    }
    case 'hull': case 'minkowski': { const all = { min: [-Infinity, -Infinity, -Infinity], max: [Infinity, Infinity, Infinity] }; for (const s of shape.shapes) walk(s, factor, linear, world, [...context, all]); break; }
    case 'move': case 'rotate': case 'mirror': case 'axisRotate': walk(shape.shape, factor, linear, mul(world, localMatrix(shape))); break;
    case 'scale': { const [x, y, z] = shape.vector.map(Math.abs); walk(shape.shape, factor * x * y * z, linear * Math.max(x, y, z), mul(world, localMatrix(shape))); break; }
    case 'affine': {
      const m = shape.matrix, det = m[0] * (m[5] * m[10] - m[6] * m[9]) - m[1] * (m[4] * m[10] - m[6] * m[8]) + m[2] * (m[4] * m[9] - m[5] * m[8]);
      const l = Math.max(...[0, 1, 2].map(c => Math.hypot(m[c], m[4 + c], m[8 + c])));
      walk(shape.shape, factor * Math.abs(det), linear * l, mul(world, localMatrix(shape)));
      break;
    }
    case 'resize': flags.approximate = true; walk(shape.shape, factor, linear, world, [...context, { min: [-Infinity, -Infinity, -Infinity], max: [Infinity, Infinity, Infinity] }]); break;
    case 'repeat': {
      // Copy i sits at i · step: each copy may overlap the others, and the enclosing context is
      // seen from copy 0 shifted by −i · step. The allowance of copy 0 counts `count` times.
      const n = Math.max(0, shape.count); if (!n) break;
      const step = [0, 1, 2].map(r => world[r * 4] * shape.step[0] + world[r * 4 + 1] * shape.step[1] + world[r * 4 + 2] * shape.step[2]);
      const self = shapeBox(shape.shape, world), ctx: Box[] = [];
      for (let i = 1; i < n; i++) { ctx.push(shifted(self, step.map(v => v * i)), shifted(self, step.map(v => -v * i))); }
      for (let i = 0; i < n; i++) for (const b of context) ctx.push(shifted(b, step.map(v => -v * i)));
      const before = out.length, saved = { ...flags };
      walk(shape.shape, factor, linear, world, ctx);
      const added = out.splice(before); for (let i = 0; i < n; i++) out.push(...added);
      for (const key of ['loftArea', 'loftVolume', 'exposedArea', 'exposedVolume', 'loftQuads', 'exposedQuads'] as const) flags[key] = saved[key] + (flags[key] - saved[key]) * n;
      break;
    }
    case 'polyhedron': {
      const quads = shape.smooth ? smoothQuads(shape as typeof shape & { smooth: Vec3[][] }) : shape.ruled ? ruledQuads(shape.ruled) : [];
      if (quads.length) loftAllowance(quads, world, context, factor, linear, flags);
      break;
    }
    case 'box': case 'extrude': case 'empty': break;
  }
  return { curved: out, ...flags };
}

/** Derived tolerance for one part. `volume`, `area`, `diag` come from the exact build. */
export function tolerance(shape: CodeShape, cal: Calibration, ref: { volume: number; area: number; diag: number }): Tolerance {
  const flags = collectCurved(shape), { curved, approximate } = flags;
  let v = 0, a = 0, b = 0;
  for (const c of curved) {
    const d = delta(c.segments);
    v += cal.volume[c.kind] * d * Math.abs(c.volume);
    a += cal.area[c.kind] * d * Math.abs(c.surface);
    b = Math.max(b, cal.bbox[c.kind] * c.radius * chord(c.segments));
  }
  const loftArea = flags.loftArea + flags.exposedArea, loftVolume = flags.loftVolume + flags.exposedVolume;
  return {
    volume: 2 * v + 2 * loftVolume + 1e-6 * Math.abs(ref.volume) + 1e-9,
    area: 2 * a + 2 * loftArea + 1e-5 * Math.abs(ref.area) + 1e-9,
    bbox: 2 * b + flags.bboxPad + 1e-6 * ref.diag + 1e-6,
    minSegments: curved.length ? Math.min(...curved.map(c => c.segments)) : null,
    curved: curved.length,
    approximate,
    ...(flags.loftQuads ? { loftQuads: flags.loftQuads, exposedQuads: flags.exposedQuads, loftArea, loftVolume } : {}),
  };
}
