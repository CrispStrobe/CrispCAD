# Current geometric-solver probe

Independent BSD harness against MIT dart_csp **2.4.0**, pinned at
`894a11d74dae312ca99578532b27cca0b51fd34f`. This is an isolated development
experiment, excluded from the app, SDK runtime dependency closure and native bundles.
It does not replace the historical interval-only experiment in the parent folder.

The axis fixture has 10/100/500 independently constrained 3D points. A fixed
radius edit invalidates every component in one persistent numerical session.
Each returned point is checked independently against its positive-axis coordinate,
length and perpendicular coordinates, with a 2e-7 limit. The drag fixture keeps
one point in a plane and on a circle while soft targets move it around that circle.
Its required residuals and approach to the soft target are checked separately.
Each case checks the reported local degrees of freedom.

```sh
cd experiments/constraints/geometric
dart pub get
dart run probe.dart
mkdir -p /tmp/brickwright-geometric-bench
dart compile js -O2 benchmark_web.dart -o /tmp/brickwright-geometric-bench/bench.js
dart compile wasm benchmark_web.dart -o /tmp/brickwright-geometric-bench/bench.wasm
cd ../../..
PLAYWRIGHT_BROWSERS_PATH=/tmp/brickwright-cad-browsers node experiments/constraints/browser-benchmark.mjs /tmp/brickwright-geometric-bench /tmp/geometric-results.json experiments/constraints/geometric/config.json
```

Results retain cold solve/compile time, seven warm edit samples after two warmups,
residuals, freedoms, component counts and worker startup separately. Browser
Stopwatch precision can be one millisecond: zero does not mean no computation.
A 30-second worker deadline protects the harness. These synthetic independent
components do not establish performance on a large coupled sketch or a physical
older iPad. The production worker adapter, sketch entity schema, cancellation,
stale-result handling and integration with the existing feature/history model
remain to be implemented.

See the [measured results](../results/geometric-macos-arm64-2026-11-13.json)
and [deployment assessment](../../../docs/CONSTRAINT-PERFORMANCE.md).
