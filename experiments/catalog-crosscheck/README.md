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
| Exact, kernelCAD intent | Only for parts the exact kernel refuses because of a circle with fewer than 16 segments. kernelCAD ignores `cylinder(h, r, segments)`'s segment count (its cylinder is always exact) and `torus(R, r, n)` revolves an *n*-gon tube exactly. Until 2026-11-25 the converter emitted both as low-segment CAD Script; it now emits true cylinders and polygon tubes, so this probe finds no parts and stays as a regression check. It re-lowers the compiled tree with such cylinders and revolutions exact and the tube as an *n*-gon polygon, which is what the lab's kernel builds. |

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

Measured 2026-11-25 on an 8-core Apple M1 shared with other sessions (load average 30–230),
Node 26.4.0, catalog at kernel-lab commit `d09cda7f6` (its `catalog/` is identical at
`c4bea5b93`, where the lab's coverage was measured), with the converter fixes of branch
`fix/kcad-converter-semantics` (see [Converter fixes](#converter-fixes-2026-11-25)) and the
merged exact kernel (`@crispcad/exact-kernel` 0.1.0, `packages/exact/src/lower-cad-script.ts`).
**The full catalog was run**: 2,402 models, 69,295 converted parts, 24.5 min wall with three
workers (Manifold 87 s CPU in total, median part 0.75 ms; exact 806 s CPU, median part
4.1 ms, slowest part 0.7 s); the 35 models whose conversion changed with the last converter
commit (assembly connectors) were then rerun by resume. The 300-model stratified sample (seed
`crosscheck-1`, all 50 kits) is the quick regression run (1.4 min at load 30). Files:
[`results/full-summary.md`](results/full-summary.md),
[`results/full-summary.json`](results/full-summary.json) (counts, causes, worst cases),
[`results/full-models.json`](results/full-models.json) (one line per model: class, converter
status, part classes, volume totals), [`results/full-run.json`](results/full-run.json) (run
parameters, calibration); the same for `sample-300`, whose per-part
[`sample-300.jsonl`](results/sample-300.jsonl) is committed (the full run's 39 MB JSONL is not;
`npm run full` regenerates it). The full summary was written with the lab's status-only
coverage file (`summarize.ts results/full.jsonl --native lab.json`).

| Model class (full catalog) | Before fixes | Now | |
| --- | ---: | ---: | --- |
| agree | 989 | 2,223 | every part built by both kernels and agrees |
| exact-unsupported | 1,127 | 5 | before: 1,123 only because of low-segment cylinders/tori; now hull and faceted-solid budgets |
| kernel-failure | 115 | 119 | an exact `invalid-input` (445 parts, all long multi-section lofts) |
| disagree | 18 | 24 | 116 parts, causes below |
| converter-failure | 153 | 31 | 25 unsupported features, 6 unknown helper names |

| Part class | Before (63,281 parts) | Now (69,295 parts) |
| --- | ---: | ---: |
| agree | 52,087 | 68,666 |
| exact-unsupported | 10,662 (10,608 low-segment cylinders/tori) | 68 (38 polyhedra over 256 faces, 30 hulls over the vertex budget) |
| exact-failure | 437 | 445 (`The polyhedron faces do not close around a valid solid`) |
| disagree | 92 | 116 |
| manifold-failure / both-failed | 2 / 1 | 0 / 0 |

**Where both kernels build a part they agree.** 68,782 parts were built by both (52,179
before); 68,666 agree within the derived tolerance, the 50,860 planar ones to 9.7e-7 relative
volume at worst (median 0). **Model volumes now match the exact build to the faceting of 48
segments:** over the 2,240 models whose parts all build in both kernels, Manifold's total is
within 1e-2 of the exact total for 2,237 and the worst is −1.0 % (a 48-gon prism loses
0.29 %, a 48 × 48 sphere more), median −3.8e-5. Before the fixes, 115 of
2,128 models were more than 5 % low and the worst was −15.3 %, all from low-segment cylinders
and tori. The low-segment intent probe now finds no parts.

Sample (300 models): agree 127 → 277, exact-unsupported 133 → 1, converter-failure 23 → 3,
kernel-failure 12 → 13, disagree 5 → 6; 9,379 parts (8,410 before), model totals within 1e-2
for 281 of 282 (worst −1.0 %, before −10 %).

The native column is available only as build status (the lab's
`experiments/kernel-qualification/results-catalog-native.json` at `c4bea5b93` lists its 11
failures and no volumes): of the 2,391 models the lab builds, we convert 2,368 (23 are
converter failures); of its 11 failures, 8 are also converter failures here (curved sweeps,
side-face holes, off-XY lofts, multi-loop sketches) and 3 are classed `agree` here only because
they convert partially (`skid-steer-loader`, `miniature-park-tram-engine`,
`impulse-merchandiser`): the parts the converter skips are self-intersecting extrusion
profiles, the same extrudes the lab's SMLib build fails on.

### Causes

Disagreements (116 parts in 24 models), each class checked against the converted CAD Script
and the `.kcad.ts` source:

1. **SMLib's tight bounding box misses a rotated sphere's extreme (57 parts; exact kernel).**
   In every case the exact bbox is *inside* Manifold's, which is impossible for a correct bbox
   because Manifold's vertices lie on the true surface. Examples:
   `retail-store/produce-display-table` (48 fruit spheres on a tilted crate:
   `heap-0-0` exact min z 543.32 vs Manifold 539.99), `amusement-park/ride-operator-console`
   (`estop-head`, `sphere(62).scale([1, 1, 0.5])` on a sloped desk: 2.19 mm). Minimal repro:
   `Sphere(62).rotate(Axis.X, 11).bbox()` gives min z −60.861 instead of −62 (the loose box
   and the 0°, 30°, 45°, 90° rotations are right); volume and area are exact.
2. **Planar volumes at the 1e-6 floor (26 parts; Manifold numerics).** 23 are thin wing and
   window lofts of the newly converted `airfield` aircraft (winglets, cheat lines, 0.4–2 mm thick,
   600 mm from the origin), 1e-6 to 7.4e-6 off: CAD Script polyhedra reach Manifold as float32
   vertex positions. The other 3 are the metre-scale parts of before
   (`mining/run-of-mine-hopper` `ring-stiffener-1`: exact equals the closed form to 1e-10,
   Manifold is 1.13e-6 high; `nature/baobab-tree` `tuft-5`, `nature/bramble` `berries-4`).
3. **Float32 mesh area far from the origin (25 parts; harness, not a kernel).** Thin planar
   parts placed metres from the origin (`telecom-infrastructure/monopole-mast` jumpers at
   z ≈ 9,900 mm, `solar-energy/pole-mount-transformer` bolts) miss the 1e-5 area floor by up
   to 1.8e-5, because the harness sums Manifold's mesh in float32. Volumes agree to 3e-10.
4. **SMLib area of a stitched loft polyhedron is too large (5 parts; exact kernel).**
   `lighting/chandelier` `canopy`, a hexagonal frustum
   `loft([hexagon r 14 @ z 780, hexagon r 90 @ z 830])`: closed-form area 47,342.29 mm²,
   Manifold 47,342.29, exact 81,727.14, while both volumes agree to 3e-8. Also the chandelier's
   three `up-cup`s and `office/paper-shredder` `head`.
5. **Manifold keeps the faces of exactly touching operands (3 parts; Manifold, area only).**
   `characters/excavator` `undercarriage` unions a 920 × 900 × 220 box with two track prisms
   whose inner faces lie exactly on the box's ±x faces: the exact area excludes those faces,
   Manifold's is larger by exactly 2 × 900 × 220 = 396,000 mm², volumes equal. Same in
   `travel-gear/duffel-bag` `wrap-strap-0/1` (13,600 mm²). Manifold's symbolic perturbation
   does not merge exactly coincident faces; the exact area is the right one.

Unsupported and failing parts:

6. **Long multi-section lofts fail to stitch (445 parts; exact kernel).** Rollers, tyres,
   vessels and drums built as `loftCylinder`-style 10–16-gon lofts with four or more sections
   (`postal-logistics/postal-pallet-roller-deck` `roller-a`: sections at z 0, 75.6, 1004.4,
   1080 around r 13.5–15.4). The same loft scaled to 30 mm long builds, so the failure is
   aspect-ratio dependent: the exact convex hull merges near-coplanar facets of the
   six-decimal points over a 1 m length into faces that are not planar within SMLib's stitch
   tolerance. Concentrated in mining, water treatment and shipyard.
7. **Converter failures (31 models).** Lofts whose sections have different point counts 12
   (kernelCAD lofts them with OCCT's section matching, which has no clear CAD Script
   equivalent), `shape.hole(s)` 4, `helix` 3, the catalog helper `prismSideY` 3 (an unknown
   name: not part of the API the converter models), `shape.boundingBox` of a part over the CAD
   Script limits 3, `Array(n)` 2, `multiple moveTo in one path`, `void`, an off-XY loft plane and
   a numeric property of a non-array value, 1 each. A further 19 models convert partially
   (self-intersecting extrusion profiles, loft sections not ordered along Z, nesting over 32).

### Converter fixes (2026-11-25)

Each fix is pinned with closed-form examples (exact kernel and Manifold) in
[`tests/kcad-semantics.test.ts`](../../tests/kcad-semantics.test.ts).

| Fix | Models / parts | Effect |
| --- | --- | --- |
| `cylinder(h, r, n)` → `cylinder(r, h)` (CAD Script's default segments: a true circle for the exact lowering, 48-gon in Manifold); `torus(R, r)` → `torus(R, r)`, `torus(R, r, n)` → `revolve(polygon2d(n-gon tube), 360)` (ring exact, tube an *n*-gon with its first vertex on the outer equator); `path().circle(cx, cy, r)` without a count → `move2d(cx, cy, circle2d(r))` | 10,608 parts (1,123 models) | exact-unsupported parts 10,662 → 68; worst model volume −15.3 % → −1.0 % (faceting only) |
| `await shape.boundingBox({ exact: true })` evaluated at conversion time from support functions of the converted part (true circles); a side a cutter or intersection can change is a marker that refuses conversion only when read, and resolves in `Math.min/max` when another operand is certainly beyond it | 24 | 21 convert; 3 refused (`part over the CAD Script limits`); before: misreported as a TypeScript error |
| Negative box sizes span [size, 0] (OCCT, SMLib); `extrudeRoundedRect` `axis` `x` (x, y, z) → (z, x, y) and `y` → (x, z, −y), radius clamped below half the shorter side as upstream | 12 + 34 | 45 convert, 1 partially |
| Assembly `connector()` ignored with a warning; `mate()` at pose 0 (the as-built pose, all 36 catalog mates) ignored, other poses refused | 35 (30 that stopped there, 5 that stopped earlier) | all convert |
| JavaScript used by catalog helpers: `string.replace/replaceAll`, `findIndex`, `splice`, array rest patterns, `Math.cosh` & co., `in` on records, `for…of` over strings, `Infinity` sentinels, integer intermediates above 1e9 (seeded generators) | 25 | all convert |
| Lofts with different section point counts | 12 | left unsupported (no clear semantics) |

Converter outcome (all 2,402 models): converted 2,231 → 2,352, partial 18 → 19, unsupported
104 → 25, failed 49 → 6; 98.7 % of models convert (97.9 % completely), up from 93.6 %.

### Follow-ups

Converter (`packages/core/src/kcad-import.ts`):

- Path arcs (`threePointsArc`) are still polygons (16 segments per half turn) when they reach
  CAD Script; only whole `path().circle()`s stay exact. Emitting arcs exactly needs an arc
  construct in CAD Script profiles.
- Lofts with different section point counts (12), `shape.hole(s)` (4), `helix` (3): need
  semantics or exact-kernel features first.

Exact kernel (`@crispcad/exact-kernel` / `packages/exact`):

- `bbox()`: SMLib's tight box is wrong for some rotated spheres. Take the union with the
  bbox of a fine tessellation, or compute sphere/torus faces analytically; add
  `Sphere(62).rotate(X, 11)` as a regression case. Report upstream (`brep_bounding_box`).
- `area()` of stitched polyhedra: wrong for loft frusta (chandelier `canopy` is a minimal
  case with a closed form); compute polyhedron areas from the faces, and report upstream.
- Long multi-section lofts: snap near-coplanar hull facets (or triangulate instead of
  merging) so stitching succeeds; 445 catalog parts.
- Hull and polyhedron budgets (68 parts).

Harness and lab:

- **TODO (lab): native volumes.** Extend the lab's `catalogCoverage.ts` to write the summed
  part volume per model in the [format above](#native-volumes); then the three-way classes
  (`converter-error` / `manifold-error` / `exact-error`) are one `summarize.ts --native` away.
  That column will also expose converter faceting the two-kernel check cannot see (path arcs).
- Use Manifold's double-precision surface area instead of the float32 mesh (removes cause 3).

### Kernel versions

The first full run (before the converter fixes) used the exact kernel as it was before the
2026-11-25 move into `@crispcad/exact-kernel`; rerunning the sample on the merged kernel gave
bit-identical builds and unchanged classes. The runs above use the merged kernel
(`@crispcad/exact-kernel` 0.1.0, the same SMLib build).
