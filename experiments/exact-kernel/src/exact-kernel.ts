// SPDX-License-Identifier: BSD-3-Clause
// Narrow exact-B-rep backend interface for the exact-kernel experiment.
//
// Everything a candidate kernel must provide for CAD Script lowering, the reference
// scorecard and STEP exchange; nothing else. Solids and profiles are opaque handles so a
// second candidate (WASMLib, Solidcore) can implement the same interface. Conventions follow
// CAD Script, not the kernel: boxes, cylinders, cones and spheres are centred on the origin,
// extrusions start at z = 0, and revolutions turn sketch X (radius) / sketch Y (height) about
// world Z, counter-clockwise from +X.

export type Vec2 = readonly [number, number];
export type Vec3 = readonly [number, number, number];

declare const solidBrand: unique symbol;
declare const profileBrand: unique symbol;
/** An exact solid owned by one kernel. Free it with `dispose`, or build inside `scope`. */
export interface ExactSolid { readonly [solidBrand]: true; dispose(): void }
/** A closed planar region in the XY plane (outer boundary and holes). */
export interface ExactProfile { readonly [profileBrand]: true; dispose(): void }

/** Edges selected for fillet/chamfer: every edge, or the edges of the planar face whose
 * outward normal is `faceNormal`. */
export type EdgeSelector = 'all' | { faceNormal: Vec3 };

export interface BoundingBox { min: [number, number, number]; max: [number, number, number] }
export interface TriangleMesh { positions: Float64Array; indices: Uint32Array }
export interface KernelMemory { /** Bytes held by live kernel objects. */ used: number; /** WASM linear memory size (only grows). */ heap: number; /** Live kernel object handles. */ handles: number }

export type ExactKernelErrorCode =
  /** The request is well formed but this backend has no exact construction for it. */
  | 'unsupported'
  /** The request itself is invalid (non-finite, non-positive or degenerate dimensions). */
  | 'invalid-input'
  /** The kernel rejected or failed the operation (e.g. a fillet radius it cannot realise). */
  | 'kernel-failure';

export class ExactKernelError extends Error {
  readonly code: ExactKernelErrorCode;
  constructor(code: ExactKernelErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ExactKernelError';
    this.code = code;
  }
}

export interface ExactProfileOps {
  /** Even-odd region of one or more closed polylines (holes and islands by nesting). */
  polygon(contours: readonly (readonly Vec2[])[]): ExactProfile;
  circle(radius: number): ExactProfile;
  rectangle(width: number, height: number, centred: boolean): ExactProfile;
  union(first: ExactProfile, ...rest: ExactProfile[]): ExactProfile;
  subtract(base: ExactProfile, ...cutters: ExactProfile[]): ExactProfile;
  intersect(first: ExactProfile, ...rest: ExactProfile[]): ExactProfile;
  /** Convex hull; arcs stay exact (tangent lines between circles). */
  hull(...profiles: ExactProfile[]): ExactProfile;
  translate(profile: ExactProfile, offset: Vec2): ExactProfile;
  /** Counter-clockwise, degrees, about the origin. */
  rotate(profile: ExactProfile, degrees: number): ExactProfile;
  /** Per-axis factors; negative factors mirror. */
  scale(profile: ExactProfile, factors: Vec2): ExactProfile;
  /** Offset outward (positive) or inward; round or sharp corners. */
  offset(profile: ExactProfile, distance: number, round: boolean): ExactProfile;
  bounds(profile: ExactProfile): { min: [number, number]; max: [number, number] };
}

export interface ExactKernel {
  readonly name: string;
  readonly version: string;
  readonly licence: string;

  // Primitives (centred on the origin, axes along Z).
  box(size: Vec3): ExactSolid;
  cylinder(radius: number, height: number): ExactSolid;
  /** Frustum; one radius may be zero. */
  cone(bottomRadius: number, topRadius: number, height: number): ExactSolid;
  sphere(radius: number): ExactSolid;
  torus(majorRadius: number, minorRadius: number): ExactSolid;
  /** Closed solid bounded by planar polygon faces (counter-clockwise seen from outside). */
  polyhedron(points: readonly Vec3[], faces: readonly (readonly number[])[]): ExactSolid;

  readonly profile: ExactProfileOps;
  /** Prism from z = 0 to z = height. */
  extrude(profile: ExactProfile, height: number): ExactSolid;
  /** Revolve the XY profile (X radius, Y height) about world Z by `degrees` (0 < |degrees| <= 360). */
  revolve(profile: ExactProfile, degrees: number): ExactSolid;

  union(first: ExactSolid, ...rest: ExactSolid[]): ExactSolid;
  subtract(base: ExactSolid, ...cutters: ExactSolid[]): ExactSolid;
  intersect(first: ExactSolid, ...rest: ExactSolid[]): ExactSolid;

  translate(solid: ExactSolid, offset: Vec3): ExactSolid;
  /** Right-handed rotation about an axis through `pivot` (default origin). */
  rotate(solid: ExactSolid, axis: Vec3, degrees: number, pivot?: Vec3): ExactSolid;
  /** Reflection in the plane through the origin with this normal. */
  mirror(solid: ExactSolid, normal: Vec3): ExactSolid;
  /** Per-axis scale about the origin; negative factors mirror. */
  scale(solid: ExactSolid, factors: Vec3): ExactSolid;

  fillet(solid: ExactSolid, radius: number, edges?: EdgeSelector): ExactSolid;
  chamfer(solid: ExactSolid, distance: number, edges?: EdgeSelector): ExactSolid;
  /** Hollow inward to wall `thickness`; the face with outward normal `openFaceNormal` is removed. */
  shell(solid: ExactSolid, thickness: number, openFaceNormal?: Vec3): ExactSolid;

  volume(solid: ExactSolid): number;
  area(solid: ExactSolid): number;
  bbox(solid: ExactSolid): BoundingBox;
  /** Closed, manifold, positive volume. */
  isValid(solid: ExactSolid): boolean;
  /** Number of separate solids (disconnected components) in the body. */
  solidCount(solid: ExactSolid): number;

  /** Triangles within `tolerance` mm chordal deviation (and `angleDeg` normal deviation). */
  tessellate(solid: ExactSolid, options?: { tolerance?: number; angleDeg?: number }): TriangleMesh;
  /** AP214 STEP text, millimetres. */
  exportStep(solid: ExactSolid): string;
  /** Exact STEP import (the kernel's own reader); used to check exact round trips. */
  importStep(text: string): ExactSolid;

  memory(): KernelMemory;
  /** Run `fn`, freeing every kernel object it made that its result does not hold. */
  scope<T>(fn: () => T): T;
}
