// SPDX-License-Identifier: BSD-3-Clause
// Lowers compiled CAD Script (`compileCode(...).shape`, a CodeShape tree from
// @brickwright/cad-core) to an ExactKernel. Semantics follow the Manifold evaluator in
// packages/geometry/src/kernel.ts, with one deliberate difference: `segments` arguments are
// faceting hints, and circles, cylinders, cones, spheres and revolutions are built exactly.
//
// Anything without an exact construction is an ExactKernelError('unsupported'); nothing falls
// back to Manifold or to a mesh.
import { compileCode, CadCodeError, type CodeProgram, type CodeShape, type CodeProfile } from '@brickwright/cad-core';
import { convexHull, ExactKernelError, isConvexPolyhedron, type ExactKernel, type ExactProfile, type ExactSolid, type Vec2, type Vec3 } from '@crispcad/exact-kernel';

/** Below this many segments a circle is ambiguous (e.g. `cylinder(r, h, 6)` as a hexagonal
 * prism), so it is refused instead of being silently rounded. */
export const MIN_EXACT_SEGMENTS = 16;
/** Polyhedra are stitched face by face; above this many faces the stitch gets slow. The exact
 * kernel's own tests stitch 2,044 faces (about 3 s); the largest catalog polyhedra (12-gon lathes,
 * shedded insulators, fuselage lofts: up to 578 faces) build in about 1 s. Tessellated
 * constructors (ellipsoid, elliptic frustum, rounded cylinder) are polyhedra here too: exact
 * as polyhedra, not as the smooth surfaces they approximate. */
export const MAX_POLYHEDRON_FACES = 2048;

const unsupported = (message: string): never => { throw new ExactKernelError('unsupported', message); };
const invalid = (message: string): never => { throw new ExactKernelError('invalid-input', message); };

function circular(what: string, segments: number): void {
  if (segments < MIN_EXACT_SEGMENTS) unsupported(`${what} with ${segments} segments is ambiguous for an exact kernel (a polygon or a circle?); use ${MIN_EXACT_SEGMENTS}+ segments for a true circle, or polygon2d/polyhedron for a polygonal shape.`);
}

