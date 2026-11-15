# SimLab feature parity

Reference checked 2026-11-15: Autodesk's [Sim Lab introduction](https://www.tinkercad.com/blog/tinkercad-sim-lab), [connector description](https://www.tinkercad.com/blog/connectors), and [Sim Lab page](https://www.tinkercad.com/simlab). Public documentation is a behavior reference; no implementation or assets are reused. This ledger tracks the shared CAD engine and its Brickwright host. Robot Lab keeps its LEGO-specific mechanics and coordinate adapter.

| Behavior | Shared CAD work | Validation |
| --- | --- | --- |
| Gravity, collisions, fixed/dynamic shapes | Qualified mesh collisions and body settings exist; saved scene gravity/floor and free-body defaults added | Saved gravity/initial velocity tests and live browser previews |
| Material selection | Editable illustrative presets preserve mechanical metadata | Analytic impulse/mass response and shared inspector presets |
| Axle connectors and motors | Existing angular drive plus world-frame connector authoring | Frame/history tests and a live single-drive closed four-bar; motor VM execution retained |
| Slider connectors | Millimetre travel limits, finite-force drive, encoder feedback | Jolt travel-limit tests, live encoder travel and block/code round trips |
| Pivot connectors | Ball pivot with adjustable cone half-angle and free twist | Jolt cone restriction with nonzero free twist |
| Tracing | Saved attachment points, bounded preview trails and CSV export | Transform/budget tests; live traces, CSV export and reset |
| Throwing and live interaction | Existing-body launch, transient analytic preview balls and bounded force-based pointer dragging | Jolt tests reject fixed-body throws; browser dragging preserves the serialized design |
| Playback | Run/pause/reset, single 5 ms step, slow motion and 2× playback | Live 5 ms single step, encoder travel, model-edit cancellation and no history writes |
| Video | Canvas-only recording with duration/byte limits; host export callback | Chromium produces a nonempty video export; bounded tracks/chunks are disposed |
| Sharing | Portable CAD documents, full source, history and Brickwright sidecar | Version-8 source/document, clipboard, undo and deletion tests |

The physics solver remains Jolt at 200 Hz, with collision proof checked against current geometry. A material preset is an editable educational approximation. A rigid preview does not invent elastic behavior for a spring-shaped solid. Passive joints must remain passive until driven; applying a zero-speed motor to every joint would lock closed mechanisms.

## dart_csp

The reviewed source is [CrispStrobe/dart_csp](https://github.com/CrispStrobe/dart_csp/tree/46288eb23f04c2a2f2210088fe568285bea6114f), version 2.4.0, MIT, with no external runtime dependencies. Its geometric solver provides persistent quaternion poses, rigid/revolute mates, residual checks and transactional candidate solves. These APIs are suitable for assembly alignment and authoring diagnostics; they do not replace time integration, contacts or forces.

The initial integration is a build-time four-bar example. `scripts/generate-simlab-linkage.dart` uses its real geometric API; an independent calculation checks all link lengths before storing the geometry. The solver revision and residual evidence accompany the example. No Dart runtime is added to browser or iPad startup. Runtime assembly fitting remains a separate possible use, requiring its own bounded worker and stale-result checks.

Reproduce with Dart SDK 3.12.2 and a clean solver checkout at the pin:

```
node scripts/generate-simlab-linkage.mjs /path/to/dart_csp --check
```

The solver's [MIT license](https://github.com/CrispStrobe/dart_csp/blob/46288eb23f04c2a2f2210088fe568285bea6114f/LICENSE) and [historical notice](https://github.com/CrispStrobe/dart_csp/blob/46288eb23f04c2a2f2210088fe568285bea6114f/NOTICE) were reviewed. Only current reviewed sources are used.

Preview balls use an original analytic sphere collider with its analytic mass and
inertia; this does not replace collision qualification for any authored solid.
Dragging applies a damped force at the picked point with a bounded acceleration,
not a transform overwrite. Playback stops and releases the grab on page hiding,
blur in manual mode, cancellation, reset and disposal. Preview recording copies
rendered frames into a separate canvas so WebGL clearing does not create an empty
capture; audio and desktop contents are excluded.

## Scope still requiring parity work

This is a local physics/editor parity increment, not a claim of complete
Tinkercad product parity. Timeline scrubbing, connector manipulation handles,
additional projectile shapes and hosted collaboration/sharing remain separate
work. Video export is capability-detected and still needs a real iPad MediaRecorder
check. Existing CAD motor programs already run in the real Brickwright VM; the
new slider words additionally need the production-host VM check after SDK sync.

Library reproduction manifests were refreshed only for the current merged lockfile
fingerprint. Archived source files, derivative meshes and historical project
revisions were not rewritten.
