# Constraint performance and deployment decision

## Current numerical module: fresh measurements

The current MIT dart_csp 2.4.0 pin is
`894a11d74dae312ca99578532b27cca0b51fd34f`. Its persistent geometric module
changes the deployment recommendation: integrate it behind the CAD worker
boundary, keeping the current model/history graph authoritative. The interval
measurements retained below describe the old pin, not the new numerical solver.

An independent original probe ran with Dart 3.12.2 on Mac arm64, Chromium 151
and WebKit 26.5. Each warm edit changes the shared fixed radius and resolves all
independent 3D point components. Hard coordinate/length residuals are checked
outside the solver (maximum observed error 3.33e-8 in the axis fixtures), with
zero local freedoms. A separate plane/circle soft drag preserves one freedom
and stays below 7.99e-8 hard residual while approaching its target.

Median warm edit time, milliseconds (7 samples after 2 warmups):

| Browser | Points / coordinates | JS | Wasm |
| --- | --- | ---: | ---: |
| Chromium | 10 / 30 | 2 | 2.2 |
| Chromium | 100 / 300 | 15 | 3.4 |
| Chromium | 500 / 1500 | 46 | 9.9 |
| WebKit | 10 / 30 | 1 | 1 |
| WebKit | 100 / 300 | 10 | 4 |
| WebKit | 500 / 1500 | 37 | 13 |

For 500 points, Wasm p95 was 15.5 ms in Chromium and 15 ms in WebKit; cold solve
was 53/36 ms, excluding compile and worker startup. JS cold solve was 121/103 ms.
The one-point soft drag was at or below one millisecond median; timer granularity
limits the meaning of those small measurements, especially reported zeros.

These are independent components, not a general coupled-sketch stress test. A
separate upstream coupled 72-coordinate chain passed its independent cold/edit
checks; it was not used for the table. WebKit used an emulated iPad browser profile
on this Mac, so these numbers do not qualify our physical iPad or every iPadOS
Wasm feature set. The existing browser harness enforces a 30-second worker deadline.
Persistent-worker cancellation and superseded-result handling still need an app
adapter. Rendering, feature regeneration and message transfer add further latency.

The compiled probe was 141,932 JS bytes, or 114,546 Wasm bytes plus an 11,813-byte
loader. These describe this probe's tree-shaken closure, not a full CAD backend.
[Raw browser data](../experiments/constraints/results/geometric-macos-arm64-2026-11-13.json)
includes samples, startup, independent checks, exact pin and artifact/source hashes.
[Reproduction instructions](../experiments/constraints/geometric/README.md) keep
artifacts outside production assets. Full solver correctness and difficult branch
continuation are not established by these probes.


## Coupled sketch comparison with kernelCAD's solver — 2026-11-24

kernelCAD ships an 810-line MIT TypeScript sketch solver: Gauss–Seidel relaxation
over per-constraint projections, 100 sweeps, with an aggregate residual verdict.
We compared it with the dart_csp geometric session on one coupled, fully
constrained fixture: a ladder of N rectangular bays (fixed corner, horizontal rails,
vertical rungs, per-bay widths), solved cold from the same perturbation and then
after width edits, with coordinates checked against the analytic answer. Linux x64
container (Xeon 2.3 GHz); kernelCAD on Node 22, dart_csp on the Dart 3.12.2 VM (JIT).
[Harness and raw data](../experiments/constraints/sketch-compare/README.md).

| Bays (2D coords) | kernelCAD cold | kernelCAD edit (median) | dart_csp cold | dart_csp edit (median) |
| --- | --- | --- | --- | --- |
| 4 (20) | 0.7 ms, 2.2e-3 mm | 0.5 ms, 2.4e-3 mm | 54 ms, 4e-10 mm | 3.8 ms, 1.5e-8 mm |
| 16 (68) | 0.5 ms, 5.5e-2 mm | 0.4 ms, **1.1 mm**, not converged | 31 ms, 3e-9 mm | 4.7 ms, 6e-8 mm |
| 64 (260) | 3.8 ms, 5.6e-2 mm | 0.7 ms, **2.0 mm**, not converged | 46 ms, 2e-8 mm | 29 ms, 2e-7 mm |

Errors are the worst coordinate deviation. kernelCAD's cold solves report
`converged` while 0.05 mm off, because its verdict threshold (0.5 aggregate) is
loose by design. Raising its cap to 10,000 sweeps still left the 64-bay edit 0.12 mm
off, at a 68 ms median, slower than dart_csp; per-constraint dead bands (1e-3 mm
for distances) accumulate along the chain. It has no Jacobian, no degree-of-freedom
or rank report, and no drag targets.

