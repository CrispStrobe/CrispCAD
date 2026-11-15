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

The catalogue audit now reports 27 presets without retained shape-specific
parameters, down from 39. Next are cutting/enclosure primitives (counterbores,
countersinks, ports, ribs and bosses), followed by curves/vessels and mechanical
parts. Each family needs dimension relationships, source/history tests and actual
collision checks. A closed default mesh alone is insufficient.

Tests cover regenerated dimensions and volumes, source edits, undo/reopen,
boolean operands, legacy upgrades and German dynamic labels. Edited variants of
all twelve families are qualified against their actual geometry and stepped in
Jolt. Tube/washer/torus ray checks verify that cavities remain open. This is rigid
collision preview qualification, not material, mechanical-fit or manufacturing
certification.
