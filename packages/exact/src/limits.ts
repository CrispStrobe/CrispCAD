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
 /** The exact kernel's WebAssembly memory may not grow beyond this (bytes; the kernel's
  * `maxMemoryBytes`, applied where it loads, i.e. in the editor's exact worker, once per worker).
  * A job that needs more fails cleanly with "ran out of memory". */
 readonly maxMemoryBytes:number;
 /** After a job that left the kernel's memory above this (bytes), the host discards the kernel
  * (terminates its worker) so memory returns to its baseline; the next job loads it again. */
 readonly recycleAboveBytes:number;
 /** The whole request, including the first load, is stopped after this long (ms): the host ends
  * the worker. The kernel's own guard for shell-like steps is derived from it (`exactGuardSeconds`). */
 readonly requestTimeoutMs:number;
 /** STEP import: files above this size (bytes) are refused before the kernel reads them. Reading,
  * re-checking and meshing bodies took 1–3 s CPU per 100 KiB of STEP on the loaded M1
  * (experiments/exact-kernel, "STEP import"), and the whole import shares the request budget. */
 readonly maxStepImportBytes:number;
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
export const EXACT_LIMITS_TABLET:ExactLimits=Object.freeze({maxFeatureEdges:400,maxShellFaces:160,maxMemoryBytes:512*MiB,recycleAboveBytes:192*MiB,requestTimeoutMs:60000,maxStepImportBytes:4*MiB});
/** For desktop hosts (Electron/WKWebView on a Mac, desktop browsers) that can afford more. */
export const EXACT_LIMITS_DESKTOP:ExactLimits=Object.freeze({maxFeatureEdges:1000,maxShellFaces:500,maxMemoryBytes:2048*MiB,recycleAboveBytes:512*MiB,requestTimeoutMs:120000,maxStepImportBytes:16*MiB});
/** No pre-flight refusal and no memory cap (tests, CLI, benches). */
export const EXACT_LIMITS_NONE:ExactLimits=Object.freeze({maxFeatureEdges:Infinity,maxShellFaces:Infinity,maxMemoryBytes:Infinity,recycleAboveBytes:Infinity,requestTimeoutMs:Infinity,maxStepImportBytes:Infinity});

/** `limits` with every missing or invalid field taken from `base`. */
export function resolveExactLimits(limits:Partial<ExactLimits>|undefined,base:ExactLimits=EXACT_LIMITS_TABLET):ExactLimits{
 const out={...base} as Record<keyof ExactLimits,number>;
 for(const key of Object.keys(base) as (keyof ExactLimits)[]){
  const value=limits?.[key];
  if(typeof value==='number'&&value>0)out[key]=value;
 }
 return Object.freeze(out);
}

/**
 * The kernel's guard for shell, offset and similar steps (`createSmlibKernel({guardSeconds})`),
 * derived from the request budget: half of it, so a step the kernel stops itself leaves time for
 * the rest of the job and answers before the host has to end the worker. Undefined (the kernel's
 * own 20 s) without a finite budget. The guard is wall-clock only where the kernel can run a probe
 * worker (Node, cross-origin-isolated workers); in an ordinary Web Worker SMLib checks it only
 * inside long intersection loops, so the request budget and ending the worker stay the real stop.
 */
export function exactGuardSeconds(limits:Pick<ExactLimits,'requestTimeoutMs'>):number|undefined{
 const ms=limits.requestTimeoutMs;
 return Number.isFinite(ms)&&ms>0?Math.max(1,Math.floor(ms/2000)):undefined;
}
/**
 * The kernel load options `limits` imply (pass them to `createExactBackend` where the kernel
 * loads): the memory ceiling, when finite, and the guard. Both hold for the whole process or
 * worker; the kernel loads once there, so a host with other limits starts a new worker.
 */
export function exactKernelOptions(limits:Pick<ExactLimits,'maxMemoryBytes'|'requestTimeoutMs'>):{maxMemoryBytes?:number;guardSeconds?:number}{
 const guardSeconds=exactGuardSeconds(limits);
 return {...(Number.isFinite(limits.maxMemoryBytes)&&limits.maxMemoryBytes>0?{maxMemoryBytes:limits.maxMemoryBytes}:{}),...(guardSeconds!==undefined?{guardSeconds}:{})};
}
