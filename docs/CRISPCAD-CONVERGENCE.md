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
CrispCAD ──(packaged CAD SDK, @brickwright/cad-*)──▶ BrickWright (brickwright-lite)
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
    count: 3.8 s for a plate with 48 holes.
- **Not supported yet** (each raises an explicit error):
  - minkowski, text, twisted or tapered extrusion;
  - most hulls;
  - circles with fewer than 16 segments;
  - large tessellated constructors.

Remaining work for this phase:

- ~~product entry (iPad WebKit measurements, the geometry worker, cancellation)~~:
  **done 2026-11-25**, see [Phase 3](#phase-3-one-command-vocabulary) steps 1–2;
- the importer's torus gap;
- faster meshing of faces with many holes (display still uses Manifold, so this only matters
  for a future exact display path).

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

Release: [`exact-kernel-v0.1.0`](https://github.com/CrispStrobe/crispcad-kernel-lab/releases/tag/exact-kernel-v0.1.0)
of the kernel lab, tarball `crispcad-exact-kernel-0.1.0.tgz`, SHA-256
`1de74c8d15d184359c855f119e5d5a89e587fa6faa6ead9beb6efd73fc510027`.

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
`feat/exact-kernel-product`), except exact `fillet`/`chamfer`/`shell`, which need a
document-model change; see the [design note](#exact-features-design-note):

- the geometry worker: a second, lazily created instance of the same worker script loads the
  kernel on the first exact request (the kernel's own `new URL('smlibwasm.wasm')` is resolved
  by Vite; compiled-module reuse across worker restarts is not needed while the exact worker
  lives until cancelled);
- iPad WebKit (Playwright) and Chromium measurements; a physical iPad was not available;
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
   - Exact `fillet`, `chamfer` and `shell` are **not** shipped; see the
     [design note](#exact-features-design-note).
2. Recorded commands carry the kernel that built them. Replay rejects a kernel
   change. **Done 2026-11-25** (mechanism): `apply` records may carry
   `context.kernel = {id, package, version}`; edits made in `session.withKernel(kernel, …)`
   record it; sessions declare the kernels their host provides
   (`createCadSession(doc, {kernels})`; the editor and MCP host declare
   `@brickwright/cad-exact/identity`, which loads no WebAssembly). Replay refuses a missing
   kernel or another package version with a clear message, and re-records a replayed edit with
   its kernel. Old records have no kernel and replay unchanged. Because `export step` and
   `measure exact` only read the model, no shipped command produces such a record yet; their
   results carry the kernel identity instead. The first producer will be the exact features
   below.
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
4. Durable journal export as CAD Script, the language of the code workspace.
   This closes the "portable multi-command scripts" item from #78.
   **Done 2026-11-24**: `journal export [cadscript|replay]` in the terminal and
   `createCommandJournal` / `exportCommandJournal` in core. Plain primitives
   and their later edits become CAD Script programs; everything else stays as
   marked non-portable replay text. The journal is outside document history.
   Next: portable export of sketches and extrusions.

### Exact features design note

Exact `fillet`, `chamfer` and `shell` change geometry, so unlike `export step` they need a
document node. That change was judged too large to make safely together with product entry:

- **Every evaluator is synchronous and Manifold-only.** The editor worker, the MCP worker,
  physics collision preparation, drawings, printability and the BrickWright SDK all evaluate a
  document with Manifold alone. A node that only the exact kernel can build would force the
  9.4 MB kernel into every consumer of such a document, including BrickWright and the eager
  offline path, which contradicts "opt-in, lazily loaded".
- **A stored mesh goes stale.** Storing the exact result's tessellation in the node lets
  Manifold display it without the kernel, but any edit upstream (a sketch dimension, a
  parameter) invalidates it, and a host without the kernel cannot recompute it.
- **Versioning.** A new node kind needs document version 41. Older apps refuse unknown versions
  (they never downgrade), so BrickWright and the SDK must accept version 41 before CrispCAD
  writes it.

Proposed design, for a follow-up branch:

1. Node `{kind:'exact-feature', featureVersion:1, source, operation:'fillet'|'chamfer'|'shell',
   size:FeatureScalar, edges:'all'|{faceNormal, outermost?}, openFaces?:FaceSelector[],
   display:{sourceKey, positions, indices}}`, document version 41. `constructionInputs`
   includes `source`; `checkDocument` validates the selectors against the kernel interface
   (all edges or the edges of one planar face; open faces by outward normal; no topological
   naming) and the display mesh like a `mesh` node (750 000 positions).
2. Display, physics, drawings: the Manifold evaluator builds the node from `display` only when
   `display.sourceKey` equals the geometry key of the source subtree; otherwise it raises a
   `FeatureEvaluationError` with code `stale-exact` naming the node. A host with the exact
   kernel (the editor's exact worker, the MCP exact thread) recomputes the display mesh
   (tessellation at 0.01 mm / 10°) and commits it inside `session.withKernel(...)`, so the
   record carries `context.kernel` and replay refuses another kernel version (step 2, done).
3. STEP and exact measures: `lowerDocumentBody` lowers the node as
   `fillet`/`chamfer`/`shell` of the lowered source, so STEP stays exact.
4. Saved projects and history: purely additive; no migration of existing documents. Undo,
   redo and the history archive treat the node like any other.
5. Acceptance gate: closed forms (all-edge box fillet, top chamfer, open-top shell) at 1e-8
   relative; the Manifold display volume within the tessellation tolerance of the exact volume;
   undo/redo and archive round trip; replay refused after a kernel version change; collision
   preparation on the display mesh; `npm run verify:brickwright` with version 41.

Until then `measure exact` (exact volume, area, bounds and centroid) is the exact measure in
the product.

### Phase 4: cross-checking with the catalog. **Steps 1, 2 and 4 done 2026-11-25; step 3 waits for lab volumes**

1. Convert the lab's catalog with `scripts/convert-kcad.mjs` (98.7% convert, 93.6% before
   the 2026-11-25 converter fixes).
2. Build each converted model with Manifold and with the exact backend.
3. Compare both against the lab's native SMLib volumes. Three independent
   results let us tell converter errors apart from kernel errors.
4. Record the results next to
   [CODE-CONVERTERS.md](CODE-CONVERTERS.md#kernelcad-kcadts-models-2026-11-24).

Results (harness and details in
[experiments/catalog-crosscheck/README.md](../experiments/catalog-crosscheck/README.md)),
full catalog, 2,402 models, 69,295 converted parts (after the converter fixes):

- **Where both kernels build a part, they agree.** 68,666 of the 68,782 parts built by
  both agree within a tolerance derived from each part's segment counts; planar parts to
  9.7e-7 relative volume.
- **Models:** 2,223 agree; 5 are exact-unsupported (hull and faceted-solid budgets); 119 hit
  an exact-kernel failure; 24 disagree; 31 do not convert (989 / 1,127 / 115 / 18 / 153
  before the fixes).
- **The largest error was the converter's, not a kernel's, and is fixed.** kernelCAD ignores
  the segment count of `cylinder(h, r, n)` (always exact) and uses `torus`'s only for the
  tube; the converter emitted *n*-gon prisms (10,608 parts, up to 15 % of a model's volume).
  It now emits true cylinders and polygon tubes; every model whose parts build is within
  1.0 % of the exact volume (48-segment faceting). The same pass added
  `await shape.boundingBox({ exact: true })`, negative box sizes, `extrudeRoundedRect` axes,
  pose-0 mates and connectors.
- **Exact-kernel gaps found:** SMLib's tight bbox misses the extreme of some rotated
  spheres (57 parts; `Sphere(62).rotate(X, 11)`); its area of stitched loft polyhedra is
  wrong (5 parts; a hexagonal frustum is off by 73 % against the closed form); long
  multi-section lofts fail to stitch (445 parts).
- **Manifold:** 26 planar parts 1e-6 to 7e-6 off at large coordinates (float32 vertices);
  3 unions keep the faces of exactly touching operands in the area.
- **Native column:** the lab commits only build status (2,391/2,402). Our classes are
  cross-tabulated against it; the three-way volume split (converter vs kernel errors) needs
  the lab's catalog harness to write per-model volumes (format in the README).

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
