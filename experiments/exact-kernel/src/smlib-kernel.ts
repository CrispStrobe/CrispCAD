// SPDX-License-Identifier: BSD-3-Clause
// ExactKernel on SMLib through @classcad/smlibwasm 0.6.2 (MIT wrapper by AWV Informatik AG;
// SMLib/USD BRep core Apache-2.0 by NVIDIA; Lato font OFL-1.1, unused here).
//
// API usage learned from the MIT-licensed CrispCAD fork of kernelCAD
// (src/kernel/backends/smlib/smlibBackend.ts, src/modeling/backends/smlib/nativeLowerer.ts,
// experiments/kernel-qualification/smlibwasm.mjs; Copyright (c) 2026 CrispCAD contributors,
// Andrii Shylenko and kernelCAD contributors). This file is an original adapter for the
// narrow interface in exact-kernel.ts; no code was copied verbatim.
//
// The package instantiates its WebAssembly at import time (top-level await), so it is
// imported lazily in createSmlibKernel and never at module load.
import {
  ExactKernelError,
  type BoundingBox, type EdgeSelector, type ExactKernel, type ExactProfile, type ExactProfileOps,
  type ExactSolid, type KernelMemory, type TriangleMesh, type Vec3,
} from './exact-kernel.ts';

type Smlib = typeof import('@classcad/smlibwasm');
type Part = InstanceType<Smlib['Part']>;
type Sketch = InstanceType<Smlib['Sketch']>;
type Face = InstanceType<Smlib['Face']>;

// Plain objects (not class instances) so smlibwasm's `scope` sees the kernel object inside a
// returned handle and keeps it.
interface SolidHandle { part: Part; dispose(): void }
interface ProfileHandle { sketch: Sketch; dispose(): void }
const solidOf = (part: Part): ExactSolid => ({ part, dispose: () => part.dispose() }) as SolidHandle as unknown as ExactSolid;
const profileOf = (sketch: Sketch): ExactProfile => ({ sketch, dispose: () => sketch.dispose() }) as ProfileHandle as unknown as ExactProfile;
const partOf = (s: ExactSolid): Part => {
  const part = (s as unknown as Partial<SolidHandle>)?.part;
  if (!part) throw new ExactKernelError('invalid-input', 'Not a solid of this kernel.');
  return part;
};
const sketchOf = (p: ExactProfile): Sketch => {
  const sketch = (p as unknown as Partial<ProfileHandle>)?.sketch;
  if (!sketch) throw new ExactKernelError('invalid-input', 'Not a profile of this kernel.');
  return sketch;
};

/** Default display tessellation: 0.01 mm chord, 10 degrees. */
export const SMLIB_MESH_TOLERANCE = 0.01;
export const SMLIB_MESH_ANGLE = 10;

const finite = (what: string, ...values: number[]) => {
  for (const v of values) if (typeof v !== 'number' || !Number.isFinite(v)) throw new ExactKernelError('invalid-input', `${what} must be finite numbers (got ${String(v)}).`);
};
const positive = (what: string, ...values: number[]) => {
  finite(what, ...values);
  for (const v of values) if (!(v > 0)) throw new ExactKernelError('invalid-input', `${what} must be positive (got ${v}).`);
};
const unitNormal = (what: string, n: Vec3): Vec3 => {
  finite(what, ...n);
  const len = Math.hypot(n[0], n[1], n[2]);
  if (!(len > 1e-12)) throw new ExactKernelError('invalid-input', `${what} must be a non-zero vector.`);
  return [n[0] / len, n[1] / len, n[2] / len];
};

