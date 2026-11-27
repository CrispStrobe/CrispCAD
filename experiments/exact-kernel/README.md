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
0.1.9 (MIT AND Apache-2.0), installed from the tarball of the lab release
[`exact-kernel-v0.1.9`](https://github.com/CrispStrobe/crispcad-kernel-lab/releases/tag/exact-kernel-v0.1.9)
and pinned by URL and lockfile integrity (Phase 2b of
[CRISPCAD-CONVERGENCE.md](../../docs/CRISPCAD-CONVERGENCE.md#phase-2b-move-the-exact-kernel-into-the-lab-as-a-package)).
Since 2026-11-25 it is a dependency of `packages/exact` (same URL and integrity), and this
directory uses the root install; until then it had its own `package.json` dependency and lock. The
package prebundles smlibwasm 0.6.2 (`@classcad/smlibwasm`), built from source in the lab with
recorded provenance and without its font, so every installed file is
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
| `polyhedron`, `loft` (planar output) | Convex input → one face per supporting plane (coplanar triangles merged); non-convex → faces stitched as given. More than 2,048 faces → `unsupported` (256 until 2026-11-25). |
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

### Browser: features, memory and the main thread (2026-11-26)

[`tests/browser/exact-kernel-bench.spec.ts`](../../tests/browser/exact-kernel-bench.spec.ts)
(opt-in: `EXACT_BENCH=1 npx playwright test tests/browser/exact-kernel-bench.spec.ts`) builds
[`browser-bench/`](browser-bench) with Vite (the WebAssembly is emitted as a file, as in the
product), serves it cross-origin isolated, and runs the same `feature-display` requests twice:
in a module worker, as the editor's exact worker does, and on the page's own thread through
`createInThreadExactHost`, which is what a host without a worker (and the main thread of any host
before the worker move) pays. A 0 ms timer chain on the main thread records its longest gap and
the time blocked beyond 50 ms per step; Chromium also reports Long Tasks (WebKit has no Long Tasks
API). The second test drives the real editor (production build) through the terminal. Raw data:
[`results/browser-bench-ipad-webkit.json`](results/browser-bench-ipad-webkit.json),
[`results/browser-bench-chromium.json`](results/browser-bench-chromium.json),
[`results/browser-editor-ipad-webkit.json`](results/browser-editor-ipad-webkit.json),
[`results/browser-editor-chromium.json`](results/browser-editor-chromium.json). Same shared M1,
load average 20–70 during these runs.

WebKit 26.5 with Playwright's iPad Pro 11 profile; kernel time (`run`) / longest main-thread
gap, in milliseconds:

| Request (display mesh of an exact feature) | Worker: run / main gap | In-thread: run / main gap (blocked) |
| --- | --- | --- |
| First use: load (fetch + compile 9.4 MB) + `measure exact` of a box | load 146–173, run 26 / 19–20 | load 107–145, run 23 / 36–37 (0) |
| Fillet r 2, every edge of a 20×30×10 box (4 124 triangles), cold / warm | 291 / 10; 161 / 9 | 241 / 241 (191); 143 / 143 (93) |
| Chamfer 2, top face | 35 / 10; 18 / 9 | 29 / 29; 18 / 18 |
| Shell 2, open top | 188 / 22; 27 / 9 | 30 / 30; 17 / 18 |
| Chamfer 0.5 on a plate with 48 holes (lowering of 48 cuts + chamfer + display, 7 124 triangles) | 1 104 / 10; 985 / 10 | 1 056 / 1 059 (1 009); 989 / 991 (941) |
| Fillet 0.5 of the same plate's top edges, all 48 hole rims (110 948 triangles) | 4 277 / 15 | 4 148 / 4 160 (4 110) |

Chromium 151 (desktop profile) gives the same picture: in-thread, each request over 50 ms is one
Long Task of its full length (258, 1 168, 165, 1 096 and 5 530 ms); in the worker there are none
and the longest gap is 5–14 ms.

- **Main thread: before/after the worker move.** In-thread the page cannot run for the whole
  kernel call: up to 1.1 s for the 48-hole chamfer and 4.2 s for the rim fillet in WebKit. In
  the worker the longest gap stays at 9–22 ms. The editor has run exact requests in a worker
  since 2026-11-25; these numbers are its before/after.
- **In the editor** (WebKit, production build, through the terminal): first fillet on a fresh
  page 1.17 s wall (load 390 ms, kernel 325 ms; the rest is the round trip, the commit and the
  Manifold rebuild of the display), longest main-thread gap 64 ms; warm fillet 418 ms wall, gap
  66 ms; chamfer and shell 187–211 ms wall, gaps 53–56 ms. In Chromium the editor's own main
  thread work around the same steps (rebuilding and drawing the scene with SwiftShader's software
  WebGL under load) blocked it for 0.2–1.1 s, Undo included, while the kernel took 39–52 ms in
  its worker: that is the viewport, not the exact kernel.
- **First use** costs 107–173 ms here for fetching and compiling 9.4 MB from localhost. WebKit
  compiles asynchronously, so even in-thread the main thread is blocked for at most 37 ms by it.
- **Memory.** Linear memory stays at the 64 MiB the module reserves at load for all of these,
  including the 48-rim fillet (all handles freed after each request). The Node plates go further:
  1 GiB after rounding 200 hole rims and meshing the result as one body (see below; the product's
  face-wise mesh of the same result stays at 64 MiB, see "Heavy jobs"). `performance.measureUserAgentSpecificMemory`
  does not exist in WebKit; in Chromium (cross-origin isolated) the page measured 1 MiB before
  and 142 MiB after the worker run (page and worker), 75 MiB after the in-thread run, and the
  in-thread JavaScript heap grew from 2 to 11 MiB.
- **Not measured: a physical iPad.** All of this is desktop WebKit on the M1 with the iPad
  profile (viewport, touch, user agent), not iOS. iOS compiles WebAssembly on a slower A-series
  core and kills tabs far below the 4 GiB wasm32 limit; how a real iPad copes with the heavy
  jobs below, and its cold-load time over a network, are open (recipe:
  [CRISPCAD-CONVERGENCE.md](../../docs/CRISPCAD-CONVERGENCE.md#heavy-exact-jobs-on-ipad-2026-11-26)).

### Faces with many holes (2026-11-26)

`node holes-bench.ts [10,50,200]` (raw data:
[`results/holes-darwin-arm64.json`](results/holes-darwin-arm64.json)) builds a 3 mm plate with
n holes of radius 2 mm, 6 mm apart, as one extruded profile; then optionally fillets every top
edge (r 0.5, hole rims included) or shells it (0.5 mm wall, open top, 4 mm plate). It meshes
each result for display both ways and checks both meshes closed. Process CPU time on the shared
M1 (load average 35–57; an earlier run at 70–140 measured 1.2–2.5× more CPU everywhere, with the
same ratios). The last column is the process's linear memory after the row; it only grows, so it
is the running peak of the rows before it:

| Holes | Variant | Kernel op | Display before (SMLib whole body) | Display now | Triangles before → now | WASM memory after |
| ---: | --- | ---: | ---: | ---: | --- | ---: |
| 10 | plain | 0.19 s | 0.44 s | **0.05 s** | 2 612 → 1 492 | 64 MiB |
| 50 | plain | 0.36 s | 1.09 s | **0.18 s** | 13 012 → 7 412 | 77 MiB |
| 200 | plain | 1.43 s | 9.77 s | **0.39 s** | 52 012 → 29 612 | 297 MiB |
| 10 | shell | 0.92 s | 0.25 s | **0.12 s** | 5 188 → 2 948 | 77 MiB |
| 50 | shell | 2.83 s | 1.77 s | **0.23 s** | 25 828 → 14 628 | 297 MiB |
| 200 | shell | 19.6 s | 15.81 s | **0.90 s** | 103 228 → 58 428 | 1 036 MiB |
| 10 | fillet | 0.65 s | 0.57 s | 0.79 s | 23 244 (same) | 77 MiB |
| 50 | fillet | 2.40 s | 3.50 s | 3.12 s | 115 564 (same) | 297 MiB |
| 200 | fillet | 20.6 s | 23.25 s | 14.58 s | 461 764 (same) | **1 036 MiB** |

**Cause.** SMLib's mesher is superlinear in the loops of one planar face: meshing only the top
face of the plate took 0.11 s CPU with 11 loops, 0.45 s with 26, 0.85 s with 51, 2.2 s with 101
and 6.9 s with 201, and the plate has two such faces. Every other face costs a roughly constant
amount: about 20 ms per hole wall (64 points per circle), so 200 hole walls add 4 s. The CPU
profile shows the time inside the WebAssembly, not in the JavaScript adapter, so it cannot be
fixed in this repository's code paths that call SMLib's mesher.

**Fix** (`packages/exact/src/face-mesh.ts`, used by `displayTessellation` for any body with a
planar face of 8 or more loops):

- SMLib meshes each non-planar face on its own. Per-face meshes share their edge points (the
  union of per-face meshes of the reference, fillet, chamfer and shell parts is closed), so no
  whole-body mesh is needed.
- A hole wall that is a cylinder between two full circles on planar faces becomes a band with the
  same points on both circles, as many as the chordal tolerance (0.01 mm) and the 10° angle need
  (36 for a 2 mm hole instead of SMLib's 64, which is why the counts drop).
- Planar faces are triangulated in JavaScript from exactly their neighbours' boundary points:
  ear clipping, with each hole bridged in at its rightmost vertex (rightmost hole first, so a
  bridge never crosses a hole not yet joined), and a uniform grid so an ear test only looks at
  nearby vertices. 400 holes of 32 points triangulate in well under a second.
- Safety: a polygon the clipper cannot finish (or whose triangles do not cover its area) goes
  back to SMLib for that face; a mesh that `displayMesh` finds open goes back to SMLib's
  whole-body mesh. Every row above was checked closed.

Fillets are still bounded by the kernel itself: rounding 200 hole rims takes 21 s, produces a
461 764-triangle display (the cap is 500 000) and grows linear memory to 1 GiB, which an iPad
tab will likely not survive. Meshing the fillet faces themselves (tori) stays with SMLib, so the
filleted rows gain only the planar faces' share (with 10 holes the per-face overhead makes it
slightly slower). Shelling 200 holes took 19.6 s, at the edge of the kernel's 20 s guard: under
heavier load the same shell failed with "the kernel did not finish within 20 s". Both are kernel
limits, not display ones.

### Rounded and bevelled rims (Phase 5.3, 2026-11-27)

After the fix above, the display of a fillet or chamfer of a many-hole plate was still bound by
SMLib: every rounded rim (a surface of revolution of an arc), bevelled rim (a cone) and the hole
wall below it (a cylinder no longer bounded by planar faces) was meshed by SMLib face by face, about
20–35 ms each, so 200 rounded rims cost 28 s CPU, as much as the fillet itself.

`node display-bench.ts 50,100,200 plain,fillet,chamfer,shell <label>` (one process per case, no
probe worker, shell guard off since the display is the subject; raw data:
[`results/display-before-darwin-arm64.json`](results/display-before-darwin-arm64.json) on CrispCAD
60e6d25 and [`results/display-after-darwin-arm64.json`](results/display-after-darwin-arm64.json)).
The same plate as above, its top face's edges filleted or chamfered (0.5 mm) or shelled (0.5 mm,
open top); display = `displayTessellation`, process CPU time, shared M1 at load average 20–40:

| Holes | Variant | Kernel op | Display before | Display now | Triangles before → now | Display volume error now |
| ---: | --- | ---: | ---: | ---: | --- | ---: |
| 50 | plain | — | 0.43 s | **0.35 s** | 7 412 (same) | 2.0e-3 |
| 100 | plain | — | 0.78 s | **0.76 s** | 14 812 (same) | 2.2e-3 |
| 200 | plain | — | 1.43 s | **1.13 s** | 29 612 (same) | 2.4e-3 |
| 50 | fillet | 4.3 s | 7.20 s | **1.00 s** | 115 564 → 39 964 | 1.9e-3 |
| 100 | fillet | 11.1 s | 15.52 s | **1.33 s** | 230 964 → 79 764 | 2.1e-3 |
| 200 | fillet | 36.6 s | 28.13 s | **2.04 s** | 461 764 → 159 364 | 2.3e-3 |
| 50 | chamfer | 7.2 s | 3.33 s | **0.38 s** | 19 420 → 11 020 | 2.2e-3 |
| 100 | chamfer | 13.9 s | 5.63 s | **0.77 s** | 38 820 → 22 020 | 2.4e-3 |
| 200 | chamfer | 32.2 s | 10.93 s | **1.20 s** | 77 620 → 44 020 | 2.6e-3 |
| 50 | shell | 5.5 s | 0.61 s | **0.42 s** | 14 628 (same) | -2.0e-3 |
| 100 | shell | 12.1 s | 1.17 s | **0.77 s** | 29 228 (same) | -2.1e-3 |
| 200 | shell | 33.3 s | 2.08 s | **1.25 s** | 58 428 (same) | -2.3e-3 |

(Kernel op: the "now" run; the "before" run measured the same within the load's noise. The volume
error is the display's enclosed volume against the exact one; it is the chordal tolerance's, 0.01 mm
at 10°, on 2 mm holes: SMLib's whole-body mesh used 64 points per hole where 36 meet the tolerance.)

**Fix** (`packages/exact/src/face-mesh.ts`, `revolutionMeshes`): a cylinder, cone, torus or
surface of revolution bounded by two full coaxial circles is meshed in JavaScript from its own
surface: its profile through the two circles and the face's middle is a line or, for tori and
surfaces of revolution, an arc (checked against seven points of the face, else SMLib meshes it);
rows of points around the axis at the profile's positions (two for a line, as many as the chordal
tolerance and the 10° angle need along an arc), joined by quads, oriented by the face's normal.
Faces whose circles connect (a rim and its wall) form a chain with one point count, so neighbours
share every circle point, and the planar faces around them are triangulated from those points as
before. A face is meshed here only if every face across its circles is planar or meshed here too;
a chain any of whose faces fails a check goes back to SMLib whole. The welding in `displayMesh` and
the face-wise mesher no longer builds a string key per point and edge (0.66 → 0.2 s for 40 000
triangles). What remains of the 200-rim fillet's 2 s: the eight faces along the plate's outer
edges, which SMLib still meshes (about 0.3 s), and the planar triangulation and checks.

Display is now linear in the holes and small beside the kernel operation it follows: under the
tablet limits (at most 100 rounded rims, 160 shell faces) the display of any of these jobs takes
about 1.3 s CPU on the M1. `tests/exact-face-mesh.test.ts` checks a 25-hole fillet and chamfer:
closed, triangle counts pinned, every face of revolution meshed here, volume within 5e-3 of the
exact one and of SMLib's mesh, and every point of a rounded rim on the exact rim (1e-6 mm).

### Heavy jobs: limits, memory ceiling and recycling (2026-11-26)

Question: can a heavy exact job kill an iPad tab, and how does the editor end such jobs cleanly?

**Where the time and memory go, product path.** `node limits-bench.ts` runs each case in a fresh
process (linear memory never shrinks), with `SharedArrayBuffer` hidden: the browser editor is not
cross-origin isolated, so smlibwasm has no probe worker there and runs fillet, chamfer and shell in
the exact worker's own kernel; Node would otherwise use a probe worker. Each row builds the plate
of the table above, runs the feature on its top face (r/d 0.5 mm; shell 0.5 mm, open top) and
then the display mesh as `displayTessellation` makes it (face-wise for many-hole faces). Process
CPU time on the shared M1 at load average **40–180** (heavier than the table above, so about twice
its CPU times; compare ratios, not absolutes). Raw data:
[`results/limits-darwin-arm64.json`](results/limits-darwin-arm64.json).

| Holes | Top-face edges (curved) | Fillet op + display | Chamfer op + display | Shell faces | Shell op + display | WASM memory after (max of the three) |
| ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 10 | 14 (10) | 1.4 + 2.3 s | 2.6 + 1.2 s | 16 | 1.9 + 0.2 s | 64 MiB |
| 25 | 29 (25) | 2.6 + 4.4 s | 4.8 + 2.1 s | 31 | 3.6 + 0.4 s | 64 MiB |
| 50 | 54 (50) | 5.0 + 8.1 s | 8.2 + 3.4 s | 56 | 6.1 + 0.6 s | 64 MiB |
| 100 | 104 (100) | 12.0 + 14.9 s | 16.1 + 6.0 s | 106 | 13.5 + 1.2 s | 64 MiB |
| 150 | 154 (150) | 23.2 + 22.0 s | 25.5 + 8.6 s | 156 | 23.3 + 1.5 s | 92 MiB |
| 200 | 204 (200) | 40.2 + 29.2 s | 37.2 + 10.7 s | 206 | 32.9 + 1.7 s | 111 MiB |

(Building the 200-hole plate itself: 4.2 s.)

Straight edges, `limits-bench.ts 50,100,200,400,800 fillet-poly,chamfer-poly,shell-poly`: a
gear-like sawtooth prism of n straight edges, top face filleted/chamfered at 0.2 mm, or shelled
(load average 160–320 by then; raw data
[`results/limits-darwin-arm64-poly.json`](results/limits-darwin-arm64-poly.json)):

| Straight edges | Fillet op + display | Chamfer op + display | WASM memory |
| ---: | ---: | ---: | ---: |
| 50 | 2.4 + 1.4 s | 2.8 + 1.5 s | 64 MiB |
| 100 | 4.2 + 2.2 s | 4.4 + 2.2 s | 64 MiB |
| 200 | 9.4 + 3.2 s | 10.4 + 3.5 s | 111 MiB |
| 400 | 30.8 + 5.9 s | (not finished in 10 min) | 229 MiB |

So a curved edge (hole rim) costs about 4–5 straight ones (100: 27 s against 6.4 s; 200: 69 s
against 12.6 s), which is the weight the pre-flight uses. Every **shell** of these prisms
(50–800 teeth) failed with `the kernel did not finish within 20 s` after 2.5–14 s of CPU but
29–205 s of wall time: smlibwasm's guard is wall-clock, so on a starved (or slow) device it stops
shells that would finish. The kernel stayed usable after every such stop. The editor now reports
it as "The exact kernel stopped this step at its own 20 s limit…" instead of smlibwasm's
developer hint.

Findings:

- **Memory is not what limits these jobs any more.** With the face-wise display mesh the heaviest
  row ends at 111 MiB, not 1 GiB: the 1 036 MiB in the table above was SMLib's *whole-body* mesh
  of the result (the "before" column), which the product now uses only as a fallback when the
  face-wise mesh fails. That fallback, and jobs not measured here, are what the memory ceiling is
  for.
- **Time is.** A 200-rim fillet is about 74 s CPU end to end here (roughly 35 s unloaded), past
  the editor's 60 s budget on a slower device. Cost grows faster than linearly in the edges
  (fillet op: 12 s for 100 rims, 40 s for 200).
- **The shell guard is wall-clock and covers only part of the shell.** The 200-hole shell did not
  hit it (33 s op, the offset step itself was quick); the sawtooth shells below did, at 2.5 s CPU.
  Until kernel 0.1.6 `setGuardSeconds` was not exported, so CrispCAD could not change it; it now
  loads the kernel with `guardSeconds` at half the request budget, but in an ordinary Web Worker
  the guard is checked only inside long intersection loops, so the request budget ends the job.
- **Fillet and chamfer have no kernel deadline at all** on natively built bodies
  (`round_edges` runs in-thread): only terminating the worker stops them.

**The memory ceiling works.** (Measured with CrispCAD's byte rewrite of the module's memory
maximum; since kernel 0.1.6 the kernel's own `maxMemoryBytes` holds the ceiling at
instantiation, and `tests/exact-memory-cap.test.ts` checks the same behaviour with it.)
`cap-probe.ts` loads the kernel with a 96 MiB ceiling and asks SMLib
for the whole-body mesh of the 200-hole plate (297 MiB uncapped): after 5.8 s it fails with
`ExactKernelError(kernel-failure): SMLib mesh failed: tessellate failed (SM_ERR_OUT_OF_MEMORY)
… (std::bad_alloc)`, memory stays at 92 MiB, and the same kernel then fillets a box correctly.
SMLib's bindings catch `bad_alloc`, so exhaustion is a clean error, not an abort. The editor still
ends that worker (a precaution after `bad_alloc`, and the memory goes back to the page).
`tests/exact-memory-cap.test.ts` keeps this as a test.

**In the browser** (`EXACT_BENCH=1 npx playwright test tests/browser/exact-kernel-bench.spec.ts
--project ipad -g heavy`: the editor on `exact-check.html`, where the plate is CAD Script, a box
minus 200 cylinders, as a user would build it; raw data
[`results/browser-guards-ipad.json`](results/browser-guards-ipad.json), load average 90–150,
Google Chrome with the iPad profile because the shared Playwright Chromium was missing that day):
tablet limits refused the 200-hole fillet and shell in 13.4 and 11.0 s wall (kernel load and
lowering); accepted a 25-hole fillet (run 6.2 s, 64 MiB) and a 100-hole shell (26.7 s, 92 MiB).
Without limits the 200-hole fillet ran 90.7 s (111 MiB) and the 200-hole shell gave no answer in
15 minutes. In Node the same CAD Script plate's shell was stopped by the kernel's 20 s guard after
40 s wall, so in the browser that guard did not take; the editor's request budget (60 s tablet,
120 s desktop) is what ends such a job. The memory ceiling in the browser: the 100-hole shell under
a 70 MiB ceiling failed with "ran out of memory" after 19.7 s, its worker was ended, and the next
`measure exact` started a fresh one (load 202 ms, 64 MiB).

How the guards work, and the thresholds: see
[CRISPCAD-CONVERGENCE.md](../../docs/CRISPCAD-CONVERGENCE.md#heavy-exact-jobs-on-ipad-2026-11-26).

## STEP import (2026-11-27)

`step-import-bench.ts` runs the product path of **Import STEP as exact bodies** in Node
(`runStepImport` → `@brickwright/cad-exact` `importStep`: the strict read of exact kernel 0.1.8,
each body's B-rep re-written as STEP and read back for the check, its display tessellation), then a
warm `measure exact` of the imported document. Shared Apple M1 at load average 150–260, so wall
times are many times the CPU times; compare CPU ([`results/step-import-darwin-arm64.json`](results/step-import-darwin-arm64.json)):

| File (source) | KiB | Bodies | Import CPU (wall) | Stored B-rep | Display | Document |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| box (our export) | 5 | 1 | 0.15 s (1.3 s) | 5 KiB | 12 triangles | 7 KiB |
| filleted box (our export) | 24 | 1 | 1.6 s (16 s) | 26 KiB | 4,604 | 151 KiB |
| plate with 12 holes (our export) | 20 | 1 | 0.9 s (7.6 s) | 19 KiB | 1,932 | 62 KiB |
| Adafruit 830 battery holder (MIT) | 217 | 2 | 2.1 s (16 s) | 143 KiB | 2,276 | 197 KiB |
| Adafruit 711 DC toy motor (MIT) | 85 | 2 | 2.4 s (37 s) | 64 KiB | 9,808 | 321 KiB |
| Adafruit 3777 TT motor (MIT) | 110 | 8 | 3.0 s (35 s) | 90 KiB | 12,006 | 404 KiB |
| Adafruit 4884 Feather RP2040 (MIT) | 2,386 | 58 | 44 s (915 s) | 2,992 KiB | 68,994 | 4,864 KiB |

So import costs roughly 1–3 s CPU per 100 KiB of STEP here (reading, the stored B-rep's read-back
check and the display mesh). The tablet limit (4 MiB files) refuses only very large files up front;
the request budget (60 s tablet, 120 s desktop) is what stops an import a device cannot finish (the
Feather board would be stopped on a tablet, with "the model was not changed"). A first run refused
the Feather board: one pin header's re-written STEP read back with an area 4.9e-9 off (volume
2e-12, box identical), over the 1e-9 check then in place; the check is 1e-7 now.

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
- Browser/WebKit: measured in Chromium and iPad-emulated WebKit through the product path,
  including fillet, chamfer and shell and the main thread (see above); not on a physical iPad.
- Only SMLib. WASMLib and Solidcore are not implemented against `ExactKernel` here (the fork's
  `experiments/kernel-qualification` has WASMLib scorecard numbers).

## What product entry would need

Status 2026-11-25: items 1 (notices), 2 (browser measurements, except a physical iPad), 3 (worker
integration) and 4 (cancellation) are done for `export step` and `measure exact`; item 5 is done
for STEP and measures (display and collision stay on Manifold meshes); item 6 is open. Still open
from item 1: a reproducible or self-built WASM. Status 2026-11-26: item 2 extended to exact
fillet, chamfer and shell, memory and main-thread blocking (browser bench above; still no physical
iPad); item 3 covers every exact request (`feature-display` included) through one shared
`runExactRequest`, with an optional in-thread fallback for hosts without workers.

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
