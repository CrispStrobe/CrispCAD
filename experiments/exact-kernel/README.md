# Exact B-rep backend experiment: the lab's exact kernel (SMLib)

Delivery step 4 of [PARAMETRIC-CAD-STRATEGY.md](../../docs/PARAMETRIC-CAD-STRATEGY.md)
("Exact-backend qualification") and item 2 of the
[kernelCAD review](../../docs/KERNELCAD-REVIEW.md#fork-recommendation-defer): qualify an
exact B-rep kernel **standalone**, behind a narrow interface, with the 27-part kernelCAD
scorecard as the gate.

**Status: qualified; in the product since 2026-11-25** as the opt-in
[`@brickwright/cad-exact`](../../packages/exact) package (`export step`, `measure exact`; see
[Product path](#product-path-2026-11-25)). This directory remains the qualification suite. The
kernel is the CrispCAD kernel lab's
[`@crispcad/exact-kernel`](https://github.com/CrispStrobe/crispcad-kernel-lab/tree/ccr-f42f1bfe-3ekdio/packages/exact-kernel)
0.1.1 (MIT AND Apache-2.0), installed from the tarball of the lab release
[`exact-kernel-v0.1.1`](https://github.com/CrispStrobe/crispcad-kernel-lab/releases/tag/exact-kernel-v0.1.1)
and pinned by URL and lockfile integrity (Phase 2b of
[CRISPCAD-CONVERGENCE.md](../../docs/CRISPCAD-CONVERGENCE.md#phase-2b-move-the-exact-kernel-into-the-lab-as-a-package)).
Since 2026-11-25 it is a dependency of `packages/exact` (same URL and integrity), and this
directory uses the root install; until then it had its own `package.json` dependency and lock. The
package prebundles `@classcad/smlibwasm` 0.6.2 without its font, so every installed file is
MIT or Apache-2.0 (see [Licence audit](#licence-audit)).

The `ExactKernel` interface, its SMLib implementation and the exact convex hull
(`src/exact-kernel.ts`, `src/smlib-kernel.ts`, `src/polytope.ts` until 2026-11-25) moved into
that package. The CAD Script lowering moved to
[`packages/exact/src/lower-cad-script.ts`](../../packages/exact/src/lower-cad-script.ts) on
2026-11-25; the tests here import it from there.

## Run

```sh
npm ci                                   # repository root, including @crispcad/exact-kernel
npx tsc -b packages/core packages/geometry packages/exact
cd experiments/exact-kernel
npm test                                 # 99 tests
npm run typecheck
npm run bench                            # timings and WASM memory -> results/bench-<os>-<arch>.json
node product-bench.ts                    # product path in Node -> results/node-product-<os>-<arch>.json
node licence-audit.mjs [--files]         # every installed file, size, hash, licence
```

Node ≥ 22.18 (tested on 26.4). `vitest` and `typescript` come from the root install.

## What is here

| File | Purpose |
| --- | --- |
| `@crispcad/exact-kernel` (installed) | The narrow `ExactKernel` interface and its SMLib implementation: centred box/cylinder/cone/sphere/torus, planar polyhedron, 2D profiles (polygon with holes, circle, rectangle, rounded rectangle, line/arc/spline paths, 2D Booleans, hull, offset, transforms), extrude, revolve, loft, sweep, union/subtract/intersect/split, translate/rotate/mirror/scale, fillet/chamfer (all edges or the edges of one planar face), shell (open faces), volume/area/bbox/mass properties/validity/components, tessellation, STL, STEP export and exact STEP import, kernel memory, `scope`; also `convexHull`. Opaque handles; inputs are validated before the kernel sees them; errors are `ExactKernelError` with code `unsupported`, `invalid-input` or `kernel-failure`. WASM loads only on `createSmlibKernel()`. Its own tests (in the lab) cover the lab's 27 reference parts at 1e-6 and a licence gate on the packed tarball. |
| [`packages/exact/src/lower-cad-script.ts`](../../packages/exact/src/lower-cad-script.ts) (moved there 2026-11-25) | Lowers this repository's compiled CAD Script (`compileCode(program).shape`, the `CodeShape`/`CodeProfile` trees of `@brickwright/cad-core`) onto `ExactKernel`, following the Manifold evaluator's conventions in `packages/geometry/src/kernel.ts`. No Manifold fallback. |
| `tests/reference-parts.test.ts` | The gate: the 27 scorecard parts (sources copied unchanged from the root `tests/reference-parts.test.ts`) at 1e-6 relative volume and area, bbox within 1e-6 mm, valid solid, expected component count. |
| `tests/lowering.test.ts` | 22 further CAD Script programs (Euler order, oblique mirror, signed scale, rigid and orthogonal-scale `affine`, partial/negative/mirrored revolves, profiles with holes, even-odd polygons, hulls, cone to a point, partial torus, `resize` of a sphere, round `offset2d`, `hull2d`, `repeat`, empty branches, a non-convex polyhedron) against Manifold (1e-3 volume, 0.05 mm bbox) and closed forms (1e-6). |
| `tests/kernel.test.ts` | Fillet, chamfer, shell and a cylinder-rim fillet against closed forms (1e-8); explicit `unsupported` cases; malformed input; recovery after kernel failures. |
| `tests/step-roundtrip.test.ts` | STEP out of SMLib, back in through the editor's importer and through SMLib's reader. |
| `tests/licence.test.ts` | The release tarball is pinned (URL and lockfile integrity), declares MIT AND Apache-2.0, has no runtime dependencies and no font; `Text()` fails cleanly; modeling and STEP work. |
| `bench.ts`, `results/` | Node timings and WASM memory. |
| `licence-audit.mjs` | File-by-file licence listing of the installed package and its bundle inputs. |

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

Measured 2026-11-24, Apple M1, macOS, Node 26.4.0, `@classcad/smlibwasm` 0.6.2; re-run 2026-11-25
through `@crispcad/exact-kernel` 0.1.0 (same SMLib build) with identical results.

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

## Product path (2026-11-25)

`@brickwright/cad-exact` lowers whole documents (not only CAD Script) and serves `export step`
and `measure exact` in the editor (a lazily created worker), the MCP host (a thread) and the CLI.
See [CRISPCAD-CONVERGENCE.md](../../docs/CRISPCAD-CONVERGENCE.md#phase-3-one-command-vocabulary)
for the design and [TERMINAL-WORKSPACE.md](../../docs/TERMINAL-WORKSPACE.md#exact-kernel-commands)
for the commands.

### Measurements: the 27 reference parts as one document

Measured 2026-11-25 on the same shared Apple M1 (load average 100–300 throughout, so treat
wall times as upper bounds). The document holds the 27 scorecard parts as code objects 400 mm
apart; `measure exact all` checks every volume against the closed form (1e-6, all pass in every
runtime), and `export step all` writes one 155 KB AP214 file with all 27 solids
(`MANIFOLD_SOLID_BREP` ≥ 27). Browser numbers come from
[`tests/browser/exact-kernel.spec.ts`](../../tests/browser/exact-kernel.spec.ts) against the
production build (`npm run build`, `vite preview`), with `EXACT_BENCH=1`; `load`, `run` and WASM
memory are measured inside the worker, `wall` in the test (terminal round trip, polled, so up to
about 1 s coarse). Raw data: [`results/browser-chromium.json`](results/browser-chromium.json),
[`results/browser-ipad-webkit.json`](results/browser-ipad-webkit.json),
[`results/node-product-darwin-arm64.json`](results/node-product-darwin-arm64.json).

| Runtime | Kernel load (download + compile 9.4 MB + init) | `measure exact`, 27 parts, first | again | `export step`, 27 parts | WASM memory |
| --- | --- | --- | --- | --- | --- |
| Chromium 151 (Playwright, desktop) | 260 ms | 759 ms (wall 2.2 s incl. load) | 527 ms | 817 ms (wall 1.1 s) | 64 MiB |
| WebKit 26.5, iPad Pro 11 emulation (Playwright) | 402 ms | 799 ms (wall 1.6 s) | 633 ms | 876 ms (wall 1.3 s) | 64 MiB |
| Node 26.4 (`product-bench.ts`, 3 runs) | 108–207 ms wall, ~0.2 s CPU | 1.4–1.7 s wall, ~2.0 s CPU | 0.9–1.1 s | 1.5–1.7 s | 64 MiB; RSS +63–108 MiB |

Observations:

- The kernel loads only on the first exact request: before it, no file under `assets/exact/`
  is requested (checked in both browsers). Afterwards the service worker serves it from its
  lazy cache.
- Linear memory stays at the 64 MiB the module reserves at load for this workload (all
  handles freed after every request; `handles` 0). The 48-hole stress plate grew it to 92 MiB
  in the Node bench. Terminating the exact worker (cancel, 60 s timeout, editor disposal)
  releases it.
- The second `measure exact` is ~30 % faster than the first (JIT and kernel warm-up).
- **iPad caveat:** WebKit here is desktop WebKit on the M1 with iPad emulation (viewport, touch,
  user agent), not iOS. No physical iPad was reachable from this machine, so iOS memory limits
  (tab termination well below the 4 GB wasm32 limit) and the slower A-series compile are not
  measured. Expect the cold load to be several times slower on an iPad; the 64 MiB baseline
  is a device-independent fact of the module.

## Licence audit

**Owner decision (2026-11-24): MIT + Apache-2.0 only.** `node licence-audit.mjs` lists the 23
installed files (10.7 MiB) of `@crispcad/exact-kernel@0.1.0`, declared `MIT AND Apache-2.0`,
with no runtime dependencies:

| Licence | Files | Bytes | Notes |
| --- | --- | --- | --- |
| Apache-2.0 + MIT | `dist/smlibwasm.wasm` | 9 430 902 | SMLib and its SM_API wrapper from NVIDIA USD BRep (Apache-2.0, "a few files … modified by AWV Informatik AG to fix defects", patches listed in the smlibpy repository) with AWV's bindings (MIT), unmodified from `@classcad/smlibwasm` 0.6.2. |
| MIT | 9 JavaScript files in `dist/` | 1 787 503 | The package's adapter and the prebundled smlibwasm wrapper (AWV Informatik AG), its Emscripten loader (MIT) and the Brotli static dictionary (MIT). |
| MIT | types, manifest, README, `dist/bundle-inputs.json` | 28 186 | `bundle-inputs.json` lists all 64 bundled source files with their licence (63 MIT, the WASM Apache-2.0 AND MIT). |
| notices | `LICENSE`, `NOTICE`, `licenses/` (MIT: package, smlibwasm, Emscripten; Apache-2.0: USD BRep) | 17 208 | Must ship with any product use. |

How the closure is held to MIT + Apache-2.0:

- **The font is gone.** smlibwasm 0.6.2 is `MIT AND Apache-2.0 AND OFL-1.1`; its only OFL
  items were the Lato font (`dist/_fonts.js`, `dist/_fonts.d.ts`) and `fonts/OFL.txt`. The
  lab's build aliases `_fonts.js` to an empty module (tree-shaking alone does not remove it:
  `font.js` decodes it at module level, and the package has no `sideEffects: false`), and the
  other two files are not bundled. `Text()` then fails with `unsupported`; modeling and STEP
  are unaffected (`tests/licence.test.ts` here; `tests/no-font.test.ts` in the lab).
- **The lab's licence test** packs the tarball, unpacks it and fails on any file without a
  known MIT or Apache-2.0 licence, on OFL or GPL licence text, on any line of the upstream
  font's data, on runtime dependencies, and on any `replicad` or OpenCASCADE reference outside
  smlibwasm's `.brep` file-format strings. The WASM contains "Open CASCADE Topology" banners:
  they belong to smlibwasm's `.brep` reader and writer (`exportBrep`/`importBrep`), not to
  OpenCASCADE code; OCCT is not loaded.
- `tests/licence.test.ts` here checks that the dependency is the lab release tarball pinned by
  URL and integrity, that it is the only installed package, and the declared licences.
- smlibwasm's `show()`/`htmlPage` (which writes an HTML page loading three.js from
  cdn.jsdelivr.net) is still inside the bundle; a product build must not call it.
- Not verified: that the WASM binary is reproducible from the public smlibpy/usd-brep sources.
  A product entry should rebuild it (`npm run wasm` in smlibpy, Emscripten) and compare, or
  build it in the lab.

## Not covered

- Only compiled CAD Script is lowered. The editor's GUI document nodes (`extrusion`,
  `revolution`, `boolean`, `pattern`, `mirror`, sketches with constraints, imported meshes) are
  not; neither are sweeps along curves, lofts with curved sections, threads or drafts.
- CAD Script has no fillet/chamfer/shell feature, so those are tested through the interface
  only (all edges, or the edges of one planar face; one open face for shell). Edge/face
  selection by persistent identity (topological naming) is not attempted.
- Tessellation is checked only for size and timing, not for watertightness or as input to the
  Jolt collision pipeline.
- Browser/WebKit: measured in Chromium and iPad-emulated WebKit through the product path (see
  above); not on a physical iPad.
- Only SMLib. WASMLib and Solidcore are not implemented against `ExactKernel` here (the fork's
  `experiments/kernel-qualification` has WASMLib scorecard numbers).

## What product entry would need

Status 2026-11-25: items 1 (notices), 2 (browser measurements, except a physical iPad), 3 (worker
integration) and 4 (cancellation) are done for `export step` and `measure exact`; item 5 is done
for STEP and measures (display and collision stay on Manifold meshes); item 6 is open. Still open
from item 1: a reproducible or self-built WASM.

1. **Licences:** decided (MIT + Apache-2.0; the font is aliased away in the lab package). Still
   needed: the package's NOTICE/LICENSE texts in THIRD-PARTY-NOTICES.md, and a reproducible or
   self-built WASM.
2. **iPad WebKit measurements**: cold load (9.4 MB WASM compile; 0.3 s CPU / 0.5–1.1 s wall on a loaded M1 in
   Node), per-operation latency for the scorecard and the stress parts, and peak memory. The
   module reserves 64 MB at load and only grows (to 92 MB here); iOS kills tabs far below the
   module's 4 GB limit, so measure peak heap on large parts and recycle the worker when it grows.
3. **Worker integration**: run the kernel only in the geometry worker. Compile the module once
   and pass it with `createSmlibKernel({ wasmModule })` so a restarted worker does not
   recompile 9.4 MB (the package serves the file as `@crispcad/exact-kernel/smlibwasm.wasm`).
   In a browser the bundled smlibwasm starts a "defeature" supervisor worker when it loads
   (`dist/_defeature_supervisor.js`, next to the bundle) and probe workers for guarded fillet
   steps on imported parts: account for the
   extra threads, CSP `worker-src`, and a second WASM instance during those steps. Watch
   for WASM traps (smlibwasm's `memoryUsage().crashes`, not yet exposed by `ExactKernel.memory()`):
   after a trap the module's memory may be damaged, so the worker must be replaced.
4. **Cancellation and budgets**: kernel calls are synchronous; the stress cases take seconds.
   The worker needs a timeout/terminate path (smlibwasm's `KernelWorker` has one; the lab
   package does not expose it) and
   per-model budgets like the Manifold path's face limits.
5. **Wiring**: an exact body type beside Manifold's `BodyMesh` (tessellate for display and
   collision; keep the B-rep for STEP and measurements), explicit per-body kernel choice with
   these `unsupported` errors surfaced in the editor, and the root scorecard test run against
   both kernels.
6. **Editor STEP import**: oxideav-step cannot mesh full tori; either fix it there or import
   STEP through SMLib.
