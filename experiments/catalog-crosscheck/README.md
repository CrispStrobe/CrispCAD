# Catalog cross-check: kernelCAD catalog through Manifold and the exact kernel

Phase 4 of [CRISPCAD-CONVERGENCE.md](../../docs/CRISPCAD-CONVERGENCE.md#phase-4-cross-checking-with-the-catalog).
The kernel lab's 2,402-model kernelCAD catalog is converted to CAD Script with our
[converter](../../docs/CODE-CONVERTERS.md#kernelcad-kcadts-models-2026-11-24), and every
converted part is built twice: with Manifold (the product kernel, `packages/geometry`) and
with the SMLib exact B-rep kernel (`@crispcad/exact-kernel`, qualified in
[`../exact-kernel`](../exact-kernel/README.md)) through
[`packages/exact/src/lower-cad-script.ts`](../../packages/exact/src/lower-cad-script.ts). The two builds are compared on volume, area and bounding box
within a tolerance derived from the segment counts in each part. A third column, the lab's
own native SMLib volumes, is an optional input (see [Native volumes](#native-volumes)).

**Status: experiment only.** Nothing here is shipped or imported by `packages/*`. No
catalog source or converted CAD Script is committed: `results/` holds only per-model
metadata (catalog path, SHA-256, numbers, error messages).

## Run

```sh
npm ci                                      # repository root (Manifold, cad-core, TypeScript)
npx tsc -b packages/core packages/geometry packages/exact   # root install includes @crispcad/exact-kernel
cd experiments/catalog-crosscheck
LAB=/path/to/kernelCAD-web-clone npm run catalog   # git archive of catalog/kits (no build in the lab)
npm run sample                              # 300-model stratified sample -> results/sample-300.*
npm run full                                # all 2,402 models -> results/full.*
node summarize.ts results/sample-300.jsonl [--native native-volumes.json]
npm run typecheck
```

`node run.ts --catalog <dir> [--sample N | --all] [--seed s] [--jobs n] [--timeout s]
[--name n] [--native file] [--lab-commit sha]`. Models are processed by `--jobs` worker
processes (default 3), each loading Manifold and SMLib once and being replaced every 40
models or after a WASM trap; a model over `--timeout` seconds (default 300, wall clock) is
killed and recorded as `timeout`. Results are appended to `results/<name>.jsonl` one model
per line, so an interrupted run resumes where it stopped. `npm run catalog` copies only
`catalog/kits/**/*.kcad.ts` (and kit metadata, no previews) from the lab clone into the
git-ignored `.catalog/` and records the commit; delete `.catalog/` when done.

**Sample.** `--sample N` takes a deterministic sample stratified by catalog kit (the 50
`catalog/kits/<kit>` directories): each kit gets its proportional share by largest
remainder, at least one model, and within a kit the models with the smallest
`sha256(seed, path)` are chosen. Same seed and catalog commit give the same sample.

## What is compared

Per model: the converter's outcome (`converted`, `partial`, `unsupported`, `failed`,
`limited`, `licence`), then per converted part:

| Build | How |
| --- | --- |
| Manifold | `createCadSession().addCode(part.program)` → `createGeometryKernel().evaluate(...)`; volume from Manifold, area summed over the output mesh, bbox from Manifold. |
| Exact | `evaluateCadScript(smlib, part.program)` → SMLib `volume`, `area`, `bbox`, `isValid`. Errors keep the adapter's code: `unsupported`, `invalid-input`, `kernel-failure`. |
| Exact, kernelCAD intent | Only for parts the exact kernel refuses because of a circle with fewer than 16 segments. kernelCAD ignores `cylinder(h, r, segments)`'s segment count (its cylinder is always exact) and `torus(R, r, n)` revolves an *n*-gon tube exactly; the converter emits both as low-segment CAD Script. The harness re-lowers the compiled tree with those cylinders and revolutions exact and the tube as an *n*-gon polygon, which is what the lab's kernel builds. |

CPU and wall time are recorded for each build. A model's totals are the sums of its part
volumes (only when every part built).

### Tolerance

Manifold builds a circle with *N* segments as the inscribed *N*-gon; the exact kernel
builds the circle. The inscribed polygon's area ratio is sin(2π/N)/(2π/N), so a prism or
full revolution loses

δ(N) = 1 − sin(2π/N)/(2π/N)  (2.85e-3 at N = 48, 1.73e-1 at N = 6)

of its volume. [`src/tolerance.ts`](src/tolerance.ts) walks each part's compiled
`CodeShape` tree, collects every curved construct (cylinder, frustum, sphere, circle and
round-offset profiles of extrusions, revolutions and their curved profiles) with its
segment count and nominal volume, surface and radius under the enclosing scales and
`repeat`s, and allows

- volume: 2 · Σ f_v · δ(N_i) · V_i + 1e-6 · V,
- area: 2 · Σ f_a · δ(N_i) · S_i + 1e-5 · A (the extra 1e-5 covers float32 mesh positions),
- bbox: 2 · max f_b · r_i · (1 − cos(π/N_i)) + 1e-6 · diagonal + 1e-6 mm.

A Boolean can turn a deficit into a surplus but not make it larger than the curved volume
involved, so the sum over constructs bounds the difference. The factors are measured once
per run against Manifold (`calibration` in `results/<name>-run.json`): f_v = 1.00 for
prisms and revolutions (the closed form is exact) and 3.5 for Manifold's spheres, f_a ≤ 1
except spheres (1.9), f_b = 1 except spheres (2.5, from the sphere mesh's worst support
gap over 4,000 directions). Planar parts are therefore held to 1e-6 relative volume.

### Classes

Part: `agree`, `disagree` (with the failing measures: volume, area, bbox, exact-invalid),
`exact-unsupported`, `exact-failure` (`invalid-input` or `kernel-failure` while Manifold
built it), `manifold-failure`, `both-failed`.

Model: `converter-failure` (the converter refused or failed; nothing to build),
`disagree` (some part disagrees), `kernel-failure` (some part failed in a kernel, none
disagrees), `exact-unsupported` (some part is unsupported by the exact lowering, the rest
agree), `agree` (every part built by both and agrees), `timeout`, `worker-crash`,
`licence-refused`.

### Native volumes

The third column, the lab's `smlib-native` kernel, is not produced here: this harness
does not run the lab's tooling. The lab clone has no committed per-model catalog volumes
(its `experiments/kernel-qualification/results-catalog-native.json` lists build failures
only). `--native <file>` (for `run.ts` or `summarize.ts`) accepts that coverage file as a
status-only column (`git -C <lab> show <rev>:experiments/kernel-qualification/results-catalog-native.json > lab.json`),
or volumes in this format:

```json
{ "kernel": "smlib-native", "labCommit": "<sha>",
  "models": {
    "<kit>/<model>.kcad.ts": { "status": "ok", "volumeMm3": 12345.6 },
    "<kit>/<other>.kcad.ts": { "status": "error", "error": "recompute.kernel.unsupported-feature: mate" } } }
```

with `volumeMm3` the sum of the model's part volumes at default parameters (the same
quantity as `totals` here; mates and placement do not change it). With it, each model
gets a three-way class: `all-agree`; `converter-error` (Manifold ≈ exact, both ≠ native:
the converted program differs from the source); `manifold-error` (exact ≈ native,
Manifold ≠); `exact-error` (Manifold ≈ native within faceting, exact ≠); `unresolved`;
`native-missing` / `native-failed` / `ours-failed`. Exact vs native is held to 1e-6
relative; where the exact build is unsupported only for low segment counts, the
kernelCAD-intent build stands in. **TODO (lab):** emit this file from the lab's
`smlib-native` catalog run (`buildModel({ code, fileName, kernel: 'smlib-native' })`,
summing part volumes), then rerun `summarize.ts` with `--native`.

## Results

Measured 2026-11-25 on an 8-core Apple M1 shared with other sessions (load average 120–190),
Node 26.4.0, catalog at kernel-lab commit `d09cda7f6` (its `catalog/` is identical at
`c4bea5b93`, where the lab's coverage was measured). **The full catalog was run**, not only a
sample: 2,402 models, 63,281 converted parts, 34.6 min wall with three workers (Manifold
99 s CPU in total, median part 0.9 ms; exact 726 s CPU, median part 2.8 ms, slowest part
1.4 s). The 300-model stratified sample (seed `crosscheck-1`, all 50 kits) is kept as the quick
regression run (about 7 min). Files: [`results/full-summary.md`](results/full-summary.md),
[`results/full-summary.json`](results/full-summary.json) (counts, causes, worst cases),
[`results/full-models.json`](results/full-models.json) (one line per model: class, converter
status, part classes, volume totals), [`results/full-run.json`](results/full-run.json) (run
parameters, calibration); the same for `sample-300`, whose per-part
[`sample-300.jsonl`](results/sample-300.jsonl) is committed (the full run's 37 MB JSONL is not;
`npm run full` regenerates it).

The full run used the exact kernel as it was before the 2026-11-25 move into
`@crispcad/exact-kernel` (`experiments/exact-kernel/src`, `@classcad/smlibwasm` 0.6.2); the
sample was then rerun on the merged `main` (`@crispcad/exact-kernel` 0.1.0 with
`packages/exact/src/lower-cad-script.ts`, the same SMLib build) — see
[Kernel versions](#kernel-versions).

| Model class (full catalog) | Models | |
| --- | ---: | --- |
| agree | 989 | every part built by both kernels and agrees |
| exact-unsupported | 1,127 | 1,123 of them only because of low-segment cylinders/tori (all of which agree once built as kernelCAD means them, below) |
| kernel-failure | 115 | an exact `invalid-input` (437 parts, all long multi-section lofts) or one of 3 parts that are empty in both kernels |
| disagree | 18 | 92 parts, causes below |
| converter-failure | 153 | 104 unsupported features, 49 failures (same counts as the converter's own measurement) |

| Part class (63,281 parts) | Parts |
| --- | ---: |
| agree | 52,087 |
| exact-unsupported | 10,662 (10,300 cylinders and 308 tori with < 16 segments, 30 hulls over the vertex budget, 24 polyhedra over 256 faces) |
| exact-failure | 437 (`The polyhedron faces do not close around a valid solid`) |
| disagree | 92 |
| manifold-failure / both-failed | 2 / 1 (empty results: `Code produces no printable solid`) |

**Where both kernels build a part they agree.** 52,179 parts were built by both; 52,087 agree
within the derived tolerance, the 46,863 planar ones to 9.7e-7 relative volume at worst
(median 0). Every one of the 10,608 low-segment parts that the exact kernel refuses builds
when lowered as kernelCAD means it, and all 10,608 agree with Manifold within the faceting of
the segment count the converter emitted.

The native column is available only as build status (the lab's
`experiments/kernel-qualification/results-catalog-native.json` at `c4bea5b93` lists its 11
failures and no volumes; pass it with `--native`): of the 2,391 models the lab builds, we
convert and build 2,247 (144 are converter failures); of its 11 failures, 9 are also
converter failures here (curved sweeps, side-face holes, multi-loop sketches, off-XY lofts
are refused by our converter too), `skid-steer-loader` agrees here (the lab's
`SM_ERR_NULL_POINTER` sketch failure is a lab-kernel gap, not a model problem) and
`impulse-merchandiser` builds here except for low-segment cylinders.

### Causes

Disagreements (92 parts in 18 models), each checked against the converted CAD Script and
the `.kcad.ts` source:

1. **SMLib's tight bounding box misses a rotated sphere's extreme (59 parts, 2 models; exact
   kernel).** In every case the exact bbox is *inside* Manifold's, which is impossible for a
   correct bbox because Manifold's vertices lie on the true surface. Examples:
   `retail-store/produce-display-table` (48 fruit spheres on a tilted crate:
   `heap-0-0` exact min z 543.32 vs Manifold 539.99), `amusement-park/ride-operator-console`
   (`estop-head`, `sphere(62).scale([1, 1, 0.5])` on a sloped desk: 2.19 mm). Minimal repro:
   `Sphere(62).rotate(Axis.X, 11).bbox()` gives min z −60.861 instead of −62 (the loose box
   and the 0°, 30°, 45°, 90° rotations are right); volume and area are exact.
2. **SMLib area of a stitched loft polyhedron is too large (5 parts, 2 models; exact
   kernel).** `lighting/chandelier` `canopy`, a hexagonal frustum
   `loft([hexagon r 14 @ z 780, hexagon r 90 @ z 830])`: closed-form area 47,342.29 mm²,
   Manifold 47,342.29, exact 81,727.14, while both volumes agree to 3e-8. Also the chandelier's
   three `up-cup`s (−39 to −46 %) and `office/paper-shredder` `head` (−1.3 %).
3. **Float32 mesh area far from the origin (25 parts; harness, not a kernel).** Thin planar
   parts placed metres from the origin (`telecom-infrastructure/monopole-mast` jumpers at
   z ≈ 9,900 mm, `solar-energy/pole-mount-transformer` bolts) miss the 1e-5 area floor by up
   to 1.8e-5, because the harness sums Manifold's mesh in float32. Volumes agree to 3e-10.
4. **Manifold numerics at large coordinates (3 parts; Manifold, at its epsilon).**
   `mining/run-of-mine-hopper` `ring-stiffener-1` (a 4.7 m frustum shell): exact 219,923,537.2
   equals the closed form to 1e-10, Manifold is 1.13e-6 high. `nature/baobab-tree` `tuft-5`
   and `nature/bramble` `berries-4` are the same size of error.

Unsupported and failing parts:

5. **Low-segment cylinders and tori (10,608 parts; converter semantics).** The catalog is
   "low poly" and writes `cylinder(h, r, 8)`, `torus(R, r, 12)`. kernelCAD ignores
   `cylinder`'s segment count (`apiShapeMethods.ts`: `cylinder(h, r, _segments, opts)`, an
   exact cylinder on every kernel) and uses `torus`'s count only for the tube polygon. The
   converter emits `cylinder(r, h, 8)` (an octagonal prism in Manifold, 10 % less volume) and
   `torus(R, r, min(32, n), n)` (the ring faceted too). The exact lowering rightly refuses
   circles under 16 segments as ambiguous. Built as kernelCAD means them, Manifold is low by
   δ(N): 3,184 parts at N = 8 (−10.0 %), 2,993 at 10 (−6.5 %), 2,138 at 12 (−4.5 %), 1,280 at 6
   (−17.3 %), 148 at 4 (−36.3 %), 3 at N = 3 (−58.7 %). Per model (Manifold total against the
   exact/intent total, 2,128 models) the median is −4.5e-4, the 5th percentile −5.4 %, the worst
   −15.3 %; 115 models are off by more than 5 %. **This is the largest error between kernelCAD
   and our conversion, and it is a converter error, not a kernel error.**
6. **Long multi-section lofts fail to stitch (437 parts; exact kernel).** Rollers, tyres,
   vessels and drums built as `loftCylinder`-style 10–16-gon lofts with four or more sections
   (`postal-logistics/postal-pallet-roller-deck` `roller-a`: sections at z 0, 75.6, 1004.4,
   1080 around r 13.5–15.4). The same loft scaled to 30 mm long builds, so the failure is
   aspect-ratio dependent: the exact convex hull merges near-coplanar facets of the
   six-decimal points over a 1 m length into faces that are not planar within SMLib's stitch
   tolerance. Concentrated in mining (142), water treatment (91), shipyard (70).
7. **Converter failures (153 models).** Top: `extrudeRoundedRect` axis option 34,
   `assembly.connector` 30, "strip TypeScript annotations" 24 — every one of the sampled ones is
   `await shape.boundingBox({ exact: true })` (used to drop parts to the floor), not a type
   annotation, so the message is misleading — negative box dimensions 12 (kernelCAD now accepts
   them, as OCCT does), loft sections with different point counts 12, `string.replace` 6,
   `findIndex` 5, `shape.holes` 3, `helix` 3.

### Follow-ups

Converter (`packages/core/src/kcad-import.ts`):

- Emit kernelCAD `cylinder` with the default (exact-intent) segment count, ignoring the third
  argument, and `torus(R, r, n)` as an exact ring with an *n*-gon tube (`torus(R, r, n, 48)`,
  no `min(32, …)`). This removes 10,608 exact-unsupported parts and up to 15 % model volume
  error at once; the intent probe here is the test oracle.
- Support `await shape.boundingBox(...)` (at least `{ exact: true }` on evaluated shapes) or
  report it as an unsupported feature instead of a TypeScript-stripping error (24 models).
- Accept negative box dimensions like kernelCAD (12 models); `extrudeRoundedRect` `axis`
  (34); lofts whose sections differ in point count (12); `string.replace`/`findIndex`.

Exact kernel (`@crispcad/exact-kernel` / `packages/exact`):

- `bbox()`: SMLib's tight box is wrong for some rotated spheres. Take the union with the
  bbox of a fine tessellation, or compute sphere/torus faces analytically; add
  `Sphere(62).rotate(X, 11)` as a regression case. Report upstream (`brep_bounding_box`).
- `area()` of stitched polyhedra: wrong for loft frusta (chandelier `canopy` is a minimal
  case with a closed form); compute polyhedron areas from the faces, and report upstream.
- Long multi-section lofts: snap near-coplanar hull facets (or triangulate instead of
  merging) so stitching succeeds; 437 catalog parts.
- Hull and polyhedron budgets (54 parts) and an explicit polygonal-cylinder construct so
  that low-segment circles have a non-ambiguous exact meaning.

Harness and lab:

- **TODO (lab): native volumes.** Extend the lab's `catalogCoverage.ts` to write the summed
  part volume per model in the [format above](#native-volumes); then the three-way classes
  (`converter-error` / `manifold-error` / `exact-error`) are one `summarize.ts --native` away.
  That column will also expose converter faceting the two-kernel check cannot see: path arcs
  (`threePointsArc`, `path().circle`) are already polygons when they reach CAD Script.
- Use Manifold's double-precision surface area instead of the float32 mesh (removes cause 3).

### Kernel versions

After merging `main` (exact kernel from `@crispcad/exact-kernel` 0.1.0, lowering from
`packages/exact`), the 300-model sample was rerun: all 16,778 measured builds (Manifold, exact
and intent) give bit-identical volume, area and bbox, and every class count is unchanged. The
full-run numbers above therefore hold for the merged kernel; rerun `npm run full` to refresh
them (about 35 min on a loaded M1).
