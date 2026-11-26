// SPDX-License-Identifier: BSD-3-Clause
// Limits for exact jobs, so a heavy fillet or shell is refused before the kernel runs instead of
// growing the kernel's memory until a tablet's browser kills the tab.
//
// Measured 2026-11-26 (experiments/exact-kernel/limits-bench.ts, results/limits-*.json): on a
// plate with n holes, the cost of a fillet, chamfer or shell and of its display mesh grows with the
// number of edges the feature rounds (fillet/chamfer) or the faces it offsets (shell); see the
// README there for the table these defaults come from.
//
// This module loads no kernel code: the editor's main thread imports it (as
// `@brickwright/cad-exact/limits`) to resolve a host's limits before the exact worker exists.

export interface ExactLimits {
 /** Fillet and chamfer: the most edges one feature may round or bevel, counted in straight edges:
  * a curved edge (a hole rim, an arc) counts as CURVED_EDGE_WEIGHT straight ones. */
 readonly maxFeatureEdges:number;
 /** Shell: the most faces the shelled body may have (the kernel offsets every one). */
 readonly maxShellFaces:number;
 /** The exact kernel's WebAssembly memory may not grow beyond this (bytes; applied where the kernel
  * loads, i.e. in the editor's exact worker). A job that needs more fails cleanly. */
 readonly maxMemoryBytes:number;
 /** After a job that left the kernel's memory above this (bytes), the host discards the kernel
  * (terminates its worker) so memory returns to its baseline; the next job loads it again. */
 readonly recycleAboveBytes:number;
 /** The whole request, including the first load, is stopped after this long (ms). */
 readonly requestTimeoutMs:number;
}

const MiB=1048576;
/** A curved edge costs the kernel about this many straight ones to round or bevel (measured: 100
 * hole rims 27 s CPU against 6.5 s for 100 straight edges, fillet plus display). */
export const CURVED_EDGE_WEIGHT=4;
/**
 * Thresholds (experiments/exact-kernel/README.md, "Heavy jobs"): on the M1, 100 hole rims (400
 * weighted edges) take about 14 s unloaded to fillet and mesh, a shell of 156 faces about 12 s;
 * that leaves room for a slower tablet inside the 60 s budget. Everyday parts are far below:
 * a box filleted on every edge is 12, a plate with 25 holes 104. The 200-hole rim fillet (804) and
 * shell (206 faces) of the measurements are refused here and allowed on desktop.
 *
 * Defaults for tablets and phones, and every host that does not choose: iPad Safari tabs are
 * killed at roughly 1–1.5 GB for the whole page, and WebAssembly memory never shrinks.
 */
export const EXACT_LIMITS_TABLET:ExactLimits=Object.freeze({maxFeatureEdges:400,maxShellFaces:160,maxMemoryBytes:512*MiB,recycleAboveBytes:192*MiB,requestTimeoutMs:60000});
/** For desktop hosts (Electron/WKWebView on a Mac, desktop browsers) that can afford more. */
export const EXACT_LIMITS_DESKTOP:ExactLimits=Object.freeze({maxFeatureEdges:1000,maxShellFaces:500,maxMemoryBytes:2048*MiB,recycleAboveBytes:512*MiB,requestTimeoutMs:120000});
/** No pre-flight refusal and no memory cap (tests, CLI, benches). */
export const EXACT_LIMITS_NONE:ExactLimits=Object.freeze({maxFeatureEdges:Infinity,maxShellFaces:Infinity,maxMemoryBytes:Infinity,recycleAboveBytes:Infinity,requestTimeoutMs:Infinity});

/** `limits` with every missing or invalid field taken from `base`. */
export function resolveExactLimits(limits:Partial<ExactLimits>|undefined,base:ExactLimits=EXACT_LIMITS_TABLET):ExactLimits{
 const out={...base} as Record<keyof ExactLimits,number>;
 for(const key of Object.keys(base) as (keyof ExactLimits)[]){
  const value=limits?.[key];
  if(typeof value==='number'&&value>0)out[key]=value;
 }
 return Object.freeze(out);
}