Decision: keep the dart_csp worker-adapter plan. kernelCAD's relaxation suits
small interactive previews only. Its constraint vocabulary (coincident, distance,
horizontal/vertical, parallel/perpendicular, tangent, radius, angle, concentric,
symmetric, equal length) is a useful checklist for our sketch schema. dart_csp's
absolute times here are native-VM; browser JS/Wasm numbers are in the section above.

## Historical interval-only measurements

The pinned dart_csp interval solver compiles to JavaScript **and Dart/Wasm** and
runs inside browser workers in Chromium 151 and Playwright WebKit 26.5. This is
Mac arm64 testing with an iPad browser profile, not a physical-iPad benchmark.
Dart 3.12.2, solver commit 13f2b04925443a75b6766c969b10aefc65978a0e.
The raw [results](../experiments/constraints/results/macos-arm64-2026-11-13.json)
include all cases, failures, startup measurements, residuals and sample details.

Median solve time in milliseconds, seven measured samples after two warmups:

| Browser | Case | JavaScript | Wasm | Outcome |
| --- | --- | ---: | ---: | --- |
| Chromium | 500-point anchored linear chain, 1,000 variables | 8 | 3.9 | Validated |
| WebKit | Same linear chain | 8 | 4 | Validated |
| Chromium | 10 circle/line pairs, 20 decision variables | 2,353 | 1,354 | Search budget exhausted; no solution returned |
| WebKit | Same nonlinear model | 1,269 | 1,390 | Search budget exhausted; no solution returned |

These are synthetic formulations, not general CAD workloads. The nonlinear pairs
are deliberately in one model without component decomposition; individually they
are easy. This exposes a missing solver capability, not proof that every nonlinear
sketch of that size is hard. At 50 nonlinear pairs both backends exceeded the
30-second worker deadline. Underconstrained systems also expose recursion limits:
Wasm overflowed at 50/100 free pairs in both browsers; WebKit JavaScript did too.
JavaScript Stopwatch measurements have millisecond granularity here. Normal Mac
background work and build activity can affect timings; do not infer universal
speed ratios from this run. Returned points were independently residual-checked;
null/budget failures have no accepted geometric result.

## Historical recommendation for the interval-only pin

Do not port the existing interval search merely to change language. Improve the
algorithm: connected-component decomposition, warm starts, sparse/rank-aware
geometric equations, a nearest-previous-placement objective, iterative bounded
execution, cancellation and explicit outcome statuses. Keep interval/discrete
search for design exploration and bounded branch initialization. The existing
interval search is not ready to drive arbitrary sketches on every pointer move.

Develop that geometric module in Dart behind the backend-neutral sketch contract.
Compile it to Wasm in a persistent worker, with a JavaScript fallback for unsupported
WebKit versions. Benchmark real repeated drags and startup separately on the
physical iPad before production adoption. If profiling then shows a numerical hot
loop that Dart cannot meet, extract that small backend to a qualified permissive
Rust/C++ Wasm module; avoid maintaining a second full solver by translation.

The tested compiled artifacts were 79,923 bytes of JS, or 57,005 bytes of Wasm plus
11,841 bytes of runtime loader, before transfer compression. Those sizes describe
this isolated experiment, not a full application or future geometric solver.
Dart/Wasm depends on browser WasmGC/string/exception features; compiling a `.wasm`
file is not proof of support on every supported iPadOS version. See the official
[Dart Wasm requirements](https://dart.dev/web/wasm).

## Reproduce

```sh
cd experiments/constraints
dart pub get
mkdir -p /tmp/brickwright-cad-constraint-bench
dart compile js -O2 benchmark_web.dart -o /tmp/brickwright-cad-constraint-bench/bench.js
dart compile wasm benchmark_web.dart -o /tmp/brickwright-cad-constraint-bench/bench.wasm
cd ../..
PLAYWRIGHT_BROWSERS_PATH=/tmp/brickwright-cad-browsers \
  node experiments/constraints/browser-benchmark.mjs /tmp/brickwright-cad-constraint-bench
```

The harness starts a loopback server, creates dedicated workers, reports startup
separately, enforces a worker deadline and writes a JSON report. No benchmark or
Dart runtime is added to the production app. Compare the [architecture](CONSTRAINTS.md)
for the next solver milestone.
