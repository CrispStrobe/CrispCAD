# Retained everyday shapes

Twelve more presets store a version-2 generator recipe instead of relying only on
an opaque mesh and scale. Properties, Model source and the MCP
`cad_apply_model_source` tool use the same reconstruction function. No runtime
dependency was added.

| Shape | Design inputs |
|---|---|
| Rounded box | Width, depth, height, corner radius |
| Capsule | Overall length, width, extrusion height |
| Tube / washer | Outer diameter, wall thickness, height; linked bore diameter in Properties |
| Cone | Base diameter, height |
| Tapered cylinder | Bottom diameter, top diameter, height |
| Polygonal prism | Circumdiameter, side count, height |
| Elliptic cylinder | Width, depth, height |
| Wedge / pyramid | Width, depth, height |
| Round roof | Width, arch height, extrusion length |
| Torus | Ring centre radius, tube radius |

Resolution controls live under **Surface detail**. Side count remains a design
input for polygonal prisms. A tube's outer-diameter edit keeps wall thickness;
editing bore diameter derives wall thickness. Impossible walls, overlapping ring
sections, oversized corners and fractional segment/side counts are refused.
Draft fields do not change the saved model until Apply succeeds.

Reconstruction retains object identity, name, colour, placement, solid/hole role
and material settings. Retained boolean operands remain editable. Each accepted
change is one undoable edit; portable project revisions preserve the recipes.
Old mesh-only objects are not silently rebuilt. Their Properties show a short
migration notice, and regeneration occurs only on explicit Apply.

The local origin stays at the mesh bounding-box centre, matching previous mesh
presets. Parameter edits retain that origin/placement; increasing height is not
an automatic drop-to-workplane operation. Surface placement and explicit Drop
remain available. Model source retains recipe values instead of large vertex
lists. MCP help includes the supported recipes and conventional screw presets.

## Current boundary

These are validated numeric design recipes, not a general sketch constraint or
B-rep feature system. Named formulas already drive supported primitive/transform
and sketch/extrusion inputs; binding arbitrary generator values to that graph
remains work. Numeric recipes must not be described as full constraint-based CAD.

The catalogue audit now reports 22 presets without retained shape-specific
parameters, down from 39. Cutting/enclosure primitives are now retained as
described below. Curves/vessels and mechanical parts remain next. Each family needs dimension relationships, source/history tests and actual
collision checks. A closed default mesh alone is insufficient.

Tests cover regenerated dimensions and volumes, source edits, undo/reopen,
boolean operands, legacy upgrades and German dynamic labels. Edited variants of
all twelve families are qualified against their actual geometry and stepped in
Jolt. Tube/washer/torus ray checks verify that cavities remain open. This is rigid
collision preview qualification, not material, mechanical-fit or manufacturing
certification.


## Cutting and enclosure parts — 2026-11-15

Five additional version-2 recipes use the same Properties/source/MCP transaction
path. These constructions keep their existing local origins, including the
bottom Z plane of cutters/bosses and the corner of a rib; they are not recentered
to the everyday-mesh origin described above. Resizing retains placement and does
not silently drop or reattach a part. Old project meshes remain unchanged until
explicit regeneration.

| Shape | Design inputs |
|---|---|
| Counterbore | Nominal bore, recess diameter, bore length, recess depth, diametral clearance |
| Countersink | Nominal bore, recess diameter, bore length, included seat angle, cylindrical rim height, diametral clearance |
| Rounded port | Overall length, width, extrusion height |
| Screw boss | Outer diameter, bore diameter, height, rib reach, rib thickness, rib height |
| Rib | Length, height, thickness |

Cutter clearance adds to **diameters**, not radii, for both the shaft and recess.
For a countersink, taper depth is `(recessDiameter − boreDiameter) /
(2 × tan(seatAngle / 2))`; the inspector shows this read-only value while typing.
The bore length ends at the start of the taper; the rim adds a cylindrical
section above it. A zero-height rim is supported. A counterbore's total length
is bore length plus recess depth. The recess must exceed the nominal bore.

Ports allow length equal to width for circular openings. Bosses keep an open
through bore and four connected reinforcing ribs; zero rib reach gives a plain
hollow boss. Rib height cannot exceed boss height, and the bore/rib thickness
must fit inside the outer diameter. Radial/curve resolution remains under
Surface detail. No new popup or explanatory panel is added.

These are editable construction tools, not certified hole/fastener standards.
Cutter solids retain the existing Solid/Hole control: use Hole and Union for
subtraction, or Subtract explicitly. Source/history tests preserve a retained
cutter inside a boolean; Jolt ray tests check through passages and the actual
recess shoulder/taper in a cut plate. Boss ray tests check the bore and rib
height, including edited resolution, no-rib and full-height-rib cases.

### Integration regression: cylinder origins

The concurrent origin-preserving cylinder change exposed a compatibility issue:
applying the identity globally changed previously qualified CSG triangulations,
including the original example boss/hub and imported Sign01. The engine now keeps
its established construction first. If a code construction with a uniform
origin-based cylinder exports distinct manifold vertices at identical Float32
coordinates, it retries once with the mathematically equivalent direct-origin
cylinder construction. This is not tolerance snapping or a mesh-welding repair.
An actual representable gap stays open. The original 34 example outputs and all
102 reviewed corpus outputs reproduce byte-for-byte, including the newly closed
Sign03. The retry does not certify arbitrary output; normal export/physics
qualification still applies. Only affected constructions pay for the second pass.