// ---- 3x4 affine matrices, row-major [r00 r01 r02 t0; r10 r11 r12 t1; r20 r21 r22 t2] ----
type M34 = number[];
const IDENTITY: M34 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
const mul = (a: M34, b: M34): M34 => {
  const out: number[] = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) out.push(a[r * 4] * b[c] + a[r * 4 + 1] * b[4 + c] + a[r * 4 + 2] * b[8 + c] + (c === 3 ? a[r * 4 + 3] : 0));
  return out;
};
const apply = (m: M34, p: Vec3): Vec3 => [0, 1, 2].map(r => m[r * 4] * p[0] + m[r * 4 + 1] * p[1] + m[r * 4 + 2] * p[2] + m[r * 4 + 3]) as unknown as Vec3;
const translation = (v: Vec3): M34 => [1, 0, 0, v[0], 0, 1, 0, v[1], 0, 0, 1, v[2]];
const scaling = (v: Vec3): M34 => [v[0], 0, 0, 0, 0, v[1], 0, 0, 0, 0, v[2], 0];
function axisRotation(axis: Vec3, degrees: number): M34 {
  const len = Math.hypot(...axis);
  if (!(len > 0)) invalid('Rotation axis must be non-zero.');
  const [x, y, z] = axis.map(v => v / len), a = degrees * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), t = 1 - c;
  return [t * x * x + c, t * x * y - s * z, t * x * z + s * y, 0, t * x * y + s * z, t * y * y + c, t * y * z - s * x, 0, t * x * z - s * y, t * y * z + s * x, t * z * z + c, 0];
}
/** Manifold/CAD Script Euler rotation: about X, then Y, then Z (world axes). */
const eulerRotation = (v: Vec3): M34 => mul(axisRotation([0, 0, 1], v[2]), mul(axisRotation([0, 1, 0], v[1]), axisRotation([1, 0, 0], v[0])));
function reflection(normal: Vec3): M34 {
  const len = Math.hypot(...normal);
  if (!(len > 0)) invalid('Mirror normal must be non-zero.');
  const [x, y, z] = normal.map(v => v / len);
  return [1 - 2 * x * x, -2 * x * y, -2 * x * z, 0, -2 * x * y, 1 - 2 * y * y, -2 * y * z, 0, -2 * x * z, -2 * y * z, 1 - 2 * z * z, 0];
}
/** Axis-angle of a proper rotation matrix (3x3 part of `m`). */
function axisAngle(m: M34): { axis: Vec3; degrees: number } | null {
  const [r00, r01, r02, , r10, r11, r12, , r20, r21, r22] = m;
  const cos = Math.max(-1, Math.min(1, (r00 + r11 + r22 - 1) / 2)), angle = Math.acos(cos);
  if (angle < 1e-15) return null;
  let axis: Vec3 = [r21 - r12, r02 - r20, r10 - r01];
  if (Math.hypot(...axis) < 1e-9) {
    // Half turn: the axis is the column of R + I with the largest norm.
    const cols: Vec3[] = [[r00 + 1, r10, r20], [r01, r11 + 1, r21], [r02, r12, r22 + 1]];
    axis = cols.reduce((best, c) => (Math.hypot(...c) > Math.hypot(...best) ? c : best));
  }
  return { axis, degrees: angle * 180 / Math.PI };
}
/** Split an affine matrix with mutually orthogonal columns into scale, rotation, translation. */
function decomposeAffine(m: M34): { scale: Vec3; rotation: M34; translate: Vec3 } {
  const cols = [0, 1, 2].map(c => [m[c], m[4 + c], m[8 + c]] as Vec3);
  const norms = cols.map(c => Math.hypot(...c));
  if (norms.some(n => !(n > 1e-12))) invalid('Affine matrix is singular.');
  for (const [i, j] of [[0, 1], [0, 2], [1, 2]]) {
    const d = cols[i][0] * cols[j][0] + cols[i][1] * cols[j][1] + cols[i][2] * cols[j][2];
    if (Math.abs(d) > 1e-9 * norms[i] * norms[j]) unsupported('Affine transforms with shear (non-orthogonal columns) have no exact B-rep lowering here.');
  }
  const det = cols[0][0] * (cols[1][1] * cols[2][2] - cols[1][2] * cols[2][1]) - cols[1][0] * (cols[0][1] * cols[2][2] - cols[0][2] * cols[2][1]) + cols[2][0] * (cols[0][1] * cols[1][2] - cols[0][2] * cols[1][1]);
  const scale: Vec3 = [norms[0], norms[1], det < 0 ? -norms[2] : norms[2]];
  const rotation: M34 = [0, 1, 2].flatMap(r => [m[r * 4] / scale[0], m[r * 4 + 1] / scale[1], m[r * 4 + 2] / scale[2], 0]);
  return { scale, rotation, translate: [m[3], m[7], m[11]] };
}
/** OpenSCAD-style resize factors (as in packages/geometry): 0 keeps an axis unless auto. */
function resizeFactors(target: readonly number[], auto: readonly boolean[] | undefined, min: readonly number[], max: readonly number[]): number[] {
  const specified = target.map((value, i) => {
    if (!value) return 0;
    const extent = max[i] - min[i];
    if (extent < 1e-12) invalid('Cannot resize a degenerate shape.');
    return value / extent;
  });
  const uniform = Math.max(...specified) || 1;
  return specified.map((s, i) => (target[i] ? s : auto?.[i] ? uniform : 1));
}

