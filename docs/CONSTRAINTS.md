# Constraint solving: concrete next architecture

## Implemented in drafting

Retained open paths support fixed X and Y coordinates, including dimensioned
parameter expressions. Each lock refers to a persistent vertex ID. The editor
resolves the coordinates directly and validates the resulting geometry in the
current session transaction. An open path can also retain a directed distance
and angle from one vertex to the next. Each driven vertex has one source, so
the editor can resolve a chain in order as parameter values change. Closed polygon drafts now use the reviewed `dart_csp` solver in a browser
worker. The user can combine horizontal, vertical, length, parallel,
perpendicular and equal-length segment constraints. Point 1 is anchored,
lengths use millimetres and may be entered as expressions, and the worker
reports the remaining degrees of freedom when available.

The editor independently checks the numeric solution and validates the
resulting outline before it replaces the draft. The user can continue to edit
the sketch and use the usual Create or Apply action to commit one project
revision. Rejected and stale solves keep the current geometry. The saved
sketch stores both the solved coordinates and the coupled definitions.
Document version 31 links each segment to its two vertex IDs. Edit or remove a
relation after reopening the sketch. Changes in **Parameters** or **Design
inputs** solve the outlines whose evaluated segment lengths change. The new
parameter values and coordinates share one Undo step. Any conflicting outline
keeps the previous parameters and geometry. Existing sketches with stale
coordinates can still be repaired by reopening and solving them. Solving
while dragging and re-solving edits made directly in model source remain open.

The worker loads the checked-in JavaScript built from
`tools/sketch-constraints/solver.dart` with Dart 3.12.2. Run
`sh tools/sketch-constraints/build.sh` to rebuild the pinned artifact.

## Follow-up review — 2026-11-14

Reviewed current main `5dc27dc0b297683d47e94ade2b4ca22ed530d429` against our
`894a11d` qualification baseline. Production library changes are confined to
checked placement and mesh validation; numerical solver and feature-graph source
are unchanged. The latest AOT allocation improvements are useful upstream evidence,
but do not establish new browser drag latency. Retain the geometric worker-adapter
recommendation rather than porting/recreating the solver.

The new pin's geometric-sketch, parametric-bracket and parametric-linkage examples
passed locally, including rejected edits retaining the last accepted model. A fresh
external probe compiled the existing original harness against the new pin and
passed all 16 JS/Wasm cases in local Chromium and iPad-profile WebKit. Results,
source/artifact hashes and qualifications are retained in
[the new evidence](../experiments/constraints/results/geometric-macos-arm64-2026-11-14.json).
This does not qualify the complete upstream platform suite, arbitrary coupled
sketches, placement/mesh changes in browsers, or a physical iPad. The committed
experiment manifest still pins the earlier baseline; the follow-up used a separate
checkout and harness outside the app.

The planned first product use was constrained points/segments and dimensions in entity-based
sketches, through the existing model-source/session history transaction. Follow
with circles and assembly mates. Keep solver caches and drag targets transient;
validate a candidate solve and its downstream geometry before accepting one edit.
The app remains the authoritative design graph, Manifold its mesh-solid backend,
and Jolt its dynamic simulation engine. The CSP reference extrusion kernel remains
a limited fixture backend, not a replacement CAD kernel. Persistent coupled sketch definitions and assembly mates remain open.

## Updated assessment — 2026-11-13

