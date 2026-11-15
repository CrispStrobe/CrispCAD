# Retained curved and hollow shapes

Six additional version-2 recipes share Properties, model source, MCP and revision
transactions. No new runtime dependency or reference implementation is used.

| Shape | Driving inputs |
|---|---|
| Curved cone | Base diameter, height, taper exponent |
| Hemisphere | Radius, preserving a true hemispherical definition |
| Paraboloid | Base diameter and height |
| Vase | Base/body/mouth diameters, height, belly height, radial wall and floor thickness |
| Teardrop cutter | Arch radius, apex height above its centre, cutting length |
| Finishing washer | Outer/bore/seat diameters, height, included seat angle, rim chamfer |

Radial and profile resolution are under the existing collapsed Surface detail.
Finishing washers show live calculated seat depth, like countersinks. A seat must
leave material below it and inside the rim. Teardrop slopes are tangent to their
circular arch; the apex must be above its radius. Impossible relationships and
fractional segment counts are rejected before committing a model revision.

The vase uses two smoothstep curves meeting at the belly, with zero slope there
and at its base and mouth. Wall thickness is **radial at a shared height**, not
constant thickness normal to a sloping surface. The inner contour stops at an
independently controlled solid floor. Profile sampling includes the belly and
floor heights explicitly; the opening remains open. Constant diameters make a
plain cylindrical cup. Body diameter cannot be smaller than base or mouth.

Curved cones use `radius(z) = baseRadius * (1 − z/height)^exponent`;
paraboloids use `radius(z) = baseRadius * sqrt(1 − z/height)`. These are sampled
analytic curves, not exact B-rep surfaces. Mesh, export and simulation use the
requested detail; palette thumbnails use a temporary lower-resolution copy.

The four revolved mesh presets retain their bounding-box-centred origin.
Teardrop cutters and finishing washers retain their previous construction
origins. Existing saved geometry is never silently rebuilt. Explicit Apply
retains identity, placement, colour, role, boolean inputs and undo/history;
legacy mesh-only definitions can be upgraded through that same operation.

## Collision construction

Radial-profile metadata now accepts up to 256 bounded profile edges (tube-grid
limits are unchanged). A longer definition is not authority to simulate it.
Candidate convex pieces still require qualification against the actual evaluated
mesh, with the same 2% total volume-error, 0.2 mm bounds and 2,048-hull limits.

Dense sampled profiles can otherwise create microscopic tip pieces that Jolt
cannot scale, or require coarse angular sectors to stay within the hull budget.
A chord-error-bounded simplification selects original profile vertices for
collision candidates only. Its maximum profile deviation is 0.05 mm and scales
down for smaller shapes. Source/render/export geometry stays unchanged. This
candidate bound does not replace the final mesh/compound volume and bounds gate.

Adjacent radial sectors have a small angular overlap (0.00001 radian), included
in normal qualification. It avoids numerical cracks at their common boundaries.
Vase floors additionally have an inscribed convex support core derived from
source profile coordinates. This keeps the central floor face inside one convex
piece, avoiding ambiguous ray hits at the common axis of many sectors. Both
changes retain the existing Jolt settings and compound budgets.

Tests cover analytic volumes, welded connected shells, legacy upgrades,
source/history round trips, edited cavities, floor and rim contact, seat depth,
and teardrop passages after subtraction. These are rigid-preview checks, not
mechanical, material or manufacturing certification. General generator formulas
and sketch constraints remain separate roadmap work.