// ---- profiles ----
function lowerProfile(k: ExactKernel, p: CodeProfile): ExactProfile | null {
  switch (p.kind) {
    case 'empty': return null;
    case 'polygon': return k.profile.polygon(p.contours as Vec2[][]);
    case 'circle': circular('circle2d', p.segments); return k.profile.circle(p.radius);
    case 'rectangle': return k.profile.rectangle(p.size[0], p.size[1], p.center);
    case 'move': { const c = lowerProfile(k, p.profile); return c && k.profile.translate(c, p.vector); }
    case 'rotate': { const c = lowerProfile(k, p.profile); return c && k.profile.rotate(c, p.angle); }
    case 'scale': { const c = lowerProfile(k, p.profile); return c && k.profile.scale(c, p.vector); }
    case 'affine': {
      const c = lowerProfile(k, p.profile);
      if (!c) return null;
      const [m0, m1, m2, m3, m4, m5] = p.matrix, n0 = Math.hypot(m0, m3), n1 = Math.hypot(m1, m4);
      if (!(n0 > 1e-12 && n1 > 1e-12)) invalid('2D affine matrix is singular.');
      if (Math.abs(m0 * m1 + m3 * m4) > 1e-9 * n0 * n1) unsupported('2D affine transforms with shear have no exact lowering here.');
      const det = m0 * m4 - m1 * m3;
      return k.profile.translate(k.profile.rotate(k.profile.scale(c, [n0, det < 0 ? -n1 : n1]), Math.atan2(m3, m0) * 180 / Math.PI), [m2, m5]);
    }
    case 'resize': {
      const c = lowerProfile(k, p.profile);
      if (!c) return null;
      const b = k.profile.bounds(c), f = resizeFactors(p.size, p.auto, b.min, b.max);
      return k.profile.scale(c, [f[0], f[1]]);
    }
    case 'offset': {
      if (p.round) circular('offset2d', p.segments);
      const c = lowerProfile(k, p.profile);
      return c && k.profile.offset(c, p.distance, p.round);
    }
    case 'text': return unsupported('text2d needs a font outline path, and the exact kernel package ships no font.');
    case 'minkowski': return unsupported('minkowski2d has no exact lowering (planar Minkowski sums of curved profiles are not exposed by this kernel adapter).');
    case 'union': case 'subtract': case 'intersect': case 'hull': {
      const children = p.profiles.map(c => lowerProfile(k, c));
      const present = children.filter((c): c is ExactProfile => c !== null);
      if (p.kind === 'union') return present.length ? k.profile.union(present[0], ...present.slice(1)) : null;
      if (p.kind === 'hull') return present.length ? k.profile.hull(...present) : null;
      if (p.kind === 'intersect') return children.some(c => c === null) || !present.length ? null : k.profile.intersect(present[0], ...present.slice(1));
      if (!children[0]) return null;
      const cutters = children.slice(1).filter((c): c is ExactProfile => c !== null);
      return cutters.length ? k.profile.subtract(children[0], ...cutters) : children[0];
    }
    default: return unsupported(`Profile '${(p as { kind: string }).kind}' has no exact lowering.`);
  }
}

