# CAD → Jolt contract and qualification

This is an optional headless adapter, not a completed simulation workspace.
The editor supplies independent solids; the standalone app does not yet expose
a simulation tab. Do not confuse a catalog mesh or a rigid preview with a
validated manufactured mechanism.

## Implementation

- `@brickwright/cad-physics` pins the same qualified MIT JoltPhysics.js fork as
  Brickwright (`1.1.0-bw.9`, release `bw.9-qualified-20261029`). No new Jolt fork
  patches were necessary for this milestone. The existing fork's gear/rack
  facilities remain available for a future mate/actuator integration.
- Documents remain millimetres, right-handed Z-up. The adapter converts geometry
  to SI once and uses Z-up gravity. It advances in fixed 1/200 s steps. Body
  poses are deltas relative to the evaluated, world-space CAD geometry.
- Body density, friction, restitution, motion type and mechanical intent are
  explicit versioned metadata. The starting density is a generic 1050 kg/m³
  plastic assumption; it is editable and is not a measured material assignment.
- Mass, center of mass and the complete inertia tensor come from signed
  tetrahedral integrals of the actual evaluated solid, not from overlapping
  collision hulls. Jolt receives an explicit COM offset and full mass/inertia.
- Hinge presets contain separate leaves and a pin, local joint frames, angular
  limits, a hinge constraint and a fixed pin constraint. Inserting, duplicating,
  deleting, saving and reopening retain/remap the relevant references.
- References such as the ruler are rendered but excluded from printable meshes,
  mass and simulation. Boolean operations cannot silently absorb reference
  helpers or destroy joints. Combining different densities is refused until a
  composite-material mass model is specified.

## Collision preprocessing

Persistent cache restoration requalifies canonical convex hulls and uses the
same SHA-256 addresses even when native WebCrypto is unavailable.

Preprocessing belongs in a host worker with cancellation/time limits and a cache
keyed by the complete geometry SHA-256. The current headless API is synchronous
inside its geometric operations; calling it on an interactive UI thread would
block that UI. The editor's ordinary geometry worker has its existing timeout;
it is not yet an interactive physics worker.

Shape-specific sweep/profile candidates use the original geometry samples.
Retained unions keep useful convex pieces; cutters are applied before the final
compound is checked. A bounded, independently authored BSP partitioner uses
Manifold's solid operations where no construction hint applies. Candidate failure
may retry a whole-mesh decomposition, using the same acceptance gate.

A compound is accepted only after comparison with the evaluated source solid:

- Immutable mesh SHA-256 matches; document geometry key rejects stale evaluation.
- Missing **and** extra solid volumes are measured by independent CSG differences.
  Default total relative difference is at most 2%; default outer bounds deviation
  is at most 0.2 mm. These are preview limits, not a Hausdorff-distance proof or a
  guarantee that every small cavity is clear. Fit-critical openings need probes.
- Maximum 64 vertices per hull, 2048 hulls per body and 4096 per world. Difficult
  geometry is rejected rather than silently replaced with a box or convex hull.
- Each Jolt hull is centered and conditioned near unit size, then wrapped in a
  scaled shape to recover SI geometry. Its hull-building tolerance is bounded by
  a quarter of the declared bounds tolerance (at default, at most 0.05 mm), and
  by a normalized 0.005. A convex contact radius of at most 0.02 mm (also limited
  by the hull size) provides stable small-part contacts. This avoids ill-conditioned millimetre-scale input without
  silently changing the model's physical units.

Jolt manifold/contact-cache distances are explicitly tuned for millimetre-scale
geometry in SI. Sleeping and body-pair contact caching are disabled in this
correctness baseline. A knurl-tip regression covers a real missed-contact case
from metre-scale defaults. Interactive performance tuning must retain this test.

The gate is deliberately fail-closed. A certificate records a geometric preview
qualification; it does not certify fatigue, manufacturing clearance, friction,
contact stresses, or assembly behavior. Never accept a serialized external
certificate without revalidating its content and native shape creation. Runtime proof objects
are immutable and their hull buffers are hashed again before world creation;
serialized or mutated objects are refused. Cached hulls must pass through
preprocessing/qualification again in the receiving worker.

## Actual checks

Headless tests use the fork's **debug** build to catch binding/refcount misuse:
physical box mass/inertia and translated COM, floor settling, stale-data rejection,
a tube's clear bore and solid wall through actual Jolt ray queries, rotating a
hinge leaf about its fixed pivot, explicit rigid-only treatment of a coil, helper
exclusion, and teardown. Coincident collider-seam rays are not used as fit probes.

`node scripts/qualify-catalog-physics.mjs` runs the entire current catalog through
preprocessing, native shape creation, 200 rigid-preview simulation steps (one second) and
teardown, with transformed source vertices checked against the floor rather
than a rotated aggregate bounding box. It emits `artifacts/catalog-physics.json` and exits nonzero if any
entry is blocked. This is an additional qualification report, not a substitute
for mechanism tests or iPad performance acceptance.

## Required next mechanical work

- Surface native update/capacity errors and allocator telemetry before broad
  arbitrary-scene acceptance; the existing Jolt interface exposes a void Step.
  Native aborts require discarding the worker/module rather than continuing.
- Interactive worker/session, play/pause/reset and pose display, with strict
  edit/simulate ownership and no simulation state written into the design.
- Mate placement and frame/clearance validation, fixed/hinge/slider constraints,
  motors, limits and reaction-force/torque measurement.
- Gear, rack, lead-screw and belt coupling contracts, using the existing fork
  where its measured behavior fits. Tooth/belt templates are not already
  dimensionally or dynamically qualified just because their preview runs.
- A spring needs endpoints, rest length and calibrated stiffness/damping. A
  rigid coil is not an elastic spring. A snap-fit requires an appropriate elastic
  model and calibrated material; a rigid clip is not a deformation simulation.
- Critical cavity/engagement probes, interference checks, independent analytical
  or measured fixtures, energy/momentum tests and real-time iPad budgets.
- Qualify real paired fasteners, pulley/belt tooth profiles, template fits and
  actual board footprints. Current nominal Gridfinity/SBC/pulley constructions
  are starter templates with explicit fit verification requirements.

Further C++/binding changes are authorized by the owner if measured fixtures
show a missing solver capability. Make a reproducer first; do not patch a solver
to hide bad collision geometry or an unconfigured mechanical model.

The current catalog-default qualification records 48 rigid solids passing and
one ruler excluded. This covers the supplied default shapes and a one-second
rigid drop, not all edited variants, paired mechanical assemblies, or elastic
behavior. The JSON report is generated by `npm run verify:physics`.
