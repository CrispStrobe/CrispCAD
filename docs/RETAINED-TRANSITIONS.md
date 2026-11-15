# Retained transitions and sliding profiles

Bent tubes, rectangular-to-round transitions and dovetails now retain version-2
recipes across Properties, model source, MCP and portable revisions. Existing
saved geometry stays unchanged until explicit regeneration. The three templates
keep their previous construction origins; accepted edits retain placement, name,
colour, role, identity and boolean inputs. Source/render/export geometry uses the
requested detail; thumbnail detail is reduced only in a temporary preview.

| Template | Driving inputs |
|---|---|
| Bent tube | Centreline bend radius, outer diameter, wall/bore, bend angle |
| Rectangular transition (`loft`) | Base width/depth, round-end diameter, height, wall thickness |
| Dovetail | Narrow/wide width, profile height, slide length, normal face clearance |

Bend radius must exceed the tube's outer radius, and its wall must leave an open
bore. Both ends remain open for the supported 5–180° bends. Outer diameter, wall
and bore fields stay linked. Arc/cross-section sampling is in Surface detail.
The bend volume approaches `angleRadians * bendRadius * annularArea`.

A rectangular transition with wall thickness zero is solid. A positive thickness
makes an open duct and must fit inside both ends. Its section radii interpolate
linearly from a rectangle to a circle along height. This is a retained template,
not a general loft-between-arbitrary-sketches feature or a B-rep loft. Rectangle
corners and cardinal directions are explicitly sampled; unequal width/depth does
not silently chamfer away the base corners. Hollow sections have inner base
width/depth reduced by twice the wall and round-end radius reduced by the wall.
This defines section dimensions, not constant wall thickness normal to a slope.

Dovetail clearance offsets each of its four section planes outwards by the
specified normal distance. It does not scale the profile or extend slide length.
For side slope `m = (wide − narrow)/(2*height)`, the side-line intercept increases
by `clearance * sqrt(1+m²)`; top and bottom move by the clearance as well. Use a
copied Hole shape as a socket cutter and extend its slide length explicitly when
it must pass through both ends. Generic clearance geometry is not a certified
fit, friction model or articulated assembly.

## Section-grid collision construction

The new bounded `annular-grid` hint describes actual mesh sections. Each section
stores an outer row followed by an inner row, with a repeated seam vertex in
each row. `segments` is the number of sweep intervals (1–64), `sides` is the
number of section edges (3–256), layout is `rows`, and `closed` is false for the
open sweep. The *solid mesh* is closed by annular end faces. A solid transition's
inner rows collapse to its axis. Unsupported column layout, closed sweeps,
missing seams, stride overrides and insufficient position buffers are rejected.

Candidate pieces follow those vertices and their section counts, so bend radius,
angle and bore edits cannot reuse a hardcoded quarter-pipe collider. The previous
legacy pipe path remains available for old meshes. Adjacent cells have a small
neighbour-interpolation overlap, included in source/compound qualification.
Filled transitions have an inscribed central support core to avoid a seam at the
shared axis. Sweep grouping distributes the available budget evenly instead of
needlessly coarsening every interval when only a few merges are needed.

An expanding hollow section exposed a 2.36% error when each warped cell was
replaced by one convex hull. If that first candidate fails, the engine can
partition its closed section cells using the existing exact kernel, then qualify
the resulting complete compound. This refinement also works through retained
booleans and parent transforms. It can still refuse shapes that exceed the
budget; a higher detail value does not guarantee simulation readiness.

All candidates, including overlaps and support cores, require the same 2% volume,
0.2 mm bounds and 2,048-hull gate against actual evaluated geometry. Jolt settings
and the fork remain unchanged. Tests cover analytic dimensions/volumes, welded
shells, bore passages, section support, normal face offsets, a socket cutter,
legacy/source/history round trips and transformed boolean construction. These are
rigid-preview checks, not general mechanical or manufacturing qualification.