// ---- hull ----
interface HullLeaves { points: Vec3[]; spheres: { centre: Vec3; radius: number }[] }
/** Vertices of a polygonal profile (no arcs), for hulls of extrusions. */
function profilePoints(p: CodeProfile): [number, number][] {
  switch (p.kind) {
    case 'polygon': return p.contours.flat() as [number, number][];
    case 'rectangle': { const [w, h] = p.size, x0 = p.center ? -w / 2 : 0, y0 = p.center ? -h / 2 : 0; return [[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]]; }
    case 'move': return profilePoints(p.profile).map(([x, y]) => [x + p.vector[0], y + p.vector[1]]);
    case 'scale': return profilePoints(p.profile).map(([x, y]) => [x * p.vector[0], y * p.vector[1]]);
    case 'rotate': { const a = p.angle * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return profilePoints(p.profile).map(([x, y]) => [c * x - s * y, s * x + c * y]); }
    case 'affine': { const m = p.matrix; return profilePoints(p.profile).map(([x, y]) => [m[0] * x + m[1] * y + m[2], m[3] * x + m[4] * y + m[5]]); }
    case 'union': case 'hull': return p.profiles.flatMap(profilePoints);
    case 'empty': return [];
    default: return unsupported(`hull of an extruded '${p.kind}' profile has no exact lowering (only straight-edged profiles).`);
  }
}
function collectHull(shape: CodeShape, m: M34, out: HullLeaves): void {
  const linear = (next: M34, child: CodeShape) => collectHull(child, mul(m, next), out);
  switch (shape.kind) {
    case 'empty': return;
    case 'union': case 'hull': for (const s of shape.shapes) collectHull(s, m, out); return;
    case 'move': return linear(translation(shape.vector), shape.shape);
    case 'rotate': return linear(eulerRotation(shape.vector), shape.shape);
    case 'scale': return linear(scaling(shape.vector), shape.shape);
    case 'mirror': return linear(reflection(shape.vector), shape.shape);
    case 'axisRotate': return linear(axisRotation(shape.vector, shape.angle), shape.shape);
    case 'affine': return linear(shape.matrix.slice(0, 12), shape.shape);
    case 'repeat': for (let i = 0; i < shape.count; i++) linear(translation(shape.step.map(v => v * i) as unknown as Vec3), shape.shape); return;
    case 'box': {
      const [x, y, z] = shape.size.map(v => v / 2);
      for (const sx of [-x, x]) for (const sy of [-y, y]) for (const sz of [-z, z]) out.points.push(apply(m, [sx, sy, sz]));
      return;
    }
    case 'polyhedron': for (const p of shape.points) out.points.push(apply(m, p)); return;
    case 'extrude': for (const [x, y] of shape.points) for (const z of [0, shape.height]) out.points.push(apply(m, [x, y, z])); return;
    case 'profile-extrude': {
      if (shape.twist !== 0) unsupported('hull of a twisted extrusion has no exact lowering.');
      for (const [x, y] of profilePoints(shape.profile)) {
        out.points.push(apply(m, [x, y, 0]));
        out.points.push(apply(m, [x * shape.scaleTop[0], y * shape.scaleTop[1], shape.height]));
      }
      return;
    }
    case 'sphere': {
      circular('sphere', shape.segments);
      const cols = [0, 1, 2].map(c => Math.hypot(m[c], m[4 + c], m[8 + c]));
      if (Math.max(...cols) - Math.min(...cols) > 1e-12 * Math.max(...cols)) unsupported('hull of a non-uniformly scaled sphere (an ellipsoid) has no exact lowering.');
      out.spheres.push({ centre: apply(m, [0, 0, 0]), radius: shape.radius * cols[0] });
      return;
    }
    default: unsupported(`hull of '${shape.kind}' has no exact lowering (supported: polyhedral solids, or equal spheres at the corners of a box).`);
  }
}
function lowerHull(k: ExactKernel, shapes: readonly CodeShape[]): ExactSolid | null {
  const leaves: HullLeaves = { points: [], spheres: [] };
  for (const s of shapes) collectHull(s, IDENTITY, leaves);
  if (leaves.points.length && leaves.spheres.length) unsupported('hull mixing spheres and polyhedral solids has no exact lowering.');
  if (leaves.points.length) { const hull = convexHull(leaves.points); return k.polyhedron(hull.points, hull.faces); }
  if (!leaves.spheres.length) return null;
  const r = leaves.spheres[0].radius;
  if (leaves.spheres.some(s => Math.abs(s.radius - r) > 1e-12 * r)) unsupported('hull of spheres with different radii has no exact lowering.');
  const centres = leaves.spheres.map(s => s.centre);
  const min = [0, 1, 2].map(i => Math.min(...centres.map(c => c[i]))), max = [0, 1, 2].map(i => Math.max(...centres.map(c => c[i])));
  const size = max.map((v, i) => v - min[i]), eps = 1e-9 * Math.max(1, ...size);
  if (size.every(s => s <= eps)) return k.translate(k.sphere(r), min as unknown as Vec3);
  // hull(equal spheres) = Minkowski(hull(centres), ball). With the centres spanning an
  // axis-aligned box that is the box grown by r with every edge filleted at r: exact.
  const corner = (i: number) => [i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]];
  const boxCorners = [0, 1, 2, 3, 4, 5, 6, 7].every(i => centres.some(c => c.every((v, j) => Math.abs(v - corner(i)[j]) <= eps)));
  if (!boxCorners || size.some(s => s <= eps)) unsupported('hull of spheres is lowered exactly only when the centres span an axis-aligned box (an all-edge fillet).');
  const grown = k.box(size.map(s => s + 2 * r) as unknown as Vec3);
  return k.translate(k.fillet(grown, r, 'all'), min.map((v, i) => v + size[i] / 2) as unknown as Vec3);
}

