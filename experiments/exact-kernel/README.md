# Exact B-rep backend experiment: SMLib via `@classcad/smlibwasm`

Delivery step 4 of [PARAMETRIC-CAD-STRATEGY.md](../../docs/PARAMETRIC-CAD-STRATEGY.md)
("Exact-backend qualification") and item 2 of the
[kernelCAD review](../../docs/KERNELCAD-REVIEW.md#fork-recommendation-defer): qualify an
exact B-rep kernel **standalone**, behind a narrow interface, with the 27-part kernelCAD
scorecard as the gate.

**Status: experiment only.** `@classcad/smlibwasm` 0.6.2 is a dependency of this directory's
own `package.json` and nothing else. It is not in the root `package.json`, the workspaces or
any `packages/*` code, and nothing here is shipped. The licence decision on its OFL-1.1 font
is pending with the owner (see [Licence audit](#licence-audit)).

## Run

```sh
npm ci                                   # repository root: vitest, TypeScript, Manifold, cad-core
npx tsc -b packages/core packages/geometry
cd experiments/exact-kernel
npm ci                                   # only @classcad/smlibwasm (12 MB, no dependencies)
npm test                                 # 97 tests, about 40 s
npm run typecheck
npm run bench                            # timings and WASM memory -> results/bench-<os>-<arch>.json
node licence-audit.mjs [--files]         # every shipped file, size, hash, licence
node check-no-font.mjs                   # modeling + STEP with the OFL font stubbed out
```

Node ≥ 22.18 (tested on 26.4). `vitest` and `typescript` come from the root install.

## What is here

| File | Purpose |
| --- | --- |
| [`src/exact-kernel.ts`](src/exact-kernel.ts) | The narrow `ExactKernel` interface: centred box/cylinder/cone/sphere/torus, planar polyhedron, 2D profiles (polygon with holes, circle, rectangle, 2D Booleans, hull, offset, transforms), extrude, revolve, union/subtract/intersect, translate/rotate/mirror/scale, fillet/chamfer (all edges or the edges of one planar face), shell (one open face), volume/area/bbox/validity/component count, tessellation, STEP export and exact STEP import, kernel memory, `scope`. Opaque handles; errors are `ExactKernelError` with code `unsupported`, `invalid-input` or `kernel-failure`. |
| [`src/smlib-kernel.ts`](src/smlib-kernel.ts) | The SMLib implementation. Validates inputs before the kernel sees them, converts every kernel exception into `kernel-failure`, and rejects any result that is not a solid. The package is imported lazily because it instantiates its WASM at import time. |
| [`src/lower-cad-script.ts`](src/lower-cad-script.ts) | Lowers this repository's compiled CAD Script (`compileCode(program).shape`, the `CodeShape`/`CodeProfile` trees of `@brickwright/cad-core`) onto `ExactKernel`, following the Manifold evaluator's conventions in `packages/geometry/src/kernel.ts`. No Manifold fallback. |
| [`src/polytope.ts`](src/polytope.ts) | Exact convex hull of a small point set as planar polygon faces (for `hull` of polyhedral solids and convex `polyhedron`/`loft` output). |
| `tests/reference-parts.test.ts` | The gate: the 27 scorecard parts (sources copied unchanged from the root `tests/reference-parts.test.ts`) at 1e-6 relative volume and area, bbox within 1e-6 mm, valid solid, expected component count. |
| `tests/lowering.test.ts` | 22 further CAD Script programs (Euler order, oblique mirror, signed scale, rigid and orthogonal-scale `affine`, partial/negative/mirrored revolves, profiles with holes, even-odd polygons, hulls, cone to a point, partial torus, `resize` of a sphere, round `offset2d`, `hull2d`, `repeat`, empty branches, a non-convex polyhedron) against Manifold (1e-3 volume, 0.05 mm bbox) and closed forms (1e-6). |
| `tests/kernel.test.ts` | Fillet, chamfer, shell and a cylinder-rim fillet against closed forms (1e-8); explicit `unsupported` cases; malformed input; recovery after kernel failures. |
| `tests/step-roundtrip.test.ts` | STEP out of SMLib, back in through the editor's importer and through SMLib's reader. |
| `tests/licence.test.ts`, `check-no-font.mjs` | Modeling and STEP work with the OFL font removed. |
| `bench.ts`, `results/` | Node timings and WASM memory. |
| `licence-audit.mjs` | File-by-file licence listing of the installed package. |

### CAD Script lowering

| CAD Script (`CodeShape` / `CodeProfile`) | Exact lowering |
| --- | --- |
| `box`, `cylinder`, `frustum` (cone, cone to a point), `sphere` | SMLib primitives, centred like CAD Script. `segments` is a faceting hint: circles are exact. |
| `extrude`, `extrudeProfile` (no twist, no top scale) | Planar profile extruded from z = 0. |
| `revolve`, `torus` (full and partial) | Profile turned upright (sketch Y → world Z) and revolved about Z, counter-clockwise; negative sweeps mirror in Y and wholly non-positive profiles are reflected, as in the Manifold evaluator. Profiles crossing the axis are `invalid-input`. |
| `union`, `subtract`, `intersect`, `empty` | SMLib Booleans; `empty()` operands behave as in Manifold. |
| `move`, `rotate` (X then Y then Z), `scale` (signed), `mirror`, `axisRotate`, `repeat`, `resize` | Kernel transforms; `resize` uses the exact bounding box. |
| `affine` | Only when the columns are orthogonal (rotation × axis scale × translation). Shear is `unsupported`. |
| `polyhedron`, `loft` (planar output) | Convex input → one face per supporting plane (coplanar triangles merged); non-convex → faces stitched as given. More than 256 faces → `unsupported`. |
| `hull` | Polyhedral leaves (boxes, polyhedra, straight-edged extrusions, also tapered) → exact convex polytope. Equal spheres whose centres span an axis-aligned box → that box grown by *r* with every edge filleted at *r* (the exact identity behind the scorecard's `rounded-box`). |
| Profiles: `polygon2d` (even-odd, holes), `circle2d`, `rectangle2d`, `move2d`/`rotate2d`/`scale2d`, `affine2d` (no shear), `resize2d`, `offset2d`, `union2d`/`subtract2d`/`intersect2d`, `hull2d` | SMLib sketches; arcs stay exact (offset corners, hull tangents). |

`unsupported` (explicit error, tested): `minkowski`, `minkowski2d`, `text2d`, twisted or
tapered `extrudeProfile`, circles with fewer than 16 segments (the `cylinder(r, h, 6)`
hexagon idiom is ambiguous), tessellated constructors that compile to large polyhedra
(`ellipsoid`, `ellipticFrustum`, `roundedCylinder`, many-section lofts), hulls of anything
else (cylinders, unequal spheres, spheres mixed with polytopes, non-uniformly scaled spheres),
sheared `affine`/`affine2d`.

## Results

Measured 2026-11-24, Apple M1, macOS, Node 26.4.0, `@classcad/smlibwasm` 0.6.2.

| Gate | Result |
| --- | --- |
| 27 reference parts at 1e-6 | **27/27**. Worst relative error: volume 1.4e-15, area 1.2e-11 (all other parts ≤ 1e-14); bbox 3.2e-13 mm. Every result is a valid solid with the expected number of components. |
| Further CAD Script programs | 22/22 agree with Manifold and with the closed forms. |
| Fillet / chamfer / shell | Box all-edge fillet r 3, top chamfer 2, open-top shell 3 mm and a cylinder-rim fillet match closed forms to 1e-8; filleted + shelled box 14 950.678 mm³ (as in the fork's qualification). |
| STEP → SMLib reader | 27/27 exact: volume ≤ 6.1e-15 relative, bbox ≤ 2.7e-13 mm, multi-body files included. |
| STEP → editor importer (`step-tessellator.wasm`) | 26/27 read. Planar parts: volume and bbox identical (≤ 1e-9). Curved parts: volume within 6.4e-3, bbox within 0.03 mm — the importer facets circles with about 32 segments (6.4e-3 is exactly the 32-gon's area deficit). **`torus-revolve` is not readable**: oxideav-step 0.0.1 cannot mesh a closed `TOROIDAL_SURFACE` face (same for SMLib's `Torus` primitive); SMLib itself reads the file exactly. The test records this gap so a fix shows. |
| Malformed input | Bad CAD Script, wrong schema, oversized source, empty result, non-finite/negative/degenerate dimensions, bad polyhedron indices, out-of-range revolve, axis-crossing profiles: `invalid-input` before the kernel runs. Impossible fillet (r 6 on a 10 mm cube), impossible shell, broken and non-STEP text: `kernel-failure`. The kernel keeps working afterwards and reports no WASM trap. The editor importer rejects a truncated export. |

### Timing and memory (Node)

`npm run bench`; raw data in [`results/bench-darwin-arm64.json`](results/bench-darwin-arm64.json).
**Caveat:** the M1 was shared with other jobs (load average 125–230 during every run), so
wall-clock times swung 5× between runs and are not meaningful. The table gives **process CPU
time**, which for single-threaded WASM tracks compute and stayed within about ±20 % across
runs. Build = median of 5 evaluations (CAD Script compile + lowering + kernel); tessellation at
the default 0.01 mm / 10°.

| Measure | CPU time |
| --- | --- |
| Import + WASM instantiate | 0.26–0.31 s (wall 0.5–1.1 s under load) |
| 27-part scorecard, build | **0.83–0.88 s** total; 2–150 ms per part (rounded box 150 ms) |
| 27-part scorecard, tessellate | 2.1–2.2 s total; sphere 0.6 s (14 478 triangles), torus 0.6 s (21 944) |
| 27-part scorecard, STEP export | 0.4 s total; 2–25 KB per part |
| Plate with 48 holes: build / tessellate / STEP | 0.77–0.84 s / **3.7–4.5 s** (12 492 triangles) / 0.14–0.19 s |
| Filleted (r 4) + shelled (2 mm) box | 0.89–1.05 s / 0.25–0.32 s / 0.07–0.09 s |
| L bracket with hole, all 12+ edges filleted r 1 | 0.24–0.34 s / 0.26–0.34 s / 0.04–0.06 s |

| WASM memory | |
| --- | --- |
| Linear memory after load | 64 MiB (includes an 8 MB out-of-memory reserve) |
| Peak linear memory, whole bench | 92 MiB (it never shrinks) |
| Kernel bytes in use / live handles after disposing every result | 0 / 0 (no leak through the adapter; `scope` frees intermediates) |
| Node RSS growth over the bench | 11–25 MiB |

Observations: build times are in line with the fork's Linux numbers (27 parts 1.1–1.5 s wall,
48-hole plate 0.7–0.8 s). **Display tessellation is the slow step**, and it is superlinear in
the number of holes in one face: the 48-hole plate's mesh took 0.14 s CPU with 1 hole, 0.9 s
with 24 and 3.8 s with 48 (quadratic), and a coarser 0.1 mm tolerance did not help. A product
path needs a different display mesher for planar faces, per-face caching, or Manifold for
display. Lowering `a − (b ∪ c)` as one n-ary cut (instead of fusing the cutters first) was
about 1.6× faster on the 48-hole plate and is what the lowering does.

## Licence audit

`node licence-audit.mjs` lists all 120 files (11.9 MiB) of `@classcad/smlibwasm@0.6.2`
(declared `MIT AND Apache-2.0 AND OFL-1.1`, no dependencies):

| Licence | Files | Bytes | Notes |
| --- | --- | --- | --- |
| Apache-2.0 + MIT | `wasm/smlibwasm.wasm`, `wasm/smlibwasm.mjs` | 9 518 020 | SMLib and its SM_API wrapper from NVIDIA USD BRep (Apache-2.0, "a few files … modified by AWV Informatik AG to fix defects", patches listed in the smlibpy repository), AWV's bindings (MIT), Emscripten runtime (MIT/UIUC). wasm SHA-256 `d00feb54…952c1a9e`. |
| MIT | 110 files in `dist/` | 2 513 955 | AWV Informatik AG's TypeScript wrapper (compiled JS + d.ts). `_brotli.js` is "after" Google's MIT reference decoder. |
| MIT | `dist/_brotli_dictionary.js`, `.d.ts` | 158 097 | Brotli static dictionary (RFC 7932), only used to read WOFF2 fonts. |
| **OFL-1.1** | `dist/_fonts.js`, `dist/_fonts.d.ts` | 260 966 | **Lato Regular 1.105** as base64, the default font of `Text()`. The `.d.ts` repeats the base64 as a literal type. |
| OFL-1.1 (text) | `fonts/OFL.txt` | 4 536 | Lato licence. |
| notices | `LICENSE` (MIT), `NOTICE`, `LICENSE.usd-brep` (Apache-2.0) | 15 008 | Must ship with any product use. |

Findings:

- **The OFL item is only the Lato font**, and it can be dropped. Nothing in modeling or STEP
  uses it: with `dist/_fonts.js` replaced by an empty string (a Node module hook in
  `check-no-font.mjs`; in a product build a bundler alias), a filleted, shelled box builds and
  round-trips STEP exactly, and only `Text()` without an explicit font fails, cleanly, with
  `FontError`. `fonts/OFL.txt` and `_fonts.d.ts` then go too. Tree-shaking alone does **not**
  remove it: `font.js` decodes it at module level (`DEFAULT_FONT = _fromBase64(LATO_REGULAR)`)
  and the package has no `sideEffects: false`, so a Vite build that imports only
  `Box`/`fuse`/`fillet`/`toStep` by name still contains the font (checked; the Brotli dictionary
  is removed). Options: a build alias to an empty `_fonts.js` (the wrapper is MIT, so the patch
  is allowed), or ask upstream for a font-free entry. Note that OFL-1.1 itself permits bundling
  with software; the question is only the owner's policy.
- No GPL/LGPL/AGPL text in `dist/` or the WASM strings. The WASM contains "Open CASCADE
  Topology" banners: those are the `.brep` file-format reader/writer (NVIDIA usd-brep's bridge,
  `exportBrep`/`importBrep`), not OpenCASCADE code; OCCT is not loaded.
- `dist/viewer.js` (`show()`/`htmlPage`) writes an HTML page that loads three.js from
  cdn.jsdelivr.net. Not used here; a product build must not call it.
- Not verified here: that the WASM binary is reproducible from the public smlibpy/usd-brep
  sources. A product entry should rebuild it (`npm run wasm` in smlibpy, Emscripten) and compare,
  or build it ourselves.

## Not covered

- Only compiled CAD Script is lowered. The editor's GUI document nodes (`extrusion`,
  `revolution`, `boolean`, `pattern`, `mirror`, sketches with constraints, imported meshes) are
  not; neither are sweeps along curves, lofts with curved sections, threads or drafts.
- CAD Script has no fillet/chamfer/shell feature, so those are tested through the interface
  only (all edges, or the edges of one planar face; one open face for shell). Edge/face
  selection by persistent identity (topological naming) is not attempted.
- Tessellation is checked only for size and timing, not for watertightness or as input to the
  Jolt collision pipeline.
- Browser/WebKit: nothing was run in a browser, a worker or on an iPad; all numbers are Node.
- Only SMLib. WASMLib and Solidcore are not implemented against `ExactKernel` here (the fork's
  `experiments/kernel-qualification` has WASMLib scorecard numbers).

## What product entry would need

1. **Licence decision** on the Lato font (or the alias above), NOTICE/LICENSE texts in
   THIRD-PARTY-NOTICES.md, and a reproducible or self-built WASM.
2. **iPad WebKit measurements**: cold load (9.4 MB WASM compile; 0.3 s CPU / 0.5–1.1 s wall on a loaded M1 in
   Node), per-operation latency for the scorecard and the stress parts, and peak memory. The
   module reserves 64 MB at load and only grows (to 92 MB here); iOS kills tabs far below the
   module's 4 GB limit, so measure peak heap on large parts and recycle the worker when it grows.
3. **Worker integration**: run the kernel only in the geometry worker. Compile the module once
   and pass it with `@classcad/smlibwasm/init` (`wasmModule`) so a restarted worker does not
   recompile 9.4 MB. In a browser the package starts a "defeature" supervisor worker at import
   (`_guard.js`) and probe workers for guarded fillet steps on imported parts: account for the
   extra threads, CSP `worker-src`, and a second WASM instance during those steps. Watch
   `memoryUsage().crashes`: after a WASM trap the package says its memory may be damaged, so the
   worker must be replaced.
4. **Cancellation and budgets**: kernel calls are synchronous; the stress cases take seconds.
   The worker needs a timeout/terminate path (the package's `KernelWorker` has one) and
   per-model budgets like the Manifold path's face limits.
5. **Wiring**: an exact body type beside Manifold's `BodyMesh` (tessellate for display and
   collision; keep the B-rep for STEP and measurements), explicit per-body kernel choice with
   these `unsupported` errors surfaced in the editor, and the root scorecard test run against
   both kernels.
6. **Editor STEP import**: oxideav-step cannot mesh full tori; either fix it there or import
   STEP through SMLib.
