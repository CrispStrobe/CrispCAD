# Sketch solver comparison: dart_csp vs kernelCAD relaxation

Development experiment only; nothing here ships. `kcad/` holds kernelCAD's MIT
sketch solver (`src/modeling/constraints/solver.ts`, `types.ts`) copied unmodified
from kernelCAD-web `964fa6cfe94ecf16c2c44b94770846ae23665d82` with its headers.
dart_csp is pinned at `894a11d74dae312ca99578532b27cca0b51fd34f` (MIT).

Fixture (`fixture.json`): a ladder of N rectangular bays, a coupled and fully
constrained 2D sketch — fixed origin corner, horizontal rails, vertical rungs, one
width per bay and one height. Both solvers start from the same deterministic
±1.5 mm perturbation; then bay 0's width alternates 12/10 mm (7 measured edits
after 2 warmups). Coordinates are checked independently against the analytic
solution; solver-reported convergence is recorded separately.

```sh
node experiments/constraints/sketch-compare/kcad-bench.mjs [--iterations N]
cd experiments/constraints/sketch-compare && dart pub get && dart run dart_bench.dart
```

`--iterations` overrides kernelCAD's shipped 100-sweep cap (a private field) to
separate configuration from method. Results:
[`results/ladder-linux-x64-2026-11-24.json`](results/ladder-linux-x64-2026-11-24.json).
