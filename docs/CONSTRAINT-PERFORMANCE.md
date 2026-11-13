# Constraint performance and deployment decision

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

## Recommendation

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
