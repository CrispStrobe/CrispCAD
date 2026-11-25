# Catalog cross-check: kernelCAD catalog through Manifold and the exact kernel

Phase 4 of [CRISPCAD-CONVERGENCE.md](../../docs/CRISPCAD-CONVERGENCE.md#phase-4-cross-checking-with-the-catalog).
The kernel lab's 2,402-model kernelCAD catalog is converted to CAD Script with our
[converter](../../docs/CODE-CONVERTERS.md#kernelcad-kcadts-models-2026-11-24), and every
converted part is built twice: with Manifold (the product kernel, `packages/geometry`) and
with the SMLib exact B-rep experiment ([`../exact-kernel`](../exact-kernel/README.md),
`lower-cad-script.ts`). The two builds are compared on volume, area and bounding box
within a tolerance derived from the segment counts in each part. A third column, the lab's
own native SMLib volumes, is an optional input (see [Native volumes](#native-volumes)).

**Status: experiment only.** Nothing here is shipped or imported by `packages/*`. No
catalog source or converted CAD Script is committed: `results/` holds only per-model
metadata (catalog path, SHA-256, numbers, error messages).

## Run

```sh
npm ci                                      # repository root (Manifold, cad-core, TypeScript)
npx tsc -b packages/core packages/geometry
(cd experiments/exact-kernel && npm ci)     # @classcad/smlibwasm, only for the experiment
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
(`docs/kernels.md` reports only build success for 2,344/2,402 and a 74-model OCCT
comparison). `--native <file>` (for `run.ts` or `summarize.ts`) accepts

```json
{ "kernel": "smlib-native", "labCommit": "<sha>",
  "models": {
    "kits/<kit>/<model>.kcad.ts": { "status": "ok", "volumeMm3": 12345.6 },
    "kits/<kit>/<other>.kcad.ts": { "status": "error", "error": "recompute.kernel.unsupported-feature: mate" } } }
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

RESULTS_PLACEHOLDER
