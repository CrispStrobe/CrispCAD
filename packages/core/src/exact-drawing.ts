// SPDX-License-Identifier: BSD-3-Clause
/**
 * What the exact kernel reports for a hidden-line drawing (the `drawing` exact request): per body
 * its B-rep edges, faces and a face-wise mesh, or why the body could not be built exactly. The
 * kernel side is @brickwright/cad-exact (drawing.ts); the projection is the editor's
 * (exact-drawing-projection.ts). Plain data, so it crosses worker boundaries unchanged.
 */
export interface ExactDrawingEdge {
 /** SMLib's curve kind: 'line', 'circle', 'ellipse', 'bspline' or 'other'. */
 readonly curve:string;
 /** The faces the edge bounds (indices into the body's `faces`). */
 readonly faces:readonly number[];
 /** Points from the edge's start to its end, flat x,y,z: the two ends of a line, up to 49 on a curve. */
 readonly points:readonly number[];
 readonly closed:boolean;
 readonly length:number;
 /** Circular edges: exact centre, radius and unit axis. */
 readonly circle?:{readonly center:readonly number[];readonly radius:number;readonly axis:readonly number[]};
}
export interface ExactDrawingFace {
 readonly surface:string;
 /** The face's stable name `<node>:f<k>` (exact-edge-references.ts), where it has one. Drawing data
  * names the faces of every body, so datums and tolerances can be attached by name. */
 readonly name?:string;
 /** A point on the face and the outward normal there. */
 readonly point:readonly number[];
 readonly normal:readonly number[];
 readonly radius?:number;
 readonly axis?:{readonly origin:readonly number[];readonly direction:readonly number[]};
}
export interface ExactDrawingBody {
 readonly id:string;
 readonly name:string;
 readonly faces:readonly ExactDrawingFace[];
 readonly edges:readonly ExactDrawingEdge[];
 /** Face-wise triangle mesh in world millimetres, consistently oriented; `faceOf[i]` is the face of triangle i. */
 readonly mesh:{readonly positions:Float64Array;readonly indices:Uint32Array;readonly faceOf:Uint32Array};
 /** Chord tolerance of `mesh` (mm). */
 readonly tolerance:number;
 /** Exact bounding box. */
 readonly bounds:{readonly min:readonly number[];readonly max:readonly number[]};
}
export interface ExactDrawingFailure {readonly id:string;readonly name:string;readonly code:string;readonly message:string}
export interface ExactDrawingData {readonly bodies:readonly ExactDrawingBody[];readonly failures:readonly ExactDrawingFailure[]}


/**
 * An edge of a section's cut face (the `section` exact request): the edge, with `faces` indexing
 * `surfaces`, the cut face and the face across the edge (a cylinder's ellipse needs both).
 */
export interface ExactSectionEdge extends ExactDrawingEdge {readonly surfaces:readonly ExactDrawingFace[]}
/** One body cut at each position of a section (one entry per leg; no edges where the plane misses it). */
export interface ExactSectionBody {readonly id:string;readonly name:string;readonly legs:readonly (readonly ExactSectionEdge[])[]}
export interface ExactSectionData {
 /** The world axis the cutting planes are normal to (0: X, 1: Y) and their positions, one per leg. */
 readonly axis:0|1;readonly positions:readonly number[];
 readonly bodies:readonly ExactSectionBody[];readonly failures:readonly ExactDrawingFailure[];
}
