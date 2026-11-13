# Constraint solving: concrete next architecture

Recommendation: extend the owner's MIT `dart_csp` with a separate geometric
solving layer, and keep interval/discrete solving available alongside it. Do not
put interval branch-and-prune on every pointer move. First define a backend-neutral
sketch model and result protocol in CAD core; benchmark the geometric solver
behind a worker adapter before making it a production dependency.

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