Integrate the owner's MIT `dart_csp` geometric module behind a worker adapter;
do not recreate that solver. Current reviewed pin
[`894a11d74dae312ca99578532b27cca0b51fd34f`](https://github.com/CrispStrobe/dart_csp/tree/894a11d74dae312ca99578532b27cca0b51fd34f)
is version 2.4.0 with no declared runtime package dependencies. It now supplies
persistent geometric sessions, component decomposition, sparse derivatives,
rank diagnostics, soft drag targets, quaternion poses, rigid/revolute mates,
independent candidate forks and transactional CAD feature regeneration. Its
reference analytic backend supports constrained profiles/extrusions and instances;
its documentation still excludes general Boolean/fillet/shell/revolve support.
This changes the earlier interval-only recommendation substantially.

The upstream geometric-edit, parametric-bracket, articulated-linkage and coupled
72-coordinate chain examples passed locally. Our independent
[geometric probe](../experiments/constraints/geometric/README.md) also runs in
native Dart, JavaScript and Wasm browser workers. It checks coordinates, hard
residuals and freedom counts on 10/100/500 independent points and a soft circle drag.
See [measurements and limits](CONSTRAINT-PERFORMANCE.md). At that review, the solver had only been qualified in the probe.

Keep the backend-neutral entity/constraint model and history transaction boundary
described below. Reuse existing app IDs/feature dependencies through an adapter;
do not introduce a second independently mutable Dart document. Convert app degrees
to solver radians explicitly, keep one length unit (mm), and treat nullable rank
as unknown rather than zero freedom. Numerical failure/limits remain different
from proof of inconsistency. Solver mates and Jolt runtime joints remain separate.

The original review and proposed extension list below are **historical evidence
for pin 13f2b04**. Several proposed upstream capabilities now exist; that list must
not be read as a current claim that dart_csp lacks them. The remaining work here is
our sketch schema, retained profile extraction and persistent worker integration,
plus physical-iPad qualification and geometry/transaction tests.

## What was actually reviewed

- [`natgluons/CAD-modeling-app`](https://github.com/natgluons/CAD-modeling-app/tree/2a5615558742c7f8513083c7d44a619a38d33953),
  commit `2a5615558742c7f8513083c7d44a619a38d33953`: a fork of the Zoo/KittyCAD
  application, with an MIT repository license. Its README describes a hosted
  geometry engine streamed to the client. The reviewed constraint tests and
  `src/lang/std/sketchConstraints.ts` associate selections with source/AST nodes;
  tests apply length, angle and distance operations by rewriting KCL expressions.
  This illustrates a shared GUI/code definition, not evidence of a complete
  reusable local geometric solver inside that reviewed client. No code/dependency
  from it has been adopted. MIT client licensing does not establish availability
  or licensing of its hosted engine or every dependency.
- [`CrispStrobe/dart_csp`](https://github.com/CrispStrobe/dart_csp/tree/13f2b04925443a75b6766c969b10aefc65978a0e),
  commit `13f2b04925443a75b6766c969b10aefc65978a0e`: MIT, package version 2.3.0,
  no declared runtime package dependencies. Reviewed README, LICENSE, NOTICE,
  STABILITY.md, `doc/mixed-continuous.md` and `lib/src/continuous.dart`.
  It already has real intervals, linear/product constraints, mixed integer/real
  modeling, outward rounding and bounded bisection. It is not merely a finite-domain
  puzzle solver. Its docs explicitly distinguish surviving boxes from existence
  certificates; `ContinuousModel.solve` also returns null on exhausted split budget.

The [executable probe](../experiments/constraints/README.md) ran against that exact
Dart pin and against its compiled JavaScript. It independently checks residuals on
circle/line equations and demonstrates both underconstrained movement and ambiguous
null status. There is no production adoption or modification to dart_csp in this
milestone. General solver correctness and browser drag latency are not established
by these small probes.

## Three different constraint problems

| Problem | Examples | Recommended engine |
| --- | --- | --- |
| Continuous sketch geometry | Coincident, tangent, distance, angle | Warm-started geometric equation solver |
| Discrete design/configuration | Screw size, tooth count, part variant, grid placement | Existing dart_csp integer/mixed engine |
| Dynamic mechanisms | Hinge motion, contact, motor limits | Qualified Jolt bodies and joints |

Assembly placement/mates add a geometric problem over rigid poses. They can share
references and diagnostics with sketches, but rotations need an appropriate rigid
pose representation. Jolt's runtime joints are a separate physical contract; a
sketch relation must not silently become a simulation joint.

## Retained model before solver-specific state

The next schema revision should add an entity-based sketch alongside the existing
rectangle/circle templates. Do not silently reinterpret version-4 definitions.
Store stable IDs for points, segments and circles/arcs; segment endpoints refer to
point IDs and constraints refer to entities/points rather than triangle indices.
A constraint has a stable ID, kind, typed references and optional unit-aware target
expression. Distinguish driving dimensions from reference measurements and keep
construction geometry explicit. Derive closed profile loops from solved entities
before extrusion. Reject open/self-intersecting/degenerate loops with entity IDs.

Persist design intent, branch/orientation choices and accepted seed placement in
the definition so recomputation can choose consistently. Solved coordinates,
Jacobian/factorization caches and drag hints are derived/transient. Existing sketch
IDs and analytic profile references need an explicit migration when a template is
converted to entities. Undo/iterations retain the entire old definition.

A single transaction path serves GUI dimensions, direct drags, code and MCP.
The existing CAD Script currently creates CSG bodies; it does **not** yet create
these constrained sketches. Add typed sketch constructors and source mapping
when the entity model exists; do not maintain a separately mutable code-only sketch.

## Proposed dart_csp extension

Keep the finite-domain/interval APIs intact. Add an optional pure-Dart geometric
module with:

1. Typed residual equations and sparse derivatives for point coincidence,
   horizontal/vertical lines, signed offsets, distance, parallel/perpendicular,
   equal length and circle radius. Add tangent and angular relations after testing
   degeneracy, orientation and circle/arc branches. Use canonical constraint IDs.
2. A warm-started nonlinear solve using rank-aware linear algebra (QR/SVD or an
   equivalent qualified method), scaling and damping/trust-region safeguards.
   Use a nearest-previous-placement objective for free directions. Temporary drag
   targets are edit hints, not extra permanent constraints. Hard dimensions must
   pass their own tolerance tests; minimizing a weighted sum alone is insufficient.
3. Degrees of freedom from the rank of the scaled geometric Jacobian, accounting
   for eliminated fixed variables. Counting equations is insufficient: duplicates,
   redundant constraints and singular configurations affect rank differently.
4. Structured outcomes that distinguish satisfied, underconstrained, proven
   infeasible, not converged, budget exhausted and cancelled; report residuals,
   offending/candidate constraint IDs and numerical rank. A numerical failure or
   an interval budget cutoff is not proof of inconsistency. Mark redundancy
   separately from genuine contradiction. Do not transplant integer MUS guarantees
   to a numerical oracle that cannot decide every subset.
5. Optional interval prefilter/branch search for bounded design exploration and
   difficult branch initialization, then independent point residual validation.
   Add specialized square handling to improve interval pruning, and an existence
   test only if the product needs certified positive solutions. Preserve the
   distinction between outward-rounded rejection and a positive existence proof.
6. A serializable worker protocol, warm-start state, cancellation/deadline support,
   explicit unit/tolerance policy and deterministic IDs/order. Compile the pure-Dart
   module to JS first; qualify Dart/Wasm separately across Mac/iPad WebKit. Prefer
   one maintained solver to a second hand-translated TypeScript implementation.

The immediate generic-library improvement is a richer `solveResult` status API
while retaining `solve` compatibility: the current null conflates exhausted budget
and infeasibility. Implement that upstream with tests before using its result as
CAD conflict evidence. A new geometric module is substantial work, not an adapter
around the existing interval API.

## First usable delivery and acceptance

Start with lines/points, anchored rectangles, coincident endpoints, horizontal/
vertical constraints and editable lengths. Show free geometry, fully constrained
geometry and rejected edits clearly; constraint selection highlights its entities.
Use a focused sketch context and a Constraints subtree beneath the active sketch.
Preview without journal entries; release/apply commits once; Escape restores.

Then add circles, equal lengths, parallel/perpendicular, distance and tangency.
Benchmark 10/100/500-entity sketches, repeated drags from their previous pose,
redundant/conflicting dimensions, zero-length geometry, large/small units,
branch changes, cancellation and history restore. Set and measure an interactive
frame budget on the actual Mac and iPad; the tiny probe timing is not that benchmark.
No solver should enter production solely because a simple rectangle converges.
