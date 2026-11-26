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
import type { CodeShape, CodeProfile } from '@brickwright/cad-core';

export type CurvedKind = 'prism' | 'sphere' | 'revolve';
export interface Curved { kind: CurvedKind; segments: number; volume: number; surface: number; radius: number }
export interface Calibration { volume: Record<CurvedKind, number>; area: Record<CurvedKind, number>; bbox: Record<CurvedKind, number> }
export interface Tolerance { volume: number; area: number; bbox: number; minSegments: number | null; curved: number; approximate: boolean; /** Σ |facet area − ruled area| of twisted loft quads (CAD Script revision 2), mm². */ ruledArea?: number; /** Unsigned volume between those fans and ruled surfaces, mm³. */ ruledVolume?: number }

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
const len3 = (u: P3) => Math.hypot(u[0], u[1], u[2]);
/** For each twisted side quad of a revision-2 loft, Manifold meshes the four-triangle fan around
 * the corners' mean and the exact kernel builds the ruled (bilinear) surface P(u, v). Their
 * volumes are identical but the surfaces are not: `area` sums |fan area − ruled area|, `volume`
 * the unsigned volume between them (∫ |(P − L) · n| over each fan triangle, L the fan's linear
 * interpolation), which bounds what a Boolean cutting through the quad can change. */
export function ruledFacets(sections: readonly (readonly P3[])[]): { area: number; volume: number } {
  let area = 0, volume = 0;
  const K = 6;
  for (let s = 0; s + 1 < sections.length; s++) for (let j = 0; j < sections[s].length; j++) {
    const n = sections[s].length, a = sections[s][j], b = sections[s][(j + 1) % n], c = sections[s + 1][(j + 1) % n], d = sections[s + 1][j];
    const P = (u: number, v: number) => [0, 1, 2].map(e => (1 - u) * (1 - v) * a[e] + u * (1 - v) * b[e] + u * v * c[e] + (1 - u) * v * d[e]);
    const m = P(0.5, 0.5);
    const fan = [[a, b], [b, c], [c, d], [d, a]].reduce((sum, [p, q]) => sum + len3(cross3(sub3(p, m), sub3(q, m))) / 2, 0);
    let ruled = 0;
    for (let i = 0; i < 8; i++) for (let k = 0; k < 8; k++) {
      const u = GL_X[i], v = GL_X[k];
      const pu = [0, 1, 2].map(e => (1 - v) * (b[e] - a[e]) + v * (c[e] - d[e])), pv = [0, 1, 2].map(e => (1 - u) * (d[e] - a[e]) + u * (c[e] - b[e]));
      ruled += GL_W[i] * GL_W[k] * len3(cross3(pu, pv));
    }
    if (!(Math.abs(fan - ruled) > 1e-12 * fan)) continue;
    area += Math.abs(fan - ruled);
    // Fan triangles in parameter space: two quad corners and the centre (0.5, 0.5).
    for (const [p0, p1] of [[[0, 0], [1, 0]], [[1, 0], [1, 1]], [[1, 1], [0, 1]], [[0, 1], [0, 0]]] as [number, number][][]) {
      const q0 = P(p0[0], p0[1]), q1 = P(p1[0], p1[1]), normal = cross3(sub3(q0, m), sub3(q1, m)), twice = len3(normal);
      if (!twice) continue;
      const unit = normal.map(x => x / twice);
      // K² sub-triangles, midpoint rule; each has 1/K² of the fan triangle's area.
      for (let i = 0; i < K; i++) for (let k = 0; k < K - i; k++) for (const up of [false, true]) {
        if (up && k === K - i - 1) continue;
        const bary = up ? [(i + 2 / 3) / K, (k + 2 / 3) / K] : [(i + 1 / 3) / K, (k + 1 / 3) / K];
        const w0 = bary[0], w1 = bary[1], wm = 1 - w0 - w1;
        const u = w0 * p0[0] + w1 * p1[0] + wm * 0.5, v = w0 * p0[1] + w1 * p1[1] + wm * 0.5;
        const L = [0, 1, 2].map(e => w0 * q0[e] + w1 * q1[e] + wm * m[e]), dev = sub3(P(u, v), L);
        volume += Math.abs(dev[0] * unit[0] + dev[1] * unit[1] + dev[2] * unit[2]) * (twice / 2) / (K * K);
      }
    }
  }
  return { area, volume };
}

