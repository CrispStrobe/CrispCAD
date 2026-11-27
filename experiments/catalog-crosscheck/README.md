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
[--name n] [--native file] [--lab-commit sha] [--loft-revision 1|2]`. `--loft-revision 1` rebuilds
the converted lofts with CAD Script's revision-1 triangulation (one fixed diagonal per side quad)
instead of the ruled surfaces the converter writes (revision 2, the default), for comparison. Models are processed by `--jobs` worker
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

**Lofts (since 2026-11-26).** Where a loft's mesh is not its exact surface, the tolerance adds a
loft term, quad by quad ([`src/tolerance.ts`](src/tolerance.ts), `quadDifference`). That is every
twisted side quad of a revision-2 `loft` (Manifold meshes the four-triangle fan around the corners'
mean, the exact kernel the ruled surface) and every quad between two slices of a `smoothLoft`
(Manifold meshes the sampled slices, the exact kernel the smooth surface). For each quad the
harness measures, against the exact surface over it, the signed area difference (8 × 8
Gauss-Legendre), the signed enclosed-volume difference and the unsigned gap volume (6 × 6
sub-triangles per mesh triangle, distance along the triangle's normal) and the largest normal
distance (thickness). It then asks whether a Boolean can cut the quad: the quad's box (in the part's
coordinates, through every enclosing transform) is tested against the conservative boxes
(`shapeBoundsBySide`) of the other operands of every enclosing union, subtraction and intersection,
of the other copies of a `repeat`, and of anything under a hull, Minkowski sum or resize.

- A quad nothing can reach ends up whole in the result: only the sums count, |Σ area difference|
  and |Σ volume difference| (0 for ruled fans, whose volume is the ruled volume; the sampling error
  for smooth lofts).
- A quad some operand reaches may be cut: the allowance takes its unsigned gap volume, its
  |area difference| and 2 · thickness · extent for the cut faces that cross the gap.

Twice these sums are added to the volume and area allowances, and a smooth loft's thickness to the
box allowance. Parts with loft quads (`loftQuads`, `exposedQuads`, `loftArea`, `loftVolume` in the
record's tolerance) are not counted as planar. Until 2026-11-26 every twisted quad counted as cut
(twice its unsigned gap), which made the allowance loose: median 2.6 % of a ruled part's volume
against a real median difference of 1.2e-8. It is now at the 1e-6 floor for the median part and
above 1e-3 for 21 of 1,873 loft parts (`containers/wicker-basket` `body`, 6.3 %, the largest: a
basket whose cutter box overlaps every quad), and the cut faces have their own area term.

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

## Results: exact kernel 0.1.9, native catalog 2,402 of 2,402 (2026-11-27)

Measured 2026-11-27 on the same machine (load average 65 to 160 from other sessions, three
workers, 21.5 min wall), Node 26.4.0, `@crispcad/exact-kernel` 0.1.9 (smlibwasm 0.6.2 built from
source), CrispCAD main `6195d6c`, unchanged harness. A run on 0.1.7 (CrispCAD `b67ab77`, two
workers, 179 min wall at load 60 to 180) the same day gave the same Manifold and exact volume and
area for all 138,640 part builds, so 0.1.8 and 0.1.9 change nothing here. **Catalog: kernel lab
`4bd3ee9c9`** (catalog and native lowering unchanged up to `develop` `790f2ba93`); **native volumes: the lab's committed `results-catalog-native-volumes.json`,
measured on `763f97d2d`** (2,402 of 2,402; the lab's native lowering is unchanged between the two,
and its 2026-11-27 re-measurement on `4bd3ee9c9` builds 2,402 of 2,402 again). This is the rerun
for Phase 5.4 (the lab's last 11 native gaps, closed in lab `b24fe9b95`). Of those 11, our side
builds one completely: `amusement-park/miniature-park-tram-engine` agrees in all three builds. Two
convert partially because our converter skips their self-touching outlines (`skid-steer-loader`
door frame, `impulse-merchandiser` uprights), and the rest of each agrees. Eight are refused by
the converter for the features the lab added natively: `helix` sweeps (`beam-coupling`,
`grit-classifier`, `spiral-concentrator`), `shape.holes` and `prismSideY` side holes
(`plate-heat-exchanger`, `pipe-roller-stand`), several `moveTo` in one path
(`hydroponic-grow-rack`), a loft on a plane other than XY (`rock-arch`) and a part box over the CAD
Script limits (`batting-helmet`). They are in the 31 converter failures, unchanged. Files: [`results/full-summary.md`](results/full-summary.md),
[`full-summary.json`](results/full-summary.json), [`full-models.json`](results/full-models.json),
[`full-run.json`](results/full-run.json).

| Full catalog | 0.1.3, smooth lofts (lab `587e964cd`) | **0.1.9 (lab `4bd3ee9c9`)** |
| --- | ---: | ---: |
| Three-way all-agree | 2,358 | **2,336** |
| Converter-error | 2 | **24** (native pairing, below) |
| Converter-partial / -failed | 11 / 31 | 11 / 31 |
| Native-failed | 0 | 0 |
| Manifold vs exact: models agree / disagree | 2,353 / 18 | 2,353 / 18 |
| Parts agree / disagree | 69,340 / 49 | 69,340 / 49 |
| Exact area = native area to 1e-6 (of volume-agreeing) | 2,358 of 2,358 | 2,336 of 2,336 |
| Exact CPU (total, slowest part) | 720 s, 3.0 s | 1,315 s, 5.4 s (machine load) |

**No CrispCAD build changed.** Manifold and exact give the same model totals as the 0.1.3 run (to
the seven significant digits `full-models.json` records) and the same part and Manifold-vs-exact
classes for every model (the 0.1.4 to 0.1.9 kernel changes do not touch what CrispCAD's lowering
passes). The
three-way changes all come from the lab's native column, which since `6005ce246` and `88eeb9123`
lofts the `.kcad.ts` sources as OpenCASCADE's ThruSections does:

- **21 models: loft sections re-started by ThruSections.** For sections with equal vertex counts
  ThruSections moves each section's start vertex to where it lies closest to the previous one
  (`ComputeOrigin`; lab `docs/kernels.md`, "How OCCT pairs sections"). The lab's native build now
  does the same and matches OCCT to 5.7e-10 part by part; CrispCAD's `loft` joins vertex i to
  vertex i as written (the kernel's default `pairing:'authored'`), so the converted programs give
  the as-drawn volume, the one the lab's native build gave before. E/N − 1: `nature/tumbleweed`
  −4.7e-3, `interior/hanging-planter` −3.2e-3, `terrain/river-bend-tile` −1.2e-3, then
  `terrain/mountain-peak`, `nature/stone-slab`, `termite-mound`, `rock`, `rock-pillar`,
  `ruins-column-tile`, `hill-tile`, `boulder-cluster`, `bramble`, `trash-bags`, `bird-nest`,
  `props/sack`, `cairn`, `snowy-fir-tree`, `pebble-cluster`, `bonsai-tree`, `props/scarecrow`,
  `terrain/rocky-ground-tile` (−2.7e-5). These are exactly the 20 models plus `hill-tile` that the lab lists as
  changed by the pairing, with the same magnitudes. `nature/hill-tile`'s exact volume
  (2,159,889,707 mm³) equals the lab's as-drawn build at `6005ce246` to the unit; `nature/ground-tile`
  now agrees (it needed only the as-drawn fix). Converted programs would need a CAD Script loft
  option that pairs as ThruSections does (the kernel's `pairing:'closest'`, plus the same rule in
  the Manifold mesh) to match; that is a language change for converted programs only, not made here.
- **3 wind-turbine models: smooth lofts.** `wind-energy/wind-turbine-blade` exact 47,061,112.54 mm³
  is unchanged and equals the lab's native build before `6005ce246` (47,061,112.51), which lofted
  the airfoil sections as faces; since then the lab lofts them as wires through the same vertices
  and SMLib's smooth skin comes out 6.2e-4 smaller (47,032,083.12; `horizontal-axis` +1.1e-4,
  `offshore` +7.1e-5 for the whole models). The pairing is the same as drawn; OCCT, which
  approximates one B-spline surface through all sections, differs from both by more (up to 4.5e-2
  per blade part, lab `docs/kernels.md`). Neither SMLib result is the reference.
- The partial and refused conversions are the same 11 and 31 as before.

## Results: smooth lofts, exact kernel 0.1.3 (2026-11-26, second run)

Measured 2026-11-26 on the same machine (load average 35–134), Node 26.4.0,
`@crispcad/exact-kernel` 0.1.3, CrispCAD main `70a2fda` plus this commit's harness: CAD Script
`smoothLoft` ([CODE-MODE.md](../../docs/CODE-MODE.md#smooth-lofts)), which the converter now writes
for kernelCAD's smooth lofts (more than two sections without `ruled: true`), and the
[loft allowance](#tolerance) from reachable quads. **Catalog and native volumes: kernel lab
`587e964cd`** (`origin/develop`; `results-catalog-native-volumes.json` measured on `ef07c30bf`,
where the lab fixed the 8 models with self-crossing outlines: **2,402 of 2,402 built natively**).
One segment, four workers, 5.8 min wall, 2,402 models, 69,389 converted parts:
[`results/full-summary.md`](results/full-summary.md), [`full-summary.json`](results/full-summary.json),
[`full-models.json`](results/full-models.json), [`full-run.json`](results/full-run.json). Sample
(300 models, same seed, 1.3 min): all-agree 294, converter-failed 3, converter-partial 2,
converter-error 1 (`nature/ground-tile`), [`results/sample-300-summary.md`](results/sample-300-summary.md).

| Full catalog | 0.1.3, ruled (lab `5ea9d18f3`) | **0.1.3, smooth lofts (lab `587e964cd`)** |
| --- | ---: | ---: |
| Three-way all-agree | 2,347 | **2,358** |
| Converter-error | 5 | **2** (a native-build issue, below) |
| Converter-partial / -failed | 11 / 31 | 11 / 31 |
| Native-failed (self-crossing source outlines) | 8 | **0** (fixed in the lab's catalog) |
| Manifold vs exact: models agree / disagree | 2,354 / 17 | 2,353 / 18 |
| Parts agree / disagree | 69,325 / 42 | 69,340 / 49 |
| Exact area = native area to 1e-6 (of volume-agreeing) | 2,347 of 2,347 | **2,358 of 2,358** |
| Exact CPU (total, slowest part) | 1,310 s, 5.2 s | 720 s, 3.0 s |

- **The three wind-turbine models with smooth lofts agree with native to 1e-9**:
  `wind-energy/wind-turbine-blade` exact 47,061,112.54 mm³ against native 47,061,112.51
  (ruled: −3.6 %), `horizontal-axis-wind-turbine` 386,600,483.5 (−0.82 %),
  `offshore-wind-turbine` 952,565,202.6 (−0.60 %). Manifold samples the 14 smooth blade and tip
  parts within 3.7e-6 to 6.3e-5 of the exact volume, inside their allowance.
- **The 8 formerly self-crossing models** (lab `ef07c30bf`) convert completely and agree in all
  three builds.
- **The 2 converter errors left are a native-build issue, not the converter's:**
  `nature/hill-tile` (E/N − 1 = +30.9 %) and `nature/ground-tile` (+7.0 %) use **ruled** lofts
  (`ruled: true`, so not smooth lofts) from a square drawn as eight points (corners and edge
  midpoints, "so it lofts to an octagon", says the source) to an octagon. The lab's native lowering
  builds sections as `makeFace(new Wire(lines))`, and for this square, whose consecutive edges are
  collinear, SMLib starts the section curve at another vertex, so vertex *i* of the square is joined
  to the wrong octagon vertex and the side faces twist through the middle. Building the same
  sections through the exact kernel's `profile.path` (the same wire construction) reproduces the
  native volume exactly (grass 1,059,613,212 + outcrop 30,089,040 + dirt 560,000,000 mm³ for the
  hill; grass 307,682,982 + dirt for the ground tile); `profile.polygon`, which our lowering uses,
  keeps the authored correspondence and gives our number, as OCCT's ThruSections would. Reported
  for the lab to fix (build loft sections as polygons, or keep the authored vertex order).
- **Manifold against exact:** 49 parts in 18 models disagree, all planar Manifold numerics
  (causes 1–3 below: 21 volumes at the 1e-6 floor, 25 float32 mesh areas, 3 faces of touching
  operands). `interior/toilet` `bowl` now agrees (volume 6.2e-6, area 5.9e-5 against an area
  allowance of 3.3e-3, mostly the new cut-face term); `airfield/private-jet` `winglet-port` and
  `winglet-starboard` (1.19e-6) and `nature/baobab-tree` `tuft-1` (1.14e-6) were hidden by the old
  loose ruled-loft allowance and now show as what they are, float32 vertices far from the origin
  (cause 1). No part is unsupported by or fails in the exact kernel.
- **Loft allowance:** 1,873 loft parts, 69 of them with quads an operand can reach; median
  allowance 1.0e-6 of the volume (real |ΔV|/V 1.3e-8) and 1.0e-5 of the area (real 2.6e-7);
  was 2.6 % of the volume.

**Toilet bowl and the four-triangle fan.** The bowl's twisted quads (36, of which a Boolean can
reach 28) differ from the ruled surface by at most 0.32 mm on 215 mm quads (thickness/extent
1.5e-3); the cut changes the Manifold build by 179 mm³ (6.2e-6) and 51 mm² (5.9e-5) against the
exact one, which equals native. That is a real but small faceting effect of the same kind as
48-segment circles (2.9e-3), and it only appears where a Boolean cuts a twisted quad; uncut ruled
lofts keep the exact ruled volume. Subdividing strongly twisted quads (a tolerance-based split
count) would shrink it but would change revision-2 geometry and so need a revision 3; not done.

## Earlier results: ruled lofts, exact kernel 0.1.3 (2026-11-26)

The result files of this run were replaced by the run above (the triangulated `full-diagonal-*`
files are still this run's); kept for the history of the loft fixes.

Measured 2026-11-26 on the same 8-core Apple M1 shared with other sessions (load average
28–183), Node 26.4.0, **`@crispcad/exact-kernel` 0.1.3**, CrispCAD main `8c0f8c1` (CAD Script
revision 2: `loft` builds ruled side surfaces, see
[CODE-MODE.md](../../docs/CODE-MODE.md#language-revisions); the converter writes its lofts in
revision 2). Catalog at kernel-lab `c1548dbda` (`origin/develop`; `catalog/kits` identical to
`e6ff5d3fc` and `e203019d8`). **Native volumes: lab commit `5ea9d18f3`**
(`results-catalog-native-volumes.json`, measured on lab `e203019d8`, 2,394 of 2,402 built; the
eight it now refuses are self-crossing outlines, see below). Two full runs, each 2,402 models
and 69,367 converted parts with four workers in one segment:

- **ruled** (the converter's revision-2 programs, 11.2 min): [`results/full-summary.md`](results/full-summary.md),
  [`full-summary.json`](results/full-summary.json), [`full-models.json`](results/full-models.json),
  [`full-run.json`](results/full-run.json);
- **triangulated** (`--loft-revision 1`, the same programs at revision 1, i.e. what CAD Script
  built before, 25.5 min at load 90–160): [`results/full-diagonal-summary.md`](results/full-diagonal-summary.md)
  and the same three files.

Sample (300 models, seed `crosscheck-1`, ruled, 1.6 min: agree 294, disagree 3, converter-failure 3;
9,379 parts): [`results/sample-300-summary.md`](results/sample-300-summary.md),
per part in [`sample-300.jsonl`](results/sample-300.jsonl). The full runs' JSONL (39 MB each) are not
committed.

### Headline: old against new

| Full catalog | 0.1.1, triangulated (2026-11-25) | 0.1.3, triangulated | **0.1.3, ruled** |
| --- | ---: | ---: | ---: |
| Models agree (Manifold vs exact) | 2,350 | 2,350 | **2,354** |
| Models disagree | 20 | 20 | **17** |
| Models with an exact-kernel failure | 1 | 1 | **0** |
| Parts agree / disagree / exact-failure | 69,307 / 56 / 4 | 69,307 / 56 / 4 | **69,325 / 42 / 0** |
| Three-way all-agree | 2,215 | 2,214 | **2,347** |
| Three-way converter-error | 137 | 137 | **5** |
| Exact area = native area to 1e-6 (of volume-agreeing) | 2,198 of 2,215 | 2,198 of 2,214 | **2,347 of 2,347** |
| Exact CPU (total, slowest part) | 1,753 s, 187 s | 1,350 s, 5.6 s | 1,310 s, 5.2 s |

The 0.1.1 → 0.1.3 kernel step changes no class: the triangulated run on 0.1.3 reproduces every
0.1.1 model class against the same native column, except that the lab's refreshed native file
now refuses eight models (below). All the movement is the loft:

- **132 of the 137 converter-error models become all-agree**, e.g.
  `fire-station/bay-warning-beacon` 10,005,913.21 mm³ against native 10,005,913.19 (E/N − 1 =
  2.0e-9; triangulated −1.9 %), `containers/wicker-basket` 2.3e-9 (−2.1 %), `nature/flower-patch`
  1.2e-10 (−8.7 %), and the three that the reverted probe left at ≤ 6.5e-6
  (`characters/spider-bot`, `interior/bean-bag`, `interior/toilet`) now agree to 9e-10: the
  exact kernel builds the ruled surface itself, where the probe faceted it.
- **`nature/tumbleweed` builds and agrees** (exact 91,689,392.15 against native
  91,689,392.10, 5.6e-10; triangulated, Manifold lost 53 % and the exact kernel refused it).
- **No model gets worse** (model by model against the 0.1.3 triangulated run).
- **The exact area now matches native** wherever the volumes agree (2,347 of 2,347 to 1e-6;
  triangulated 2,198), and so do the boxes (1e-3 mm).

### Three-way: Manifold, exact, native (0.1.3, ruled)

| Three-way class | Models | Sample (300) |
| --- | ---: | ---: |
| all-agree | **2,347** | 292 |
| converter-failed | 31 | 3 |
| converter-partial | 11 | 2 |
| native-failed (self-crossing source outlines) | 8 | 2 |
| converter-error (smooth lofts) | 5 | 1 |
| exact-error, manifold-error, exact-failed, unresolved | 0 | 0 |

**The remaining disagreements are only smooth lofts, partial conversions, conversions that are
refused, and source models with self-crossing outlines.** None is the exact kernel's or
Manifold's:

- **converter-error (5): smooth lofts converted as ruled (cause 5).** kernelCAD lofts through
  more than two sections without `ruled: true` are smooth surfaces; the converter warns and
  builds them ruled. E/N − 1: `nature/hill-tile` +30.9 %, `nature/ground-tile` +7.0 %,
  `wind-energy/wind-turbine-blade` −3.6 %, `wind-energy/horizontal-axis-wind-turbine` −0.82 %,
  `wind-energy/offshore-wind-turbine` −0.60 %. Needs a smooth loft in CAD Script.
- **converter-partial (11).** The converter skips parts it cannot express (unordered loft
  sections, nesting over 32, self-crossing outlines) and reports them: `archaeology-fieldwork/hand-auger`,
  `containers/amphora`, `food-kitchen/apple`, `lighting/brazier`, `retail-store/handbasket`,
  `retail-store/shopping-basket`, `retail-store/impulse-merchandiser`,
  `amusement-park/picnic-table-with-umbrella`, `amusement-park/churro-warmer-cart`,
  `construction-equipment/skid-steer-loader`, `mining/rotary-blasthole-drill`.
- **converter-failed (31).** Unchanged: lofts with different section point counts 12,
  `shape.hole(s)` 4, `helix` 3, `prismSideY` 3, part over the CAD Script limits 3, others 6.
- **native-failed (8): source-model problems, not a kernel or converter fault.** The lab's
  native build now refuses self-crossing outlines ("The polygon outline crosses itself at …"),
  as exact kernel 0.1.3 does and OCCT also gives invalid solids for them:
  `alpine-expedition/alpine-helmet`, `amusement-park/miniature-park-tram-coach`,
  `amusement-park/miniature-park-tram-engine`, `industrial-plant/industrial-boiler`,
  `mining/magnetic-separator-drum`, `recycling-facility/cover-soil-spreader`,
  `recycling-facility/tipping-floor-bin`, `recycling-facility/weighbridge-approach-ramp`.
  **Our converter already does the sensible thing with all eight:** it skips exactly the
  self-crossing parts (1–5 per model) with a reason and converts the rest (`partial`); every
  converted part builds in both kernels and they agree (model class `agree`). Seven of them
  were `converter-partial` and the helmet `all-agree` against the previous native file, whose
  bow ties counted with signed, partly negative volume (cause 7). Nothing reaches Manifold or
  the exact kernel as a self-crossing outline: CAD Script refuses such `extrude` outlines and
  loft sections itself.

### Manifold against the exact kernel (0.1.3, ruled)

42 parts in 17 models disagree. 41 are the planar Manifold numerics of causes 1–3 below
(13 volumes at the 1e-6 floor: `airfield` winglets, sharklets and cheatlines up to 7.4e-6,
float32 vertices 600 mm from the origin; 25 float32 mesh areas far from the origin; 3 faces of
exactly touching operands). One is new and comes from the ruled lofts:
`interior/toilet` `bowl`, where a Boolean cuts through twisted loft quads. Manifold cuts the fan
and the exact kernel the ruled surface, so the cut faces differ: volume 6e-6 (within the
allowance), area 51 mm² against an allowance of 28 mm². The exact build is the right one
(exact = native to 5e-11 in volume, 1e-10 in area). The 50,722 planar agreeing parts agree to
9.7e-7 at worst.

726 parts in 156 models have twisted ruled-loft quads. Manifold meshes their fans, the exact
kernel builds the ruled surfaces: the volumes are identical, so they agree to 1.2e-8 (median)
unless a Boolean cuts a twisted quad. Only 11 differ by more than 1e-6: the 8 `airfield` wing
parts above and three cut lofts (`characters/spider-bot` `turret`, cut by a box: Manifold
+1.3e-4 against exact, which equals native; `interior/bean-bag` `sack` 7e-6; the toilet bowl).
The [ruled-loft allowance](#tolerance) is a bound for such cuts and is loose (median 2.6 % of a
part's volume, up to 25 % for the strongly twisted tumbleweed stars), so for these parts the
agreement is better read from the numbers than from the class.

Exact CPU 1,310 s in total, median part 6.7 ms, slowest 5.2 s (0.1.1: 1,753 s and 187 s; the
bbox was fixed in 0.1.2). Building a twisted loft as SMLib's ruled loft instead of a stitched
polyhedron costs nothing measurable.

## Earlier results: triangulated lofts, exact kernel 0.1.1 (2026-11-25)

The result files of this run were replaced by the runs above; it is kept for the history of
the fixes. Cause 4 (ruled lofts) is fixed by CAD Script revision 2, cause 6 by exact kernel
0.1.2, and cause 7 by the lab's native build and exact kernel 0.1.3 (both refuse self-crossing
outlines).

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

### Manifold against the exact kernel (0.1.1)

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

### Three-way: Manifold, exact, native (0.1.1)

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

- ~~Ruled lofts (cause 4)~~: **done 2026-11-26**, CAD Script revision 2 (both: the mesh fans
  twisted quads around their centre, the exact backend builds SMLib's ruled loft).
- Smooth lofts (cause 5, the last 5 converter errors): need a smooth loft construct in CAD
  Script.
- Path arcs (`threePointsArc`) are still polygons (16 segments per half turn) when they reach
  CAD Script; no converter-error model was traced to them yet.
- Lofts with different section point counts (12), `shape.hole(s)` (4), `helix` (3).

Exact kernel and lab (to report in the lab):

- ~~`bbox()` of trimmed NURBS bodies takes minutes (cause 6)~~: fixed in 0.1.2.
- ~~Native build of self-intersecting outlines gives zero-volume bodies with area (cause 7)~~:
  the lab's native build (lab `5ea9d18f3`) and exact kernel 0.1.3 refuse them.

Harness:

- Use Manifold's double-precision surface area instead of the float32 mesh (removes cause 2).
- A tighter ruled-loft allowance (only the quads a Boolean actually cuts), and one for the cut
  faces' area (`interior/toilet` `bowl`).

### Kernel versions

The first full run (before the converter fixes) used the exact kernel as it was before the
2026-11-25 move into `@crispcad/exact-kernel`; the 0.1.0 runs used the merged kernel 0.1.0
(the numbers in the "0.1.0" column above, catalog at lab `d09cda7f6`). The runs above use
`@crispcad/exact-kernel` 0.1.1 (same SMLib build, `@classcad/smlibwasm` 0.6.2) for the
2026-11-25 results and 0.1.3 for the 2026-11-26 results (same SMLib build; 0.1.2 made `bbox()`
fast, 0.1.3 refuses self-crossing profiles), and 0.1.9 for the 2026-11-27 results (smlibwasm
0.6.2 built from source, byte-identical to the npm binary; 0.1.7 gave identical results). The run files record the SMLib build, not the
kernel package version; their `note` field names it.