export async function createSmlibKernel(): Promise<ExactKernel> {
  const sm: Smlib = await import('@classcad/smlibwasm');
  sm.setWarningHandler(() => { /* warnings are not failures; results are checked by measure */ });

  /** Run a kernel operation; kernel exceptions become ExactKernelError('kernel-failure'). */
  const call = <T>(operation: string, fn: () => T): T => {
    try {
      return fn();
    } catch (error) {
      if (error instanceof ExactKernelError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new ExactKernelError('kernel-failure', `SMLib ${operation} failed: ${message}`, { cause: error });
    }
  };
  /** A result that is not a closed positive-volume solid is a failure, never a silent pass. */
  const solid = (operation: string, part: unknown): ExactSolid => {
    if (!(part instanceof sm.Part)) throw new ExactKernelError('kernel-failure', `SMLib ${operation} did not produce a solid (got ${(part as object)?.constructor?.name ?? typeof part}).`);
    return solidOf(part);
  };
  const vec = (v: Vec3): [number, number, number] => [v[0], v[1], v[2]];

  const faceWithNormal = (part: Part, normal: Vec3): Face => {
    const n = unitNormal('Face normal', normal);
    const matches = [...part.faces()].filter(f => {
      if (!f.isPlanar) return false;
      const m = f.normalAt();
      return m.x * n[0] + m.y * n[1] + m.z * n[2] > 1 - 1e-9;
    });
    if (matches.length !== 1) throw new ExactKernelError('invalid-input', `Expected exactly one planar face with outward normal [${n.join(', ')}], found ${matches.length}.`);
    return matches[0];
  };
  const edgesOf = (part: Part, selector: EdgeSelector = 'all') =>
    selector === 'all' ? part.edges() : faceWithNormal(part, selector.faceNormal).edges();

  const profile: ExactProfileOps = {
    polygon(contours) {
      if (!Array.isArray(contours) || !contours.length) throw new ExactKernelError('invalid-input', 'A polygon profile needs at least one contour.');
      for (const c of contours) {
        if (!Array.isArray(c) || c.length < 3) throw new ExactKernelError('invalid-input', 'Each polygon contour needs at least three points.');
        for (const p of c) finite('Polygon points', p[0], p[1]);
      }
      return call('Polygon', () => {
        // Even-odd fill: the symmetric difference of the contour regions.
        const regions = contours.map(c => sm.Polygon(c.map(p => [p[0], p[1]] as [number, number])));
        return profileOf(regions.length === 1 ? regions[0] : sm.xor(regions[0], ...regions.slice(1)));
      });
    },
    circle(radius) { positive('Circle radius', radius); return call('Circle', () => profileOf(sm.Circle(radius))); },
    rectangle(width, height, centred) {
      positive('Rectangle size', width, height);
      return call('Rectangle', () => profileOf(centred ? sm.Rectangle(width, height) : sm.Rectangle(width, height, { align: 'min' })));
    },
    union: (first, ...rest) => call('fuse (2D)', () => profileOf(rest.length ? sm.fuse(sketchOf(first), ...rest.map(sketchOf)) : sketchOf(first))),
    subtract: (base, ...cutters) => call('cut (2D)', () => profileOf(cutters.length ? sm.cut(sketchOf(base), ...cutters.map(sketchOf)) : sketchOf(base))),
    intersect: (first, ...rest) => call('intersect (2D)', () => profileOf(rest.length ? sm.intersect(sketchOf(first), ...rest.map(sketchOf)) : sketchOf(first))),
    hull: (...profiles) => {
      if (!profiles.length) throw new ExactKernelError('invalid-input', 'A hull needs at least one profile.');
      return call('Hull (2D)', () => profileOf(sm.Hull(...profiles.map(sketchOf))));
    },
    translate: (p, [x, y]) => { finite('Profile offset', x, y); return call('translate (2D)', () => profileOf(sketchOf(p).translate([x, y, 0]))); },
    rotate: (p, degrees) => { finite('Profile angle', degrees); return call('rotate (2D)', () => profileOf(sketchOf(p).rotate(sm.Axis.Z, degrees))); },
    scale: (p, [x, y]) => {
      finite('Profile scale', x, y);
      if (x === 0 || y === 0) throw new ExactKernelError('invalid-input', 'A zero profile scale flattens the profile.');
      return call('scale (2D)', () => profileOf(sketchOf(p).scale([x, y, 1])));
    },
    offset: (p, distance, round) => {
      finite('Profile offset distance', distance);
      return call('offset (2D)', () => profileOf(sm.offset(sketchOf(p), distance, { corners: round ? 'round' : 'sharp' })));
    },
    bounds: p => {
      const b = sketchOf(p).bbox();
      return { min: [b.min.x, b.min.y], max: [b.max.x, b.max.y] };
    },
  };

  const kernel: ExactKernel = {
    name: '@classcad/smlibwasm',
    version: sm.version,
    licence: 'MIT AND Apache-2.0 AND OFL-1.1',

    box(size) { positive('Box size', ...size); return call('Box', () => solid('Box', sm.Box(size[0], size[1], size[2]))); },
    cylinder(radius, height) { positive('Cylinder radius and height', radius, height); return call('Cylinder', () => solid('Cylinder', sm.Cylinder(radius, height))); },
    cone(bottom, top, height) {
      finite('Cone radii', bottom, top); positive('Cone height', height);
      if (bottom < 0 || top < 0 || !(bottom > 0 || top > 0)) throw new ExactKernelError('invalid-input', 'Cone radii must be non-negative and not both zero.');
      // Centred by its bounding box, like the CAD Script frustum.
      return call('Cone', () => solid('Cone', bottom === top ? sm.Cylinder(bottom, height) : sm.Cone(bottom, top, height)));
    },
    sphere(radius) { positive('Sphere radius', radius); return call('Sphere', () => solid('Sphere', sm.Sphere(radius))); },
    torus(major, minor) {
      positive('Torus radii', major, minor);
      if (minor >= major) throw new ExactKernelError('invalid-input', 'The tube radius must be smaller than the major radius.');
      return call('Torus', () => solid('Torus', sm.Torus(major, minor)));
    },
    polyhedron(points, faces) {
      if (!Array.isArray(points) || points.length < 4 || !Array.isArray(faces) || faces.length < 4) throw new ExactKernelError('invalid-input', 'A polyhedron needs at least four points and four faces.');
      for (const p of points) finite('Polyhedron points', p[0], p[1], p[2]);
      for (const f of faces) if (!Array.isArray(f) || f.length < 3 || f.some(i => !Number.isInteger(i) || i < 0 || i >= points.length)) throw new ExactKernelError('invalid-input', 'Polyhedron faces must index at least three existing points.');
      return call('stitch (polyhedron)', () => sm.scope(() => {
        const faceSketches = faces.map(f => {
          const loop = f.map(i => vec(points[i]));
          return sm.makeFace(sm.Polyline(...loop, loop[0]));
        });
        const body = sm.stitch(...faceSketches);
        if (!(body instanceof sm.Part) || !body.isValid()) throw new ExactKernelError('invalid-input', 'The polyhedron faces do not close around a valid solid.');
        return solidOf(body);
      }));
    },

    profile,
    extrude(p, height) { positive('Extrusion height', height); return call('extrude', () => solid('extrude', sm.extrude(sketchOf(p), height))); },
    revolve(p, degrees) {
      finite('Revolution angle', degrees);
      if (degrees === 0 || Math.abs(degrees) > 360) throw new ExactKernelError('invalid-input', 'Revolution angle must be in (0, 360] degrees in magnitude.');
      return call('revolve', () => sm.scope(() => {
        // Sketch Y becomes world Z: rotate the XY sketch +90 degrees about X.
        const upright = sketchOf(p).rotate(sm.Axis.X, 90);
        const part = sm.revolve(upright, sm.Axis.Z, Math.abs(degrees));
        return solid('revolve', degrees < 0 ? part.mirror(new sm.Plane([0, 0, 0], undefined, [0, 1, 0])) : part);
      }));
    },

    union: (first, ...rest) => call('fuse', () => solid('fuse', rest.length ? sm.fuse(partOf(first), ...rest.map(partOf)) : partOf(first))),
    subtract: (base, ...cutters) => call('cut', () => solid('cut', cutters.length ? sm.cut(partOf(base), ...cutters.map(partOf)) : partOf(base))),
    intersect: (first, ...rest) => call('intersect', () => solid('intersect', rest.length ? sm.intersect(partOf(first), ...rest.map(partOf)) : partOf(first))),

    translate: (s, v) => { finite('Translation', ...v); return call('translate', () => solidOf(partOf(s).translate(vec(v)))); },
    rotate: (s, axis, degrees, pivot = [0, 0, 0]) => {
      const n = unitNormal('Rotation axis', axis); finite('Rotation angle and pivot', degrees, ...pivot);
      return call('rotate', () => solidOf(partOf(s).rotate(new sm.Axis(vec(pivot), vec(n)), degrees)));
    },
    mirror: (s, normal) => {
      const n = unitNormal('Mirror normal', normal);
      return call('mirror', () => solidOf(partOf(s).mirror(new sm.Plane([0, 0, 0], undefined, vec(n)))));
    },
    scale: (s, f) => {
      finite('Scale factors', ...f);
      if (f.some(v => v === 0)) throw new ExactKernelError('invalid-input', 'A zero scale factor flattens the solid.');
      return call('scale', () => solidOf(partOf(s).scale(vec(f), [0, 0, 0])));
    },

    fillet: (s, radius, edges = 'all') => {
      positive('Fillet radius', radius);
      return call('fillet', () => solid('fillet', sm.fillet(edgesOf(partOf(s), edges), radius)));
    },
    chamfer: (s, distance, edges = 'all') => {
      positive('Chamfer distance', distance);
      return call('chamfer', () => solid('chamfer', sm.chamfer(edgesOf(partOf(s), edges), distance)));
    },
    shell: (s, thickness, openFaceNormal) => {
      positive('Shell thickness', thickness);
      return call('shell', () => {
        const part = partOf(s);
        return solid('shell', sm.shell(part, -thickness, openFaceNormal ? faceWithNormal(part, openFaceNormal) : null));
      });
    },

    volume: s => call('volume', () => partOf(s).volume),
    area: s => call('area', () => partOf(s).area),
    bbox: (s): BoundingBox => call('bbox', () => {
      const b = partOf(s).bbox();
      return { min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] };
    }),
    isValid: s => call('isValid', () => partOf(s).isValid()),
    solidCount: s => call('solids', () => sm.scope(() => partOf(s).solids().length)),

    tessellate: (s, options = {}): TriangleMesh => {
      const tolerance = options.tolerance ?? SMLIB_MESH_TOLERANCE, angle = options.angleDeg ?? SMLIB_MESH_ANGLE;
      positive('Tessellation tolerance and angle', tolerance, angle);
      return call('mesh', () => sm.scope(() => {
        const mesh = partOf(s).mesh(tolerance, angle);
        return { positions: Float64Array.from(mesh.vertices), indices: Uint32Array.from(mesh.triangles) };
      }));
    },
    exportStep: s => call('toStep', () => sm.toStep(partOf(s))),
    importStep: text => {
      if (typeof text !== 'string' || !text.length) throw new ExactKernelError('invalid-input', 'STEP input must be non-empty text.');
      return call('fromStep', () => {
        const result: unknown = sm.fromStep(text);
        return solid('fromStep', result);
      });
    },

    memory: (): KernelMemory => { const m = sm.memoryUsage(); return { used: m.used, heap: m.heap, handles: m.handles }; },
    scope: fn => sm.scope(fn),
  };
  return kernel;
}