/** Collect the curved constructs of a CodeShape tree with their nominal sizes. `factor` is
 * the volume multiplier of enclosing scales, `linear` the largest linear scale. */
export function collectCurved(shape: CodeShape, out: Curved[] = [], flags = { approximate: false, ruledArea: 0, ruledVolume: 0 }, factor = 1, linear = 1): { curved: Curved[]; approximate: boolean; ruledArea: number; ruledVolume: number } {
  const push = (c: Curved) => out.push({ ...c, volume: c.volume * factor, surface: c.surface * linear * linear, radius: c.radius * linear });
  const walk = (s: CodeShape, f = factor, l = linear) => collectCurved(s, out, flags, f, l);
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
    case 'union': case 'subtract': case 'intersect': case 'hull': case 'minkowski': for (const s of shape.shapes) walk(s); break;
    case 'move': case 'rotate': case 'mirror': case 'axisRotate': walk(shape.shape); break;
    case 'scale': { const [x, y, z] = shape.vector.map(Math.abs); walk(shape.shape, factor * x * y * z, linear * Math.max(x, y, z)); break; }
    case 'affine': {
      const m = shape.matrix, det = m[0] * (m[5] * m[10] - m[6] * m[9]) - m[1] * (m[4] * m[10] - m[6] * m[8]) + m[2] * (m[4] * m[9] - m[5] * m[8]);
      const l = Math.max(...[0, 1, 2].map(c => Math.hypot(m[c], m[4 + c], m[8 + c])));
      walk(shape.shape, factor * Math.abs(det), linear * l);
      break;
    }
    case 'resize': flags.approximate = true; walk(shape.shape); break;
    case 'repeat': { const before = out.length, ruledBefore = flags.ruledArea, ruledVolumeBefore = flags.ruledVolume; walk(shape.shape); const added = out.splice(before); for (let i = 0; i < Math.max(0, shape.count); i++) out.push(...added); flags.ruledArea = ruledBefore + (flags.ruledArea - ruledBefore) * Math.max(0, shape.count); flags.ruledVolume = ruledVolumeBefore + (flags.ruledVolume - ruledVolumeBefore) * Math.max(0, shape.count); break; }
    case 'polyhedron': if (shape.ruled) { const r = ruledFacets(shape.ruled); flags.ruledArea += r.area * linear * linear; flags.ruledVolume += r.volume * factor; } break;
    case 'box': case 'extrude': case 'empty': break;
  }
  return { curved: out, approximate: flags.approximate, ruledArea: flags.ruledArea, ruledVolume: flags.ruledVolume };
}

/** Derived tolerance for one part. `volume`, `area`, `diag` come from the exact build. */
export function tolerance(shape: CodeShape, cal: Calibration, ref: { volume: number; area: number; diag: number }): Tolerance {
  const { curved, approximate, ruledArea, ruledVolume } = collectCurved(shape);
  let v = 0, a = 0, b = 0;
  for (const c of curved) {
    const d = delta(c.segments);
    v += cal.volume[c.kind] * d * Math.abs(c.volume);
    a += cal.area[c.kind] * d * Math.abs(c.surface);
    b = Math.max(b, cal.bbox[c.kind] * c.radius * chord(c.segments));
  }
  return {
    volume: 2 * v + 2 * ruledVolume + 1e-6 * Math.abs(ref.volume) + 1e-9,
    area: 2 * a + 2 * ruledArea + 1e-5 * Math.abs(ref.area) + 1e-9,
    bbox: 2 * b + 1e-6 * ref.diag + 1e-6,
    minSegments: curved.length ? Math.min(...curved.map(c => c.segments)) : null,
    curved: curved.length,
    approximate,
    ...(ruledArea ? { ruledArea, ruledVolume } : {}),
  };
}
