# Catalog cross-check: kernelCAD catalog through Manifold and the exact kernel

Phase 4 of [CRISPCAD-CONVERGENCE.md](../../docs/CRISPCAD-CONVERGENCE.md#phase-4-cross-checking-with-the-catalog).
The kernel lab's 2,402-model kernelCAD catalog is converted to CAD Script with our
[converter](../../docs/CODE-CONVERTERS.md#kernelcad-kcadts-models-2026-11-24), and every
converted part is built twice: with Manifold (the product kernel, `packages/geometry`) and
with the SMLib exact B-rep kernel (`@crispcad/exact-kernel`, qualified in
[`../exact-kernel`](../exact-kernel/README.md)) through
[`packages/exact/src/lower-cad-script.ts`](../../packages/exact/src/lower-cad-script.ts). The two builds are compared on volume, area and bounding box
within a tolerance derived from the segment counts in each part. A third column, the lab's
own native SMLib build of the original sources (volume, area, box per model), is read from the
lab's committed results (see [Native volumes](#native-volumes)).

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

The third column is the lab's `smlib-native` build of the original `.kcad.ts` sources. This
harness does not run the lab's tooling; the lab commits the per-model numbers, and
`--native <file>` (for `run.ts` or `summarize.ts`) reads them:

```sh
git -C "$LAB" show origin/develop:experiments/kernel-qualification/results-catalog-native-volumes.json > native.json
node summarize.ts results/full.jsonl --native native.json
```

```json
{ "kernel": "smlib-native", "labCommit": "<sha>",
  "models": {
    "<kit>/<model>.kcad.ts": { "status": "ok", "volumeMm3": 12345.6, "areaMm2": 789.0,
                               "bbox": { "min": [0, 0, 0], "max": [1, 2, 3] }, "parts": 4 },
    "<kit>/<other>.kcad.ts": { "status": "error", "error": "…" } } }
```

`volumeMm3` and `areaMm2` are sums over the model's parts at default parameters, `bbox` the
union of the part boxes (the same quantities as summing and uniting our parts). The lab's older
status-only coverage file (`results-catalog-native.json`) is also accepted. Each model gets one
three-way class from the volumes:

| Class | Meaning |
| --- | --- |
| `all-agree` | exact = native within 1e-6 relative, and Manifold agrees within its faceting tolerance |
| `converter-error` | Manifold ≈ exact, both ≠ native: the converted program is not the source's geometry |
| `converter-partial` | the converter skipped parts (reported) and the totals differ |
| `converter-failed` | the converter refused the model; nothing to compare |
| `manifold-error` | exact ≈ native, Manifold ≠ |
| `exact-error` | Manifold ≈ native within faceting, exact ≠ |
| `exact-failed, manifold ≈ / ≠ native` | some part does not build in the exact kernel |
| `unresolved`, `native-missing`, `native-failed`, `ours-failed` | as named |

Where the volumes agree, the summary also compares the exact area with the native area (1e-6)
and the exact box with the native box (1e-3 mm). Per-model three-way classes are the `native`
field of `results/<name>-models.json`; `results/<name>-summary.json` (`native.models`) lists
every model that is not `all-agree` or whose area or box differs, with the three volumes
(`M`, `E`, `N`), `relConverter` = E/N − 1, `relArea` and `dBox`.

## Results

Measured 2026-11-25 on an 8-core Apple M1 shared with other sessions (load average 3–130),
Node 26.4.0, with the exact kernel **`@crispcad/exact-kernel` 0.1.1** (CrispCAD main `dda7ce2`
plus this commit's two converter fixes, see [Fixes](#fixes-2026-11-25-second-pass)). Catalog at kernel-lab commit
`e6ff5d3fc` (`origin/develop`); its `catalog/kits` is identical to `2566debd9`, where the lab
measured its native volumes (`results-catalog-native-volumes.json`, lab commit `a8b4a722d`
and later). Three of the catalog's models changed since the previous run (`airfield`
fuel truck, hangar and maintenance lift, 28 → 100 parts). **Full catalog**: 2,402 models,
69,367 converted parts, about 20 min wall with four workers, in four resumed segments (see
`note` in [`results/full-run.json`](results/full-run.json)). Files:
[`results/full-summary.md`](results/full-summary.md),
[`results/full-summary.json`](results/full-summary.json) (counts, causes, worst cases,
three-way rows), [`results/full-models.json`](results/full-models.json) (one line per model:
class, three-way class, converter status, part classes, volume totals),
[`results/full-run.json`](results/full-run.json) (run parameters, calibration); the same for
`sample-300`, whose per-part [`sample-300.jsonl`](results/sample-300.jsonl) is committed (the
full run's 39 MB JSONL is not; `npm run full` regenerates it).

### Manifold against the exact kernel

| Model class (full catalog) | Before converter fixes | 0.1.0 | **0.1.1** | |
| --- | ---: | ---: | ---: | --- |
| agree | 989 | 2,223 | **2,350** | every part built by both kernels and agrees |
| exact-unsupported | 1,127 | 5 | **0** | hull budget 64 → 1,024 (kernel), polyhedron budget 256 → 2,048 (lowering) |
| kernel-failure | 115 | 119 | **1** | `nature/tumbleweed`, a converter triangulation (cause 4) |
| disagree | 18 | 24 | **20** | 56 parts, causes below |
| converter-failure | 153 | 31 | **31** | unchanged |

| Part class | 0.1.0 (69,295 parts) | **0.1.1 (69,367 parts)** |
| --- | ---: | ---: |
| agree | 68,666 | **69,307** |
| exact-unsupported | 68 (38 polyhedra over 256 faces, 30 hulls over 64 points) | **0** |
| exact-failure | 445 (long multi-section lofts) | **4** (tumbleweed) |
| disagree | 116 | **56** |

Model by model against the 0.1.0 run: 2,221 stay `agree`; 112 `kernel-failure` → `agree` and
2 → `disagree` (their lofts now build; two planar parts are at the 1e-6 floor, cause 1);
6 `disagree` → `agree` (sphere boxes, loft areas); the 4 remaining `kernel-failure` models also
had parts over the 256-face budget and agree now that it is raised.

**What 0.1.1 fixed, checked part by part:**

- *Rotated sphere boxes* (57 parts before): none left. `retail-store/produce-display-table`
  `heap-0-0` now has exact min z 539.976 (Manifold 539.99, whose vertices lie on the surface;
  0.1.0 gave 543.32).
- *Loft frustum area* (5 parts): `lighting/chandelier` `canopy` exact area 47,342.285 mm²
  against the closed form 47,342.29 (0.1.0: 81,727.14); the other four agree too.
- *Long multi-section lofts* (445 parts): all build and agree, e.g.
  `postal-logistics/postal-pallet-roller-deck` `roller-a`. The 4 exact failures left are the
  twisted star lofts of `nature/tumbleweed` (cause 4), a converter problem.
- *Hull budget* (30 parts over 64 points): all build.

**Where both kernels build a part they agree.** 69,363 parts were built by both; 69,307
agree within the derived tolerance, the 51,429 planar ones to 9.7e-7 relative volume at worst
(median 0). Over the 2,370 models whose parts all build, Manifold's total is within 1e-2 of
the exact total for 2,367 and the worst is −1.0 % (48-segment faceting), median −2.6e-5.

**Cost.** Exact CPU 1,753 s in total (0.1.0: 806 s), median part 5.2 ms (4.1 ms). Nearly all
of the increase is the new exact `bbox` on a few trimmed NURBS bodies: 11 parts take 5–187 s
(cause 6), against 0.7 s for the slowest part on 0.1.0.

Sample (300 models, seed `crosscheck-1`, 2.5 min): agree 277 → 293, exact-unsupported 1 → 0,
kernel-failure 13 → 0, disagree 6 → 4, converter-failure 3; 9,379 parts.

### Three-way: Manifold, exact, native

| Three-way class (full catalog) | Models | Sample |
| --- | ---: | ---: |
| all-agree | **2,215** | 278 |
| converter-error | 137 | 15 |
| converter-failed | 31 | 3 |
| converter-partial | 18 | 4 |
| exact-failed, manifold ≠ native | 1 | 0 |
| exact-error, manifold-error, unresolved | 0 | 0 |

The lab builds all 2,402 models. **No disagreement is the exact kernel's or Manifold's:** where
our build is complete and the converter is right, exact and native volumes agree to 1e-6 (2,215
models), the exact area agrees with the native area to 1e-6 for 2,198 of them and to 1e-3 for
2,210, and the boxes agree to 1e-3 mm for 2,214. Every disagreement traces to the converted
program:

- **converter-error (137 models; all contain lofts).** Exact ≈ Manifold, both ≠ native, median
  E/N − 1 = −1.3e-3, from −8.7 % (`nature/flower-patch`) to +28.5 % (`nature/hill-tile`), 37
  beyond 1 %. Causes 4 and 5 below: 129 are twisted ruled lofts, 5 are smooth lofts, 3 are left
  at ≤ 6.5e-6 once the lofts are fixed.
- **converter-partial (18).** The converter skips parts it cannot express (self-intersecting
  extrusion outlines, unordered loft sections, nesting over 32) and says so; the native build
  has them. The lab's own build of such an outline is questionable (cause 7).
- **converter-failed (31).** As before: lofts with different section point counts 12,
  `shape.hole(s)` 4, `helix` 3, `prismSideY` 3, part over the CAD Script limits 3, others 6.
- **exact-failed (1).** `nature/tumbleweed`: Manifold 43.0e6 mm³ against native 91.7e6 (−53 %),
  the exact kernel refuses the solid (cause 4).

The arcs hypothesis (path arcs emitted as 16-segment polygons) does not explain these numbers:
the three converter-error models checked first (`containers/wicker-basket` −2.1 %,
`fire-station/bay-warning-beacon` −1.9 %, `characters/spider-bot` −1.5 %) have no arcs; all
three are ruled lofts between polygons turned against each other.

### Causes

Disagreements between Manifold and exact (56 parts in 20 models):

1. **Planar volumes at the 1e-6 floor (28 parts; Manifold numerics).** Thin `airfield` wing
   parts 600 mm from the origin (winglets, sharklets: up to 7.4e-6) and the three metre-scale
   parts of before (`mining/run-of-mine-hopper` `ring-stiffener-1`, `nature/baobab-tree`
   `tuft-5`, `nature/bramble` `berries-4`). CAD Script polyhedra reach Manifold as float32
   vertex positions.
2. **Float32 mesh area far from the origin (25 parts; harness).** Thin planar parts metres from
   the origin (`telecom-infrastructure/monopole-mast` jumpers at z ≈ 9,900 mm) miss the 1e-5
   area floor by up to 1.8e-5 because the harness sums Manifold's mesh in float32.
3. **Manifold keeps the faces of exactly touching operands (3 parts; Manifold, area only).**
   `characters/excavator` `undercarriage` (+396,000 mm² = 2 × 900 × 220) and
   `travel-gear/duffel-bag` `wrap-strap-0/1`; the exact area is the right one.

The rotated-sphere box (57 parts) and the stitched-loft area (5 parts) of the 0.1.0 run are
gone (see above).

Converter (found with the native column):

4. **Ruled lofts between turned polygons are triangulated, not ruled (129 models + tumbleweed;
   not fixed).** kernelCAD's `loft(…, { ruled: true })` joins vertex *i* of one section to
   vertex *i* of the next with a ruled (bilinear) surface; the lab's native build does the
   same. CAD Script's `loft` ([`packages/core/src/code-loft.ts`](../../packages/core/src/code-loft.ts))
   splits every side quad into two triangles along one fixed diagonal. When a section is turned
   against the next, the quads are not planar and the diagonal decides the volume. Closed form,
   `fire-station/bay-warning-beacon` `lower-lamp` (10-gon r 82 at z 0 → 10-gon r 77.9 turned by
   π/10 at z 150): ruled 2,772,519.67 mm³; CrispCAD's diagonal 2,678,272.48; the other diagonal
   2,866,766.86 (the ruled volume is exactly their mean). The model's two lamps account for
   native − exact = 188,494.36 mm³ to 0.01 mm³. In `nature/tumbleweed` (10-point stars turned by
   up to 0.65 rad between sections) the triangulated surface intersects itself: Manifold loses
   53 % and SMLib refuses it. **Probe:** with each non-planar side quad split into four triangles
   through the mean of its corners, which gives exactly the ruled volume (the fan's volume is
   the mean of both diagonals), and the 2,048-face budget, 139 of the 147 models with a
   converter error or an exact failure agree with native to 1e-6 (tumbleweed to 5.6e-10). The
   probe was reverted: it changes `loft` for every CAD Script document (Manifold meshes, face
   counts, area of twisted lofts, which then matches the ruled surface only to about 1e-3), so it
   is an owner decision, not a converter patch.
5. **Smooth lofts are converted as ruled (5 models; known, warned).** kernelCAD lofts through
   more than two sections without `ruled: true` are smooth surfaces; the converter warns and
   lofts them ruled. Residuals with the probe above: `nature/hill-tile` +31 %,
   `nature/ground-tile` +7.0 %, `wind-energy/wind-turbine-blade` −3.6 %,
   `wind-energy/horizontal-axis-wind-turbine` −0.82 %, `wind-energy/offshore-wind-turbine`
   −0.60 %. Three more (`characters/spider-bot`, `interior/bean-bag`, `interior/toilet`) are
   left at 2.8e-6 to 6.5e-6 after the probe; not investigated.
   Where the volumes agree, 16 of the 17 models whose exact area differs from native by more
   than 1e-6 (2e-6 to 1.5e-3: `props/rowboat`, `marine/fishing-boat`, `marine/motorboat`,
   `nature/palm-tree` above 1e-3) contain lofts; consistent with cause 4 (two triangles do not
   have a ruled quad's area even where the volumes cancel), not checked one by one.

Exact kernel and lab (reported, not fixed here):

6. **Exact `bbox` of trimmed NURBS bodies is very slow (exact kernel 0.1.1).**
   `mining/apron-feeder` `ore-heap` = `subtract(scale([2.3, 1.55, 0.95], sphere(1000)), box)`:
   building it, volume and area take 0.12 s, `bbox()` 203 s (load about 15), with the right
   result. Also `recycling-facility/glass-washer-trommel` `cullet-pile` 166 s,
   `recycling-facility/landfill-liner-roll` `sandbag-2` 178 s,
   `recycling-facility/green-waste-shredder` `mulch-pile` 75 s, `sports/lacrosse-stick` `head`
   58 s, `recycling-facility/near-infrared-sorter` `eject-fraction` 58 s, five more 5–10 s.
   0.1.1's box samples and refines extremes of NURBS faces; 0.1.0's slowest part was 0.7 s.
   Two models hit the 300 s timeout at load 120 and were rerun with 1,500 s.
7. **Lab: a self-intersecting outline builds as a zero-volume body with area (native).**
   `alpine-expedition/alpine-helmet` `chin-strap-0/1`: the outline (±112, 66), (±96, 62),
   (±18, 0), (±4, 6) crosses itself (a bow tie with lobes of 89.0 and 493.0 mm²), extruded
   14 mm. The native build gives each strap volume 0 but area 4,376.8 mm² (= 14 × perimeter
   254.9 + 2 × |signed area| 404) and its box (down to z = 0). That is not a solid: either refuse
   it or build both lobes (8,149.3 mm³). Our converter skips both parts and reports them
   (`partial`); the model's volume agrees, its area (−2.4 %) and box (22 mm) do not.

### Fixes (2026-11-25, second pass)

| Fix | Where | Models / parts | Effect |
| --- | --- | --- | --- |
| `let` loop variables get a fresh binding per iteration (JavaScript semantics), so closures made in a `for` body keep that iteration's value | [`packages/core/src/kcad-import.ts`](../../packages/core/src/kcad-import.ts) | 1 model, 46 parts (`retail-store/roll-cage-trolley`: every wire of the mesh walls was placed at the last row and column; volume unchanged, so only the native box showed it, 1,706 vs 1,700 mm) | box matches native |
| Polyhedron budget of the exact lowering 256 → 2,048 faces (the kernel stitches 2,044 faces in its own tests; the catalog's largest, 578 faces, build in under 1.2 s) | [`packages/exact/src/lower-cad-script.ts`](../../packages/exact/src/lower-cad-script.ts) | 38 parts, 14 models (12-gon lathes, shedded insulators, fuselage lofts) | 9 models agree with native to 6e-10; the 5 aircraft are converter-error (cause 4) and agree to 3.4e-9 with the ruled-loft probe |

Tests: [`tests/kcad-semantics.test.ts`](../../tests/kcad-semantics.test.ts) (closures in `for
(let …)`, body updates of the loop variable, a 578-face 12-gon loft against the closed form).
The parts over 256 faces are polygonal in the source too: the lab builds them as the same
polygonal lofts (volumes agree to 6e-10), not as smooth surfaces.

### Fixes (2026-11-25, first pass)

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

Converter outcome (all 2,402 models, unchanged by the second pass): converted 2,352, partial 19,
unsupported 25, failed 6; 98.7 % of models convert (97.9 % completely), 93.6 % before the
first pass.

### Follow-ups

Converter and CAD Script:

- **Ruled lofts (cause 4, 129 models):** decide whether CAD Script `loft` means the ruled
  surface. If so, split non-planar side quads through their centre (exact ruled volume, see the
  probe) or lower lofts to SMLib's ruled loft in the exact backend. This is the largest
  remaining converter error.
- Smooth lofts (cause 5): need a smooth loft construct in CAD Script.
- Path arcs (`threePointsArc`) are still polygons (16 segments per half turn) when they reach
  CAD Script; no converter-error model was traced to them yet.
- Lofts with different section point counts (12), `shape.hole(s)` (4), `helix` (3).

Exact kernel and lab (to report in the lab):

- `bbox()` of trimmed NURBS bodies takes minutes (cause 6); the box is right.
- Native build of self-intersecting outlines gives zero-volume bodies with area (cause 7).

Harness:

- Use Manifold's double-precision surface area instead of the float32 mesh (removes cause 2).

### Kernel versions

The first full run (before the converter fixes) used the exact kernel as it was before the
2026-11-25 move into `@crispcad/exact-kernel`; the 0.1.0 runs used the merged kernel 0.1.0
(the numbers in the "0.1.0" column above, catalog at lab `d09cda7f6`). The runs above use
`@crispcad/exact-kernel` 0.1.1 (same SMLib build, `@classcad/smlibwasm` 0.6.2).
