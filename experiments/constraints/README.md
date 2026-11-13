# dart_csp suitability probe

This standalone development experiment pins the owner's MIT `dart_csp` at
`13f2b04925443a75b6766c969b10aefc65978a0e`. It is not imported by the app or
included in its production dependency closure. Requires a Dart SDK; ordinary CAD
builds do not. The solver's MIT license and historical NOTICE remain in its pinned
repository/package. No solver implementation is copied here.

```sh
cd experiments/constraints
dart pub get
dart run dart_csp_probe.dart
dart compile js -O2 dart_csp_probe.dart -o /tmp/cad-constraint-probe.js
node /tmp/cad-constraint-probe.js
```

Verified on Dart 3.12.2/macOS arm64 and the dart2js output on Node 26.4.0:

- Circle/line equations `x²+y²=25`, `x+y=7` converge to approximately `(3,4)`;
  an independent point check finds squared-distance residual `1.12e-7` and line
  residual `1.78e-15` in the model's numeric units.
- An underconstrained `x+y=10` returns approximately `(4.375,5.625)`, despite
  `(5,5)` already being valid. This API accepts no previous-pose/stay objective.
- A known feasible problem cut off at `maxSplits:0` and an immediately contradictory
  problem both return `null`. The CAD adapter must not label that return value as
  a proven conflicting sketch.

Timing is a cold, tiny diagnostic, not an interactive CAD performance benchmark.
Compiling to JavaScript demonstrates a possible browser-worker route, not an
integrated iPad solver or a tested Dart/Wasm deployment. See
[the constraint architecture](../../docs/CONSTRAINTS.md).