/** Revolve an XY profile (X radial, Y height) about world Z with the Manifold evaluator's
 * conventions: a wholly non-positive profile is reflected, and negative sweeps turn clockwise. */
export function revolveProfile(k: ExactKernel, profile: ExactProfile, degrees: number): ExactSolid {
  const b = k.profile.bounds(profile), negative = b.max[0] <= 0;
  if (b.min[0] < -1e-8 && !negative) invalid('Revolved profiles must stay on one side of the radial axis.');
  const angle = Math.abs(degrees);
  if (angle > 360) invalid('Revolution angle exceeds 360 degrees.');
  let solid = k.revolve(negative ? k.profile.scale(profile, [-1, 1]) : profile, degrees);
  if (negative && angle !== 360) solid = k.rotate(solid, [0, 0, 1], 180);
  return solid;
}

// ---- solids ----
function rigid(k: ExactKernel, s: ExactSolid, m: M34): ExactSolid {
  const { scale, rotation, translate } = decomposeAffine(m);
  let out = scale.every(v => Math.abs(v - 1) < 1e-15) ? s : k.scale(s, scale);
  const rot = axisAngle(rotation);
  if (rot) out = k.rotate(out, rot.axis, rot.degrees);
  return translate.some(v => v !== 0) ? k.translate(out, translate) : out;
}

