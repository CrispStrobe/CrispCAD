# CrispCAD convergence roadmap

Started 2026-11-24. This plan brings together two lines of work:

1. **One command layer** in this repository. The terminal, the code workspace and
   replayable session commands landed in PR #78
   (see [TERMINAL-WORKSPACE.md](TERMINAL-WORKSPACE.md)).
2. **An exact kernel without OpenCASCADE.** The CrispCAD kernel lab
   ([`CrispStrobe/crispcad-kernel-lab`](https://github.com/CrispStrobe/crispcad-kernel-lab),
   a fork of kernelCAD-web; renamed from `kernelCAD-web` on 2026-11-24) built a native SMLib kernel
   (`smlib-native`, via `@classcad/smlibwasm`). It builds 2,344 of 2,402 catalog
   models with OpenCASCADE blocked (see its `docs/kernels.md`).

The product is **CrispCAD**: this repository, renamed from Brickwright CAD on
2026-11-24. The kernelCAD fork stays a separate MIT repository, used as the
**kernel lab** where kernel coverage is measured against its 2,402-model
catalog. CrispCAD consumes its kernel package, not its application. This keeps the
decision in [KERNELCAD-REVIEW.md](KERNELCAD-REVIEW.md#fork-recommendation-defer)
and step 4 of [PARAMETRIC-CAD-STRATEGY.md](PARAMETRIC-CAD-STRATEGY.md#delivery-order-and-acceptance).

## Dependency chain

```
crispcad-kernel-lab ──(exact-kernel package, MIT + Apache-2.0 only)──▶ CrispCAD
CrispCAD ──(packaged CAD SDK, @brickwright/cad-*)──▶ BrickWright (`CrispStrobe/brickwright`, formerly brickwright-lite)
```

- **The lab owns the exact kernel.** The OpenCASCADE-free SMLib kernel and its
  `ExactKernel` interface live in the lab as a standalone package. The lab qualifies
  it against its catalog and its own OpenCASCADE reference path. The package's
  dependency closure is only `@classcad/smlibwasm`, prebundled with the OFL Lato
  font aliased to an empty module, so every shipped file is MIT or Apache-2.0.
  A licence test in the lab enforces this.
- **CrispCAD pins a released build.** It depends on a release tarball attached to
  a tagged lab release, pinned by version and lockfile integrity. It never
  depends on the lab's application or on `replicad-opencascadejs`.
- **BrickWright consumes CrispCAD's SDK as before**
  (`npm run build:brickwright-sdk`, `scripts/sync-cad-sdk.mjs`; see
  [INTEGRATION.md](INTEGRATION.md#keeping-standalone-and-brickwright-synchronized)).
  The exact kernel reaches BrickWright only through CrispCAD, once CrispCAD ships it.

## Architecture

```
        terminal · code workspace · command palette · MCP · CLI
                              │
                 one command registry (packages/core)
           canonical records at the session commit boundary
                              │
          ┌───────────────────┴────────────────────┐
   Manifold (default)                   SMLib exact backend (optional)
   mesh solids: display, physics,       B-rep: STEP export, exact fillet,
   printing, interference               chamfer, shell, analytic measures
```

- **Manifold stays the default.** The exact backend is opt-in, and each feature
  enters the product only after passing its acceptance gate.
- **No silent fallback.** A feature the exact backend cannot build gives an
  explicit "unsupported" diagnostic. Both codebases already follow this rule.
- **Replay depends on the kernel.** A recorded command that relied on exact
  geometry stores the kernel that built it. Replay rejects the command if the
  kernel changed, using the same precondition checks that #78 introduced.

## Phases

### Phase 0: land the terminal, clean up branches. **Done 2026-11-24**

- Merged #78 (`ba5ca67`) after qualifying it in browsers: all 20 browser cases
  pass in Chromium and iPad WebKit. Two test-only fixes made the specs work
  regardless of layout.
- Closed #79 as superseded. Its unique design notes are in
  [TERMINAL-WORKSPACE.md](TERMINAL-WORKSPACE.md#design-notes-from-pr-79).
- Deleted the merged or superseded branches. Their commits are kept as tags:
  `archive/cad-command-terminal`, `archive/atlas-forklift-20261116`,
  `archive/cad-sim-optimization-20261116`.
- Renamed the product to CrispCAD. Identifiers that existing data depends on
  were deliberately kept (see the README).
- Repository made public after secret scans of the full history (gitleaks,
  trufflehog and pattern greps; every hit was a false positive) and a review of
  library and vendored licences.
- Still open: 18 unit tests were already failing on `main` before #78. They are
  tolerance misses (about 8.7e-9 against a 5e-9 limit) and timeouts in heavy
  rover, physics and library tests. #78 adds no failures.

### Phase 1: finish the kernel in the lab. **Done 2026-11-25**

Results, on lab branch `ccr-f42f1bfe-3ekdio` (head `c4bea5b93`):

- **Catalog coverage:** **2,391/2,402 (99.5%)** build natively with
  OpenCASCADE blocked, up from 2,344. The reproducible harness is
  `experiments/kernel-qualification/catalogCoverage.ts`. 11 models still fail:
  - 3 sweeps along curved rails;
  - 2 holes on side faces;
  - 1 sketch with several loops;
  - 1 loft with sections off the XY plane;
  - 4 SMLib extrude errors.

  **Update, lab release `exact-kernel-v0.1.1` (2026-11-25): 2,402/2,402.** All 11 build
  now (side-face holes, multi-loop sketches, YZ/XZ and apex lofts, helical sweeps,
  self-touching outlines). The harness also writes per-model volume, area and exact box
  (`experiments/kernel-qualification/results-catalog-native-volumes.json` in the lab) in
  the cross-check's `--native` format. Still refused natively, with an explicit error:
  `'smooth'` sweeps, smooth lofts to a point, rotated loft sections, twisted or tapered
  extrusions, countersinks.
- **Native mates:** these work, reusing the solver, which does not depend on the
  kernel. On all 35 mated catalog models (594 parts), placements are identical
  to OpenCASCADE's and volumes agree to within 8.7e-6. Still needing
  OpenCASCADE:
  - connectors placed by face or edge queries;
  - `solvedModel(poses)` assemblies.

  No catalog model uses either.
- **Upstream `develop`:** merged (31 commits).
- **Test suite:** typecheck, lint, ratchets and the licence audit pass. The fork
  introduced two regressions, both now fixed. A clean full-suite count was
  impossible on the shared machine (load average 130–320). Failures were
  compared file by file against upstream instead, and the remaining
  differences are timeouts and environment problems.

Original scope:


Done in the kernel lab, on branch `ccr-f42f1bfe-3ekdio`:

1. Run the full test suite on the branch and compare it with upstream's
   baseline (10,276 pass, 34 fail).
2. Re-measure native catalog coverage now that negative box dimensions are
   accepted.
3. Merge upstream `develop`, which is 24 commits ahead (merge, never rebase).
4. Native mates: 34 of the 58 failing models use them.

Exit criterion: the suite has no new failures against the upstream baseline,
and the coverage numbers in `docs/kernels.md` are measured.

### Phase 2: exact backend experiment in CrispCAD. **Qualified in Node 2026-11-24; in the product (opt-in) 2026-11-25**

Results (details in [experiments/exact-kernel/README.md](../experiments/exact-kernel/README.md)):

- **Reference parts:** 27/27 within 1e-6. Worst relative errors are 1.4e-15 on
  volume and 1.2e-11 on area; bounding boxes are within 3.2e-13 mm.
- **Fillet, chamfer and shell:** within 1e-8 of the closed forms.
- **STEP read back by SMLib:** 27/27 exact.
- **STEP read back by our own `step-tessellator.wasm` importer:**
  - 26/27 parts. Flat-faced parts come back identical; curved parts are within
    6.4e-3 on volume.
  - It cannot mesh a full torus. That is an importer gap: SMLib reads the same
    file exactly.
- **Malformed input:** rejected before the kernel runs. Failures inside the
  kernel come back as clean errors.
- **Speed and memory (Node):**
  - build: 0.85 s CPU for all 27 parts;
  - mesh: 2.2 s CPU for all 27 parts;
  - WASM memory peaks at 92 MiB.
  - Meshing a face with many holes grows roughly with the square of the hole
    count: 3.8 s for a plate with 48 holes (display meshes avoid it since 2026-11-26, see below).
- **Not supported yet** (each raises an explicit error):
  - minkowski, text, twisted or tapered extrusion;
  - most hulls;
  - circles with fewer than 16 segments;
  - large tessellated constructors.

Remaining work for this phase:

- ~~product entry (iPad WebKit measurements, the geometry worker, cancellation)~~:
  **done 2026-11-25**, see [Phase 3](#phase-3-one-command-vocabulary) steps 1–2;
- the importer's torus gap;
- ~~faster meshing of faces with many holes~~: **done 2026-11-26**. Exact features' display
  meshes are the exact kernel's tessellation, so it mattered after all. SMLib's mesher is
  superlinear in the loops of one planar face (0.85 s CPU for one face with 51 loops, 6.9 s with
  201). A body with a planar face of 8 or more loops is now meshed face by face
  (`packages/exact/src/face-mesh.ts`): SMLib meshes the curved faces one by one, plain hole walls
  become bands, and planar faces are triangulated in JavaScript from the same boundary points,
  with a fallback to SMLib if anything does not close. Display of a plate with 200 holes: 0.39 s
  CPU instead of 9.8 s; shelled, 0.90 s instead of 15.8 s; with 50 holes, shelled, 0.23 s instead
  of 1.8 s. Filleted hole rims stay bound by the kernel: rounding 200 of them takes 21 s and grows
  linear memory to 1 GiB (display 14.6 s instead of 23.3 s). Details
  and the full table: [experiments/exact-kernel](../experiments/exact-kernel/README.md#faces-with-many-holes-2026-11-26);
- iPad WebKit measurements for fillet, chamfer, shell, memory and the main thread: **done
  2026-11-26 on Playwright WebKit (iPad Pro 11 profile); a physical iPad is still unmeasured.**
  WebKit 26.5 on a shared Apple M1:
  - first use (fetch and compile 9.4 MB, then `measure exact` of a box): load 146–173 ms in the
    worker; in the editor, the first fillet took 1.17 s wall (load 390 ms, kernel 325 ms);
  - kernel time per display mesh, cold / warm: fillet r 2 of a 20×30×10 box 291 / 161 ms,
    chamfer 35 / 18 ms, shell 188 / 27 ms; chamfer on a plate with 48 holes 1.1 / 1.0 s; fillet
    of that plate's 48 hole rims 4.3 s (110 948 triangles);
  - memory: linear memory stays at its 64 MiB reservation for all of these;
    `measureUserAgentSpecificMemory` does not exist in WebKit (Chromium, cross-origin isolated:
    142 MiB for page and worker after the run);
  - main thread: with the kernel in the worker, the longest main-thread gap during any request is
    9–22 ms (in the editor 53–66 ms, including the scene update). The same requests on the main
    thread block it for their whole duration: 241 ms for the fillet, 1.06 s for the 48-hole
    chamfer, 4.2 s for the rim fillet (Chromium reports each as one Long Task of that length).
  Raw data and method: [experiments/exact-kernel](../experiments/exact-kernel/README.md#browser-features-memory-and-the-main-thread-2026-11-26).
  Not measured: iOS's slower WebAssembly compile, its per-tab memory limit and cold load over a
  real network (the 1 GiB rim-fillet case above turned out to be SMLib's whole-body mesh, which
  the product no longer uses for it; see the next item);
- heavy jobs on iPad (limits, memory ceiling, recycling, Cancel): **done 2026-11-26**, see
  [Heavy exact jobs on iPad](#heavy-exact-jobs-on-ipad-2026-11-26) below;
- the geometry worker for every exact request: **done** (2026-11-25, extended 2026-11-26). Feature
  recompute, STEP export and exact measures all run in the lazily created exact worker through
  one `runExactRequest` (shared with the MCP exact thread). Hosts that cannot start a worker can
  pass `exactFallback` (for example `createInThreadExactHost()`), which runs on the calling thread
  with the blocking measured above.

#### Heavy exact jobs on iPad (2026-11-26)

Goal: a heavy exact job either finishes within sane limits or is refused or stopped with a clear,
translated message; the editor never crashes and the model and its history are never harmed.
Measurements: [experiments/exact-kernel](../experiments/exact-kernel/README.md#heavy-jobs-limits-memory-ceiling-and-recycling-2026-11-26).

What the measurements changed:

- **Memory is no longer the problem for the measured jobs.** On the product path (face-wise
  display mesh; in the browser editor smlibwasm has no probe worker, because the page is not
  cross-origin isolated) the 200-hole rim fillet, chamfer and shell end at 64–111 MiB of
  WebAssembly memory. The 1 GiB measured earlier was SMLib's whole-body mesh of the result, which
  the product uses only as a fallback.
- **Time is.** The 200-hole rim fillet takes about 74 s CPU end to end on the loaded M1 (roughly
  35 s unloaded), the shell about 39 s; both grow faster than linearly. Fillet and chamfer of
  natively built bodies have no kernel deadline at all, and the kernel's 20 s guard (`shell`
  only, and only part of it) cannot be changed from CrispCAD: `setGuardSeconds` is not exported
  by `@crispcad/exact-kernel`. The editor's own budget is what ends a slow job.
- **A straight edge costs about a quarter of a curved one** (fillet and display of 100 straight
  edges 6.4 s CPU, of 100 hole rims 27 s; 400 straight edges 37 s).
- **The kernel's shell guard is wall-clock.** Under heavy load, shells of a 50-tooth prism failed
  with "did not finish within 20 s" after 2.5 s of CPU; the kernel stayed usable. On a slow iPad
  the same can happen to shells that would finish; the editor now says so in a translated message
  ("stopped this step at its own 20 s limit… The model was not changed").

Design (`packages/exact/src/limits.ts`, `feature-cost.ts`, `memory-cap.ts`;
`packages/editor/src/geometry-client.ts`, `geometry.worker.ts`, `exact-activity.ts`):

1. **Pre-flight.** Before the kernel runs a fillet, chamfer or shell (also when STEP export or a
   measure rebuilds one), the source solid's selected edges are counted, a curved edge as four
   straight ones, or for shell its faces. Over the host's limit the job is refused with a
   translated message that names the counts and the limit; the kernel never starts.
2. **Memory ceiling.** The exact worker loads the kernel with its WebAssembly memory maximum
   lowered in the module bytes (smlibwasm defines its own memory, 64 MiB, growable to 4 GiB; the
   maximum is one LEB128 number, rewritten in place while the kernel is instantiated). Past the
   ceiling SMLib reports `SM_ERR_OUT_OF_MEMORY` cleanly (`bad_alloc` is caught, measured), and the
   editor says the kernel ran out of memory for this job.
3. **Recycling.** After a job that left the kernel's memory above `recycleAboveBytes`, and after
   any memory exhaustion or WebAssembly trap, the client ends the exact worker (its memory goes
   back to the page) and starts a new one lazily on the next request; requests queued behind a
   broken kernel are rerun in the new worker.
4. **Time.** The request budget comes from the limits (60 s tablet, 120 s desktop); then the
   worker is terminated, since the kernel cannot be interrupted mid-call, and the message says
   the model was not changed.
5. **UI.** The status bar shows the running exact job, its elapsed seconds and a Cancel button
   for every exact request (terminal, recompute, measure, STEP export); the Fillet, chamfer, shell
   dialog, which is modal, has its own Cancel and elapsed time. Cancel terminates the exact
   worker. That is safe: exact output is committed only after the kernel answered and the model's
   revision is unchanged, so a cancelled, refused, failed or timed-out job leaves the model and its
   history as they were. An exact feature whose recompute did not finish stays stale, and the
   viewport keeps showing the previous geometry with the stale message.

Thresholds (`EXACT_LIMITS_TABLET` is the default for every host that passes nothing; the
standalone app uses `EXACT_LIMITS_DESKTOP` in the macOS app and on computers without touch):

| Limit | Tablet | Desktop | Evidence |
| --- | ---: | ---: | --- |
| Fillet/chamfer edges (curved × 4) | 400 (≈ 100 hole rims) | 1000 | 100 rims: 27 s CPU loaded, ≈ 14 s unloaded, fillet and display. 200 rims (804) refused on tablet. A box filleted on every edge is 12, a plate with 25 holes 104. |
| Shell faces | 160 | 500 | 156 faces: 25 s CPU loaded; 206 faces (200 holes) refused on tablet. |
| Memory ceiling | 512 MiB | 2 GiB | Heaviest measured product job 111 MiB; iPad tabs die at roughly 1–1.5 GB for the whole page. |
| Recycle above | 192 MiB | 512 MiB | Normal jobs stay at the 64 MiB starting memory, so they never recycle. |
| Request budget | 60 s | 120 s | Includes the first load (0.1–0.4 s measured). |

Before and after, the 200-hole plate. Node: product path, loaded M1. Browser: the editor on the
exact-check page in Chromium with the iPad profile, load average 90–150
([`results/browser-guards-ipad.json`](../experiments/exact-kernel/results/browser-guards-ipad.json)):

| Job | Before (no limits) | After, tablet limits |
| --- | --- | --- |
| Rim fillet | Node 74 s CPU; browser: kernel run 90.7 s, 111 MiB, 461 764-triangle display (with SMLib's whole-body mesh it reached 1 GiB in Node) | refused before the kernel runs: "Rounding 204 edges (200 of them curved)…"; 13.4 s wall in the browser, almost all of it loading the kernel and lowering the 200 cylinders; longest main-thread gap 236 ms |
| Shell, open top | Node, extruded plate: 35 s; Node, the same plate from CAD Script: stopped by the kernel's 20 s guard after 40 s wall; browser: no answer within 15 min (nothing stopped it with `exact-limits=none`) | refused: "Shelling a body with 206 faces…", 11.0 s wall |
| Any job needing more memory than the ceiling | grows until the job ends (or the tab dies) | fails with "ran out of memory", worker ended, model unchanged. Browser: the 100-hole shell (92 MiB unlimited) under a 70 MiB ceiling failed so after 19.7 s, the exact worker was gone, and the next `measure exact` ran in a fresh one (load 202 ms, 64 MiB) |

Accepted on tablet, in the browser: a 25-hole rim fillet (run 6.2 s, 64 MiB) and a 100-hole shell
(run 26.7 s, 92 MiB) built normally. The longest main-thread gaps there (5.8–7.2 s) are the
viewport rebuilding the result with software WebGL on the loaded machine, not the kernel, which
runs in its worker. The unanswered browser shell is why the request budget matters: in the browser
the kernel's own guard did not end it, and only terminating the worker does.

**A physical iPad is still unmeasured.** Every number here is from an Apple M1 (Node, Chromium
with the iPad profile, and the WebKit figures above). Recipe for the owner, on a real iPad:

1. On the Mac: `npm ci && npm run build && npx vite preview --host 0.0.0.0 --port 4317`, and note
   the Mac's LAN address (System Settings › Wi-Fi › Details). Mac and iPad on the same network.
2. On the iPad, in Safari: `http://<mac-address>:4317/exact-check.html?holes=200`. The page
   mounts the editor on a 200-hole plate in memory only (nothing is saved; the stored project is
   untouched) and shows the limits in force and a heartbeat with the longest main-thread stall.
3. With the default (tablet) limits, run the listed terminal commands (`fillet 0.5 Plate --face +z`,
   `shell 0.5 Plate --open +z`). Expected: both refused within seconds.
4. Then `…/exact-check.html?holes=100` (accepted on tablet): run the fillet and note the terminal's
   `run … ms · WASM memory … MiB` line and the wall time.
5. Then `…/exact-check.html?holes=200&exact-limits=none`: run the fillet, then reload and run the
   shell. Note the times and memory, whether the tab survived (a reload or "A problem repeatedly
   occurred" means Safari killed it), and the longest stall. Use the status bar's Cancel once to
   check that the editor stays usable.
6. Optional: `&memory-mib=80` with `chamfer 0.5 Plate --face +z` on 200 holes shows the memory
   ceiling ending a job ("ran out of memory").

The same page runs in the Chromium `ipad` project: `EXACT_BENCH=1 npx playwright test
tests/browser/exact-kernel-bench.spec.ts --project ipad -g heavy`.

Original scope of the phase:

Lives in `experiments/exact-kernel/` with its own `package.json`. It is not a
runtime dependency.

- A narrow `ExactKernel` interface:
  - primitives, profile extrude and revolve;
  - booleans and transforms;
  - fillet, chamfer and shell;
  - volume, area and bounding box;
  - tessellation and STEP export.
- An SMLib implementation that reuses the lab's `nativeLowerer.ts` logic, with
  its MIT headers kept.
- A lowering from our own CAD Script feature output for the subset that maps
  cleanly. Everything else is an explicit "unsupported" error.
- Acceptance gate:
  - the 27 reference parts at 1e-6 relative error;
  - STEP export reopened with our own `tools/step-wasm` importer, with volume
    and bounding box compared;
  - malformed input rejected cleanly;
  - Node timing and WASM memory measured.

Product entry additionally needs:

- iPad WebKit memory and latency measurements;
- running in the geometry worker;
- consuming the kernel as the lab's package instead of the experiment's copy
  (Phase 2b, done 2026-11-25).

### Phase 2b: move the exact kernel into the lab as a package. **Done 2026-11-25**

Release: [`exact-kernel-v0.1.4`](https://github.com/CrispStrobe/crispcad-kernel-lab/releases/tag/exact-kernel-v0.1.4)
of the kernel lab, tarball `crispcad-exact-kernel-0.1.4.tgz`, SHA-256
`ee3f53510c6c406137b79417769547aed0877240c653eed925ca8c3efa578b6e`.

0.1.4 replaced 0.1.3 (SHA-256 `f9cfc354…3b8f`) on 2026-11-26. `profile.path` lofts now keep
each section's outline as authored; SMLib's face construction had re-picked the start vertex
of outlines with collinear points, so a ruled loft joined the wrong vertices (an 8-point square
lofted to an octagon came out at 113.4e6 instead of 224.1e6 mm³). CrispCAD's own lowering
passes sections to `k.loft` directly and was not affected; the lab's native build had the same
bug (catalog `hill-tile`, `ground-tile`) and is fixed in the same lab change. The lab also
documents a byte-identical rebuild of the bundled smlibwasm from source
(`packages/exact-kernel/BUILD-WASM.md`); the release still ships the npm binary.

0.1.3 replaced 0.1.2 (SHA-256 `f025cd79…3823`) on 2026-11-26. `profile.polygon` and
`profile.path` now refuse self-crossing outlines (bow ties, pentagrams) with `invalid-input`;
0.1.2 built them as solids with signed, partly negative volume. CAD Script refuses
self-crossing loft sections and `extrude` outlines itself; a self-crossing profile that reaches
the exact lowering another way now fails there with `invalid-input` instead of building a
wrong solid. Recorded commands carry kernel 0.1.3;
0.1.2 recordings replay as stale, as designed.

0.1.2 replaced 0.1.1 (SHA-256 `a4852c58…08a7`) on 2026-11-25. It fixes the 0.1.1 bounding
box's speed on trimmed curved bodies, with identical boxes (largest difference 1.8e-12 mm on
243 catalog models): 0.1.1 sampled B-spline edges with SMLib's `Edge.pointAt`, which
recomputes the arc length on every call (0.2–0.4 s per point); 0.1.2 evaluates the edge's
own NURBS in JavaScript. The catalog's slowest boxes went from 38–576 s to 9–24 ms.

0.1.1 replaced 0.1.0 (SHA-256 `1de74c8d…0027`) on 2026-11-25. It fixes three things the
cross-check found: SMLib's own bounding box misses interior extremes of rotated curved
solids (the package now measures the box from surface points); the exact convex hull kept
near-coplanar faces, which inflated loft areas (a hexagonal frustum by 73 %) and made long
multi-section lofts fail to stitch; and the hull limit rises from 64 to 1,024 points.
Commands recorded with 0.1.0 are refused on replay as stale, by design; saved exact
features keep their display and recompute only when their model changes. An upstream
report for the bounding-box and `xor` orientation bugs is drafted, not sent, in the lab's
`docs/smlibwasm-upstream-report.md`.

- **Package:** `@crispcad/exact-kernel` in the lab's
  [`packages/exact-kernel`](https://github.com/CrispStrobe/crispcad-kernel-lab/tree/ccr-f42f1bfe-3ekdio/packages/exact-kernel)
  (MIT). It holds the experiment's `ExactKernel` interface, SMLib implementation and exact
  convex hull, relicensed MIT, plus what the lab's native SMLib backend uses: path
  profiles, loft, sweep, split, components, mass properties, vertex normals and STL.
- **Licence closure: MIT + Apache-2.0.** `@classcad/smlibwasm` 0.6.2 is prebundled
  (esbuild) with its font module aliased to an empty one. The tarball has no runtime
  dependencies; 23 files, 10.7 MiB. The lab's licence test packs and unpacks it and
  fails on any file that is not MIT or Apache-2.0.
- **Qualification in the lab, on the built bundle:**
  - the 27 reference parts at 1e-6 (worst relative volume error 2.5e-15, area 1.2e-11);
  - exact STEP round trips;
  - fillet, chamfer and shell against closed forms;
  - `Text()` fails cleanly without a font.
- **Here:** [`experiments/exact-kernel`](../experiments/exact-kernel/README.md) depends on the
  release tarball, pinned by URL and lockfile integrity. The copied interface and
  implementation are deleted. The CAD Script lowering stays here. All 99 experiment
  tests pass with unchanged results: 27/27 reference parts, STEP round trip with the
  known torus importer gap, malformed input, and licence.
- **Lab rename:** the lab's product text is "CrispCAD kernel lab", and its CLI is
  `crispcad-lab`. `crispcad` remains as a deprecated alias, so it no longer collides
  with this repository's CLI.

Next: product entry, as Phase 3 steps 1 and 2. **Done 2026-11-25** (branch
`feat/exact-kernel-product`); exact `fillet`/`chamfer`/`shell`, which needed a document-model
change, followed on branch `feat/exact-features-v41` (see
[exact features](#exact-features-document-version-41-done-2026-11-25)):

- the geometry worker: a second, lazily created instance of the same worker script loads the
  kernel on the first exact request (the kernel's own `new URL('smlibwasm.wasm')` is resolved
  by Vite; compiled-module reuse across worker restarts is not needed while the exact worker
  lives until cancelled);
- iPad WebKit (Playwright) and Chromium measurements; a physical iPad was not available (extended
  2026-11-26 to fillet, chamfer, shell, memory and main-thread blocking, see "Remaining work" above);
- cancellation: `AbortSignal`, `cancelExact()` and a 60 s budget terminate only the exact worker;
- `export step` and `measure exact` route to the exact kernel.

The lab's own `smlib-native` backend does not use the package yet.

### Phase 3: one command vocabulary

1. Commands such as `fillet`, `shell` and `export step` check whether the exact
   backend can handle the request and route to it. Otherwise they fail with a
   clear diagnostic. **`export step` and `measure exact` done 2026-11-25**
   (branch `feat/exact-kernel-product`):
   - `packages/exact` (`@brickwright/cad-exact`) depends on the lab release tarball, pinned by
     URL and lockfile integrity. It is a separate package so that the 10.7 MiB dependency stays
     out of `@brickwright/cad-geometry` (and so out of every SDK consumer that never asks for
     it), and so the lazy boundary is one dynamic `import()`. It holds the CAD Script lowering
     (moved from `experiments/exact-kernel`, whose 99 tests now run against it) and a document
     lowering: boxes, cylinders, spheres, sketch extrusions and revolutions on every plane
     (exact arcs, circles and region holes), mirror, linear and circular patterns, Booleans
     with hole roles, and code objects. Imported meshes, minkowski, text and the other
     CAD Script gaps fail with `ExactLoweringError`, whose diagnostic names the body, the node
     and its feature kind. All lowered features agree with Manifold within faceting
     (`tests/exact-backend.test.ts`).
   - Loading: the editor's geometry client runs exact requests in a second worker instance that
     imports the exact chunk on demand. Vite emits that chunk, its probe workers and
     `smlibwasm.wasm` under `assets/exact/`; the service worker leaves them out of the eager
     precache and caches them on first use in a versioned cache (`bw-cad-exact-*`). Users who
     never run an exact command never download it (checked in Playwright).
   - Registry: `export [step [targets]]` and `measure exact [targets]` (`kernel: 'exact'`).
     Core parses and formats; hosts supply an `ExactCommandHost` and use
     `runAsync`/`runScriptAsync`. Terminal, export dialog (**STEP · exact B-rep**), MCP
     (`cad_export_step`, `cad_measure_exact`, `cad_run_commands`) and CLI (`step`, `measure`,
     `run … --out`). One STEP file holds one solid per body; touching bodies are refused rather
     than merged. No Manifold mesh is ever written as STEP.
   - Licences: THIRD-PARTY-NOTICES.md, `packages/exact/NOTICE.md`, the editor NOTICE, the
     offline `cad-assets/notices.txt` (the kernel's NOTICE, LICENSE and bundled licence texts)
     and the About dialog list the kernel and its MIT + Apache-2.0 closure.
   - Exact `fillet`, `chamfer` and `shell`: **done 2026-11-25** (branch
     `feat/exact-features-v41`), see
     [exact features](#exact-features-document-version-41-done-2026-11-25).
2. Recorded commands carry the kernel that built them. Replay rejects a kernel
   change. **Done 2026-11-25** (mechanism): `apply` records may carry
   `context.kernel = {id, package, version}`; edits made in `session.withKernel(kernel, …)`
   record it; sessions declare the kernels their host provides
   (`createCadSession(doc, {kernels})`; the editor and MCP host declare
   `@brickwright/cad-exact/identity`, which loads no WebAssembly). Replay refuses a missing
   kernel or another package version with a clear message, and re-records a replayed edit with
   its kernel. Old records have no kernel and replay unchanged. `export step` and
   `measure exact` only read the model; their results carry the kernel identity instead. The
   producers are the exact features below (`fillet`, `chamfer`, `shell`, `recompute exact`).
3. One registry in `packages/core`, used by four front ends: the terminal, the
   MCP server (`cad_inspect`, `cad_check_interference`, `cad_render`,
   `cad_check_printability`), a headless CLI, and the command palette. The lab's
   CLI verbs (`evaluate`, `export`, `dfm`, `interference`) are the reference for
   the CLI. **Done 2026-11-24** (branch `feat/command-registry`):
   - `packages/core/src/command-registry.ts`: names, aliases, i18n descriptions,
     typed arguments, `editsModel`, `headless`, palette label/availability;
     shared prompts and executors (`prepareCommand`) and a headless runner
     (`createCommandRunner`). The coordinate parser moved to
     `command-arguments.ts`.
   - Terminal: execution, help and completion come from the registry, with no
     change in behaviour, aliases or Undo.
   - Command palette: labels, order, keywords and availability come from it.
   - MCP: `cad_list_commands` and `cad_run_commands` (a script commits as one
     validated history step).
   - CLI: `apps/cli/crispcad.mjs` with `commands`, `run`, `inspect`,
     `interference`, `printability`, on top of the MCP host.
   - View/camera commands stay editor-side but are described in the registry.
   - Terminal scripts and palette aliases: **done 2026-11-25** (branch
     `feat/terminal-scripts-journal`). Pasted multi-line input runs through the
     headless runner on a trial session (`runCommandScript`, the `cad_run_commands`
     approach) and commits as one Undo step labelled "Run command script", or changes
     nothing and names the failing line. Empty Enter or `repeat` reruns the last
     command or script. The palette searches registry aliases (`erase`, `del`, `dup`,
     `zoom`, …) without changing labels or order. See
     [multi-line scripts](TERMINAL-WORKSPACE.md#multi-line-scripts).
4. Durable journal export as CAD Script, the language of the code workspace.
   This closes the "portable multi-command scripts" item from #78.
   **Done 2026-11-24**: `journal export [cadscript|replay]` in the terminal and
   `createCommandJournal` / `exportCommandJournal` in core. Plain primitives
   and their later edits become CAD Script programs; everything else stays as
   marked non-portable replay text. The journal is outside document history.
   Portable export of sketches and extrusions: **done 2026-11-25** (branch
   `feat/terminal-scripts-journal`). Closed literal sketches on XY, XZ or YZ that are
   extruded or revolved become `extrudeProfile`/`revolve` programs, checked by
   rebuilding each one and comparing volume and bounding box. Unused, parametric or
   consumed sketches stay `@replay` text.
   Still open: parametric profiles and booleans of portable bodies.

### Exact features (document version 41). **Done 2026-11-25**

Branch `feat/exact-features-v41`; the owner approved the format change on 2026-11-25. This
implements the design note that stood here (kept in git history), with these results:

1. **Node and version.** `{kind:'exact-feature', featureVersion:1, source, operation:
   'fillet'|'chamfer'|'shell', size, edges?:'all'|{faceNormal, outermost?}, openFaces?,
   display?:{sourceKey, positions, indices}}` (`packages/core/src/exact-feature.ts`).
   `checkDocument` requires version 41, an existing source, selectors as the kernel interface
   defines them (all edges or one planar face; 1–6 distinct open faces; no topological naming)
   and a display bounded like a `mesh` node. `constructionInputs`, copy/paste, duplicate,
   regeneration, the design graph and model source (`exactFeature(id, {...}, asset(id))`) treat
   `source` like a mirror source.
   - **Versioning decision.** The document version stays "the oldest schema that holds this
     document", as for every earlier bump: only adding an exact feature raises a document to 41.
     Documents without one keep their version and still open in older builds, including
     BrickWright on its current SDK. Purely additive: no migration, old projects and history
     revisions load unchanged.
   - `display` is optional: a node without one (for example written by hand or through model
     source) is valid and stale.
2. **Display and stale detection.** The Manifold evaluator builds the node from `display` only
   when `display.sourceKey === exactFeatureKey(doc, id)`: a signature of the settings, the
   source subtree's geometry (IDs, names, colours, physics, provenance and other displays
   ignored) and the values of the parameters its expressions name. Otherwise it raises
   `FeatureEvaluationError` code `stale-exact` naming the node: "*Name*: the exact fillet is out
   of date after an upstream change. Recompute it with the exact kernel (Recompute exact, or the
   terminal command recompute exact)." Renaming, moving, duplicating or pasting a feature keeps
   the mesh. The exact backend (`packages/exact/src/display.ts`) tessellates at 0.01 mm / 10°,
   welds, and refuses a surface that is not closed and consistently oriented. Hosts with the
   kernel (editor exact worker, MCP exact thread, CLI) commit displays only inside
   `session.withKernel(...)`, and the session refuses a display whose key does not match the
   model it commits to.
   - **Recompute policy (editor).** After a committed user edit (never a drag preview, Undo,
     Redo or load) leaves an exact feature stale, the editor recomputes it once and commits the
     mesh as its own step, "Recompute exact features", recorded with `context.kernel`. A drag
     only previews and commits once at the end, so it adds at most that one follow-up step.
     Undoing the recompute returns to the stale state without recomputing again (otherwise Redo
     would be lost); the inspector's **Recompute exact** and `recompute exact` do it on request.
     Explicit-only recompute was rejected: one stale feature blocks the whole Manifold
     evaluation, so every upstream edit would leave the viewport showing an error.
3. **STEP and exact measures** lower the node as `fillet`/`chamfer`/`shell` of the lowered
   source on `@crispcad/exact-kernel`; the display is never used.
4. **Commands** in the shared registry: `fillet <radius> [targets] [--face <normal>]`,
   `chamfer <distance> [targets] [--face <normal>]`, `shell <thickness> [targets] --open <normal>
   …`, `recompute exact [targets]` (normals `+x`…`-z`, `top`/`bottom`/`front`/`back`/`left`/
   `right` or `X,Y,Z`; the outermost matching face is used). Terminal, MCP `cad_run_commands`,
   CLI `run`, the command palette ("Fillet, chamfer or shell"), and the Edit menu's **Fillet,
   chamfer, shell** dialog, which builds the same command. The inspector of an exact feature has
   **Edit exact feature** and **Recompute exact**. German translations for every string.
5. **Acceptance gate** (`tests/exact-features.test.ts`, `tests/browser/exact-features.spec.ts`),
   20×30×10 mm box:

   | Operation | Exact vs closed form | Display (Manifold) vs exact | Display mesh | Command |
   | --- | --- | --- | --- | --- |
   | `fillet 2` (all edges) | 9.4e-16 | 1.9e-4 (inside: chordal 0.01 mm) | 2,064 vertices, 4,124 triangles | 3.3 s |
   | `chamfer 2 --face top` | 0 | 0 | 12 vertices, 20 triangles | 0.4 s |
   | `shell 2 --open top` | 6.8e-16 | 6.8e-16 | 16 vertices, 28 triangles | 1.0 s |

   Command times are Node wall times including the first kernel load, on the shared machine at
   load average 130. Also covered: save/load, Undo/Redo, the history archive (old revisions
   restore unchanged; the display is one shared content object across revisions, so moving a
   feature stores no copy) and model source round trips; stale detection after an upstream edit
   and a parameter change, then recompute (new volume within 1e-8 of the closed form); replay
   refused for another kernel version or a host without the kernel, accepted for the same one;
   collision preparation (convex decomposition and certificate) on the display mesh of a shell;
   every shipped `.bcad` project and every revision of the shipped history archive load
   unchanged below version 41; `npm run verify:brickwright` with a version 41 document.
   In Chromium, `tests/browser/exact-features.spec.ts` builds a chamfer from the Edit menu
   (the kernel chunk is fetched only then), checks the exact volume, edits the source height
   and sees exactly one "Recompute exact features" step follow, then Undo shows the stale
   diagnostic and Redo restores it. Full `npx vitest run`: 2,125 tests, 19 failures, every one
   of which also fails on `main` under the same load (34 there); `test:terminal` 167/167, the
   exact experiment 99/99.

Left open: an exact display path for many-hole faces (meshing cost, Phase 2); a parameter
renamed on paste (`width` → `width_2`) makes a pasted feature stale until it is recomputed;
fillets of individual edges need topological naming and are out of scope.

### Phase 4: cross-checking with the catalog. **Done 2026-11-25 (exact kernel 0.1.1); rerun 2026-11-26 with ruled lofts and then smooth lofts on 0.1.3**

1. Convert the lab's catalog with `scripts/convert-kcad.mjs` (98.7% convert, 93.6% before
   the 2026-11-25 converter fixes).
2. Build each converted model with Manifold and with the exact backend.
3. Compare both against the lab's native SMLib volumes. Three independent
   results let us tell converter errors apart from kernel errors.
4. Record the results next to
   [CODE-CONVERTERS.md](CODE-CONVERTERS.md#kernelcad-kcadts-models-2026-11-24).

**Second rerun 2026-11-26: smooth lofts, catalog and native volumes from lab `587e964cd`**
(2,402 of 2,402 built natively; the lab fixed its 8 self-crossing models in `ef07c30bf`). CAD
Script gained `smoothLoft`, SMLib's smooth loft through three or more sections (cubic B-spline
through each vertex, chord-length parameters; document version 43, see
[CODE-MODE.md](CODE-MODE.md#smooth-lofts)), and the converter writes kernelCAD's smooth lofts with
it. The harness's loft allowance now counts a twisted or smooth quad's gap only where a Boolean
operand can reach it, plus a cut-face area term (median allowance 2.6 % → 1e-6 of the volume).
[Details](../experiments/catalog-crosscheck/README.md#results-smooth-lofts-exact-kernel-013-2026-11-26-second-run).

| Full catalog | 0.1.3, ruled | **0.1.3, smooth lofts** |
| --- | ---: | ---: |
| Three-way all-agree | 2,347 | **2,358** |
| Converter-error | 5 | **2** |
| Converter-partial / -failed | 11 / 31 | 11 / 31 |
| Native-failed | 8 | **0** |
| Manifold vs exact: models agree / disagree | 2,354 / 17 | 2,353 / 18 |

- The three wind-turbine models with smooth lofts agree with native to 1e-9 (were −3.6 % to
  −0.60 %); the 8 fixed models agree in all three builds.
- The 2 converter errors left (`nature/hill-tile` +31 %, `nature/ground-tile` +7 %) are ruled
  lofts, not smooth ones, and the native build is the odd one out: its wire-built sections
  re-seam a square drawn with collinear edge midpoints, joining the wrong vertices. Reported to
  the lab.
- Manifold vs exact: 49 parts in 18 models, all planar float32 numerics; the toilet `bowl` agrees
  under the new cut-face term, and three thin parts 600 mm from the origin that the loose
  ruled-loft allowance had hidden now show at 1.1e-6 to 1.2e-6.

**Rerun 2026-11-26: ruled lofts (CAD Script revision 2), exact kernel 0.1.3, native volumes
from lab `5ea9d18f3`** (2,394 of 2,402 built natively). Owner-approved: `loft` now builds ruled
side surfaces in new and converted programs, version-gated so saved programs keep their
triangulated lofts (per-program language revision, document version 42; see
[CODE-MODE.md](CODE-MODE.md#language-revisions) and
[PARAMETRIC-MODEL.md](PARAMETRIC-MODEL.md#document-versions)). The mesh fans each twisted side
quad around its centre (exactly the ruled volume); the exact backend builds SMLib's ruled loft
(ruled volume and area). Both full runs use the same converted programs, once at revision 1:

| Full catalog | 0.1.1, triangulated | 0.1.3, triangulated | **0.1.3, ruled** |
| --- | ---: | ---: | ---: |
| Three-way all-agree | 2,215 | 2,214 | **2,347** |
| Converter-error | 137 | 137 | **5** (smooth lofts) |
| Exact-failed | 1 (tumbleweed) | 1 | **0** |
| Converter-partial / -failed | 18 / 31 | 11 / 31 | 11 / 31 |
| Native-failed (self-crossing source outlines) | – | 8 | 8 |
| Manifold vs exact: models agree / disagree | 2,350 / 20 | 2,350 / 20 | 2,354 / 17 |

- 132 of the 137 converter errors and tumbleweed now agree with native to 1e-6 (beacon lamp
  model 2.0e-9); no model got worse. Exact areas equal native areas to 1e-6 for all 2,347
  (triangulated: 2,198), boxes to 1e-3 mm.
- **What is left is only smooth lofts, partial and refused conversions, and source problems:**
  5 smooth lofts converted as ruled (`nature/hill-tile` +31 % … `wind-energy/offshore-wind-turbine`
  −0.60 %), 11 partial conversions, 31 refused conversions, and 8 models with self-crossing
  outlines that the lab's native build (and exact kernel 0.1.3, and OCCT) refuse. Our converter
  skips exactly those self-crossing parts and the rest of each model agrees in both kernels.
- The 0.1.1 → 0.1.3 kernel step changed no model class; exact CPU 1,753 → 1,310 s, slowest part
  187 → 5.2 s (the 0.1.2 bbox fix).
- One new Manifold-vs-exact disagreement: `interior/toilet` `bowl`, a Boolean cutting twisted loft
  quads (area 51 mm² over the allowance; the exact build equals native).

Earlier results, full catalog, 2,402 models, 69,367 converted parts, `@crispcad/exact-kernel` 0.1.1, catalog
and native volumes at lab `2566debd9` / `e6ff5d3fc`:

- **Where both kernels build a part, they agree.** 69,307 of the 69,363 parts built by both
  agree within a tolerance derived from each part's segment counts; planar parts to 9.7e-7
  relative volume. The other 56 are Manifold numerics (float32 vertices and mesh area far from
  the origin, faces of exactly touching operands kept).
- **Models:** 2,350 agree, 0 exact-unsupported, 1 exact-kernel failure, 20 disagree, 31 do not
  convert (0.1.0: 2,223 / 5 / 119 / 24 / 31; before the converter fixes 989 / 1,127 / 115 / 18 /
  153).
- **0.1.1 cleared every exact-kernel gap the 0.1.0 run found:** rotated-sphere boxes (57 parts),
  the hexagonal frustum area (chandelier `canopy` 47,342.285 mm², closed form 47,342.29; was
  81,727), the long multi-section lofts that did not stitch (445 parts, all build and agree) and
  the 64-point hull limit (30 parts). Our polyhedron budget went from 256 to 2,048 faces (38
  parts; the lab builds them as the same polygonal lofts, volumes agree to 6e-10).
- **Native column (lab `smlib-native`, all 2,402 models built):** 2,215 models agree in all
  three (exact = native to 1e-6; area to 1e-6 for 2,198 of them, boxes to 1e-3 mm for 2,214);
  137 converter errors; 18 partial conversions; 31 converter failures; 1 exact failure
  (tumbleweed, a converter triangulation). **No model is an exact-kernel or Manifold error
  against native**; every disagreement is the converted program.
- **The remaining converter error was CAD Script's `loft`** (fixed 2026-11-26, above): it splits each side quad along one
  diagonal, while kernelCAD and the lab build a ruled surface. Between sections turned against
  each other the two differ (beacon lamp: 2,678,272 vs 2,772,520 mm³, closed form). A probe that
  splits such quads through their centre (exact ruled volume) makes 139 of the 147 converter
  errors and exact failures agree with native to 1e-6. Not merged: it changes `loft` for every
  document, an owner decision. The rest: 5 smooth lofts converted as ruled (up to +31 %), 3 at
  ≤ 6.5e-6. Path arcs were not the cause in the models checked.
- **Fixed in the converter:** `for (let …)` closures shared one binding (`roll-cage-trolley`'s
  wire grid all at the last row; found by the native box).
- **Reported:** the exact kernel's 0.1.1 `bbox()` takes up to 3 min on trimmed NURBS
  bodies (ellipsoid heaps; exact CPU 806 → 1,753 s for the catalog), **fixed in 0.1.2** (9–24 ms,
  same boxes); the lab's native build gave
  a self-intersecting outline (helmet chin straps) zero volume but nonzero area; since lab
  `5ea9d18f3` it refuses such outlines, as exact kernel 0.1.3 does.

## Owner decisions (2026-11-24)

- **Licence of the exact kernel: MIT + Apache-2.0 only.** `@classcad/smlibwasm`
  is `MIT AND Apache-2.0 AND OFL-1.1`, and its only OFL items are the Lato font
  (`dist/_fonts.js`, `dist/_fonts.d.ts`) and `fonts/OFL.txt`. The kernel package
  aliases the font to an empty module. Modeling and STEP are unaffected, and
  `Text()` without a font fails cleanly. Tree-shaking alone does not remove the
  font, so the alias is required.
- **Kernel lab name.** The fork is `CrispStrobe/crispcad-kernel-lab`. Product
  branding inside the lab moves from "CrispCAD" to "CrispCAD kernel lab".
- **Downstream direction.** The chain is crispcad-kernel-lab → CrispCAD →
  BrickWright (see [Dependency chain](#dependency-chain)).
