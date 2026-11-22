# Precision sketching, drawing sheets and CAD exchange

Cota is a workflow reference for exact point entry, drafting, drawing sheets and
file exchange. Brickwright starts with retained rectangle/circle extrusions,
named parameters, CAD Script and Blocks, a shared mesh-solid kernel and Jolt
simulation. Keep the same project, history and editor in standalone CAD and
Brickwright. [Cota user guide](https://github.com/mxchristian17/cota/blob/main/docs/user-guide.md)

| Order | Deliverable | Acceptance |
| --- | --- | --- |
| 1 | Make Sketch & Extrude usable now. Explain plane, dimensions, direction and symmetric extrusion in an inline info panel. Show a live draft and actionable errors. Keep preview changes out of project history. | Create and edit a rectangle and a circle on mouse and touch. Invalid entries leave the existing project intact. One Undo restores the previous design. |
| 2 | Add retained sketch entities and profile regions. Start with points, lines, closed polylines, circles and construction geometry. Add endpoint, midpoint, center and intersection snaps, relative coordinates and driving dimensions. Follow with arcs, trim, offset and tangent snaps. | Build a TT motor plate with a named hole-spacing parameter. Changing that parameter updates the solid. Diagnose open or intersecting loops, redundant constraints and conflicting dimensions without dropping edits. |
| 3 | Add a Drawing workspace. Start with linked front, top and side views, scale, visible/hidden lines, center marks, linear and diameter dimensions and vector PDF. Add sections, title blocks and multiple sheets once single-sheet export is stable. | Print a 1:1 TT plate drilling template with a scale check. A changed hole spacing updates the next export. Missing references are marked for repair. |
| 4 | Expose visual Revolve and Mirror over the existing CAD Script operations. Follow with retained linear/circular patterns and a searchable command palette. | Create a shaft, mirrored bracket and bolt circle. Re-edit their inputs and verify stable downstream references and Undo. |
| 5 | Add 2D DXF exchange, then DWG compatibility and STEP supplier-part import. | Round-trip scale, direction, layers and supported entities with independent applications. Report unsupported entities or degraded geometry by type. |

Use the existing [constraint design](CONSTRAINTS.md) as the starting point.
Evaluate a pinned `dart_csp` worker against real pointer interactions and retain
the authoring document as the authoritative graph. Keep stable entity/feature
IDs through edits. Open and validate an older project, then save/reopen it across
standalone and embedded hosts. Validate failed edits, Undo and redraw on macOS and
physical iPad. Drawing annotations use semantic references to features and
sketch geometry. Use finite, bounded projection of mesh geometry where an
analytic boundary is unavailable.

## DXF, DWG and STEP

Support **both DXF and DWG**. Deliver DXF first because it serves two immediate
workflows: importing editable 2D profiles and exporting laser-cutting outlines.
Start with units, layers, line/polyline (including bulges), circle and arc.
Define behavior for missing units, transforms, duplicate edges, unsupported
entities and open contours. Preserve drawing dimensions separately from
fabrication profiles. Verify millimetres and inches, curved outlines, holes,
layer names and real-size round trips.

Add DWG through a separate, optional browser codec paired with the same 2D
interchange model. Evaluate Cota's documented MIT `acad-ts` approach against a
pinned dependency and representative fixtures, including imported transforms,
units, round trips, memory and runtime on iPad, and licence notices for the
whole dependency chain. Begin with 2D read and then qualified write. Treat ACIS
payloads, custom objects, layouts, fonts and dimensions as separate compatibility
work. [Cota file support and dependencies](https://github.com/mxchristian17/cota#features)

STEP starts as supplier-part import with scale, placement, assembly identity
where available, and explicit tessellation or reference behavior. Editable STEP
round trips and general modeling-edge fillets belong to the exact-geometry
roadmap, with stable face/edge references and evaluated backend choices.

### Editable DXF profiles

Open **Sketch & Extrude → Import DXF outline** and choose a text DXF with
planar circles or closed lightweight polylines, including curved segments. The importer accepts
one exterior loop and up to 15 separate holes. The exterior is identified by
containment, so the entity order in the file can vary. Declared units are
converted to millimetres. For unitless files, opt in if the coordinates are
millimetres. The preview shows the holes, and the loop coordinates and circle
radii can be edited before creating the solid. Region circle centers and radii
accept named dimensions. For example, starting with a 40 mm-wide plate, set
\`spacing\` in Parameters and position the two holes at \`20 mm - spacing / 2\`
and \`20 mm + spacing / 2\`. The same formulas drive the solid and its DXF
export. Increasing spacing past the plate edge produces an error before
committing the edit. Import remains a draft until
Create. Saving and reopening retains the profile, and DXF export writes native
circles and closed polylines at 1:1 scale. It retains entity layer names and
polyline bulges. Add the signed bulge as a third vertex value to edit a curve.
The curve stays analytic in DXF, and the modeling mesh approximates it using
chords with up to 0.025 mm of sagitta error within the supported detail budget.

The current region workflow rejects touching, crossing, nested and disjoint
loops. Visual point and curve editing, standalone ARC entities, open contours, widths,
layer filtering and styles, paper-space objects, tilted entities,
DWG and STEP remain open.

## Completion criteria

Keep each deliverable open until its acceptance workflow passes unit tests and
live editor tests. Exercise the standalone and embedded editors for shared
changes. Verify touch workflows on a physical iPad before closing the roadmap.