export function lowerCodeShape(k: ExactKernel, shape: CodeShape): ExactSolid | null {
  const child = (s: CodeShape) => lowerCodeShape(k, s);
  switch (shape.kind) {
    case 'empty': return null;
    case 'box': return k.box(shape.size);
    case 'cylinder': circular('cylinder', shape.segments); return k.cylinder(shape.radius, shape.height);
    case 'frustum': circular('frustum', shape.segments); return k.cone(shape.bottom, shape.top, shape.height);
    case 'sphere': circular('sphere', shape.segments); return k.sphere(shape.radius);
    case 'extrude': return k.extrude(k.profile.polygon([shape.points]), shape.height);
    case 'profile-extrude': {
      if (shape.twist !== 0) unsupported('Twisted extrusions (extrudeProfile twist) have no exact lowering yet (would need a helical sweep).');
      if (shape.scaleTop[0] !== 1 || shape.scaleTop[1] !== 1) unsupported('Tapered extrusions (extrudeProfile top scale) have no exact lowering yet (would need a ruled loft).');
      const profile = lowerProfile(k, shape.profile);
      return profile && k.extrude(profile, shape.height);
    }
    case 'revolve': {
      circular('revolve', shape.segments);
      if (shape.angle === 0) return null;
      const profile = lowerProfile(k, shape.profile);
      return profile && revolveProfile(k, profile, shape.angle);
    }
    case 'polyhedron': {
      if (shape.faces.length > MAX_POLYHEDRON_FACES) unsupported(`A polyhedron of ${shape.faces.length} faces exceeds the exact faceted-solid budget (${MAX_POLYHEDRON_FACES} faces).`);
      if (isConvexPolyhedron(shape.points, shape.faces)) { const hull = convexHull(shape.points); return k.polyhedron(hull.points, hull.faces); }
      return k.polyhedron(shape.points, shape.faces);
    }
    case 'union': case 'subtract': case 'intersect': {
      // a - (b ∪ c) = a - b - c: one n-ary cut is faster in SMLib than fusing the cutters first.
      const flatten = (s: CodeShape): CodeShape[] => (s.kind === 'union' ? s.shapes.flatMap(flatten) : [s]);
      const operands = shape.kind === 'subtract' ? [shape.shapes[0], ...shape.shapes.slice(1).flatMap(flatten)] : shape.shapes;
      const parts = operands.map(child);
      const present = parts.filter((p): p is ExactSolid => p !== null);
      if (shape.kind === 'union') return present.length ? k.union(present[0], ...present.slice(1)) : null;
      if (shape.kind === 'intersect') return parts.some(p => p === null) || !present.length ? null : k.intersect(present[0], ...present.slice(1));
      if (!parts[0]) return null;
      const cutters = parts.slice(1).filter((p): p is ExactSolid => p !== null);
      return cutters.length ? k.subtract(parts[0], ...cutters) : parts[0];
    }
    case 'hull': return lowerHull(k, shape.shapes);
    case 'minkowski': return unsupported('minkowski has no exact lowering (a general Minkowski sum is not a B-rep operation of this adapter; use fillet/offset intent instead).');
    case 'move': { const s = child(shape.shape); return s && k.translate(s, shape.vector); }
    case 'rotate': {
      const s = child(shape.shape);
      if (!s) return null;
      let out = s;
      for (const [axis, angle] of [[[1, 0, 0], shape.vector[0]], [[0, 1, 0], shape.vector[1]], [[0, 0, 1], shape.vector[2]]] as [Vec3, number][]) if (angle) out = k.rotate(out, axis, angle);
      return out;
    }
    case 'scale': { const s = child(shape.shape); return s && k.scale(s, shape.vector); }
    case 'mirror': { const s = child(shape.shape); return s && k.mirror(s, shape.vector); }
    case 'axisRotate': { const s = child(shape.shape); return s && (shape.angle ? k.rotate(s, shape.vector, shape.angle) : s); }
    case 'affine': { const s = child(shape.shape); return s && rigid(k, s, shape.matrix.slice(0, 12)); }
    case 'resize': {
      const s = child(shape.shape);
      if (!s) return null;
      const b = k.bbox(s);
      return k.scale(s, resizeFactors(shape.vector, shape.auto, b.min, b.max) as unknown as Vec3);
    }
    case 'repeat': {
      const s = shape.count >= 1 ? child(shape.shape) : null;
      if (!s) return null;
      const copies = Array.from({ length: shape.count }, (_, i) => (i === 0 ? s : k.translate(s, shape.step.map(v => v * i) as unknown as Vec3)));
      return copies.length > 1 ? k.union(copies[0], ...copies.slice(1)) : copies[0];
    }
    default: return unsupported(`CAD Script '${(shape as { kind: string }).kind}' has no exact lowering.`);
  }
}

/** Compile CAD Script and lower it to one exact solid (possibly of several components).
 * Intermediate kernel objects are freed; the caller owns (and disposes) the result. */
export function evaluateCadScript(k: ExactKernel, program: CodeProgram): ExactSolid {
  let shape: CodeShape;
  try {
    shape = compileCode(program).shape;
  } catch (error) {
    if (error instanceof CadCodeError) throw new ExactKernelError('invalid-input', `CAD Script: ${error.message}`, { cause: error });
    throw error;
  }
  const result = k.scope(() => lowerCodeShape(k, shape));
  if (!result) throw new ExactKernelError('invalid-input', 'The program produces no solid.');
  if (!(k.volume(result) > 0)) { result.dispose(); throw new ExactKernelError('kernel-failure', 'The exact result has no positive volume.'); }
  return result;
}

export const cadScript = (source: string): CodeProgram => ({ version: 1, language: 'brickwright-cad-script', source, parameters: {} });
