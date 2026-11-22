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
planar circles, closed lightweight polylines, or closed chains of native 2D
lines and arcs. The importer joins chain endpoints within 0.000001 mm and
retains arcs as editable polyline bulges. Each chain uses one DXF layer.
Disjoint endpoints, branches and duplicate edges trigger validation errors.
The importer accepts
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
loops. Widths,
layer filtering and styles, paper-space objects, tilted entities,
DWG and STEP remain open.

## Outline point editing

In Sketch & Extrude, drag a white vertex on a polygon outline or on a polygon
loop in a region. Dragging uses the workplane snap setting. Hold Shift for
finer increments. Releasing a vertex at an invalid position restores its
previous coordinates and shows the validation message. Edits commit when you
create or apply the extrusion. In the coordinate field, enter an absolute
first point and prefix subsequent offsets with `@`, for example `@40, 0`.
A vertex drag converts its loop to absolute coordinates and retains arc bulges.
Open **Sketch snap references** to choose one or two other sketches on the same
plane. The preview draws their original sketch coordinates as dashed outlines.
Drag near an endpoint, edge midpoint, circle or arc center, or an intersection
between the two references. The preview highlights the active target. Snapping
writes the exact coordinates into the draft. The reference choices stay in the
dialog, and the committed shape stores coordinates. Enable **Snap straight
edges tangent to arcs and circles** to include exact contact points for a
straight edge. Drag its endpoint toward the contact point. A dashed line and
the **Tangent** label identify the active snap. The other endpoint stays fixed,
and arcs use only their authored sweep. Persistent constraints remain open.

Enable **Edit edge curves** to reveal a blue handle at the midpoint of each
outline edge. Drag the handle across its chord to turn a straight edge into
an arc, change the arc radius, or return the edge to straight. The endpoints
stay fixed, and a rejected curve restores the preceding outline. The vectors
remain editable as DXF bulges and preserve their shape on export.

## Full-size drilling template

Select an original sketch extrusion and choose **Properties → Export drilling
template (PDF)**. The file contains vector contours and circular center marks
in the local sketch plane. It uses the current design parameters and exports
in portrait or landscape on A4 at 1:1. Print at actual size and measure the
50 mm reference on the sheet. The exporter reports an error if the sketch
cannot fit at 1:1. The linked sheet workspace, orthographic body views,
dimension annotations and section views remain open.

## Linked drawing sheets

Select a sketch extrusion and choose **Properties → Create drawing sheet**.
Save the sheet to the **Drawings** section of the Objects browser. The
landscape A4 sheet follows its source extrusion and sketch parameters.
It shows top, front and right views, linear dimensions, circular center
marks and hole diameters. Dashed hidden edges can be toggled. Choose a scale
from 1:5 through 5:1 and use **Export drawing PDF** to print the vector sheet.
The 50 mm reference measures actual paper size, independent of the view scale.

The views use the sketch's declared plane and the extrusion distance in
part coordinates, before assembly placement and transforms.
A removed source leaves a repairable sheet. Choose another source or Undo
the removal. Whole-project files and model source retain the drawing links.
Object clipboard copies carry geometry. With multiple saved sheets, choose
**Export drawing set (PDF)** to create a numbered PDF in the displayed order.
If a sheet needs repair or exceeds its paper size, the export identifies it.
Enable **Show section A-A** to add a cut through the extrusion in sketch
coordinates. Choose the constant X or Y coordinate and enter a millimetre
value or named dimension. A dashed cut line and direction marks identify the
plane. The section hatches solid material and leaves cutouts clear. The
saved cut updates in previews and PDF when the source changes.
In **Drawing dimensions**, choose horizontal, vertical or diameter and select
a profile bound or circle center. Pick the label position on the page, or
enter paper coordinates, then add the dimension. Dimensions keep their
placement on the sheet and use current distances and diameters from the
source sketch. If an anchor disappears, edit the dimension to pick a new
anchor or remove it before exporting.
Offset sections, arbitrary edge annotations and assembly views remain open.

## Completion criteria

Keep each deliverable open until its acceptance workflow passes unit tests and
live editor tests. Exercise the standalone and embedded editors for shared
changes. Verify touch workflows on a physical iPad before closing the roadmap.

## Visual Revolve

Choose **Revolve** in the toolbar to sketch a new profile, or **Revolve this
sketch** in extrusion Properties to reuse a sketch. The dashed preview line
shows the axis, which runs along sketch Y. It starts at the left edge of
the profile. Turn off **Use left edge of profile** to enter an exact X position.
The whole profile must be on one side of the axis. Set **Sweep angle (deg)**
to 360 for a complete shaft or use a signed angle for a partial turn.
The axis position and sweep accept named dimensions.

**Edit sketch & revolution** changes the sweep, axis or sketch in one undoable
operation. Editing a shared sketch updates every feature that uses it. Save
and reopen the original project to keep these relationships.

## Visual Mirror

Select a body, then choose **Mirror** in the toolbar. Pick a plane and enter
its position along the perpendicular axis in millimetres. For example, **YZ**
with an offset of 20 reflects around X = 20 mm. The offset accepts a named
dimension. The result replaces the selected body in the workspace. To keep a
second independent body, duplicate the source and place the copy before mirroring.

Open **Inputs** under the result to edit the retained source. Use **Edit
mirror** in Properties to change the plane or offset. Mirror and its edits
participate in Undo and retain their inputs when you save and reopen.

## Visual patterns

Select a body and choose **Pattern**. In **Linear**, enter an axis, the total
number of instances including the source, and a signed spacing. In **Circular**,
enter an axis, the center coordinates on the perpendicular plane and a signed
sweep. For a bolt circle, place a bolt away from the chosen axis first. A full
circle distributes the instances evenly without repeating the source. A partial
sweep includes both endpoints.

The pattern produces one body and joins any overlapping copies. Open **Inputs**
to edit the shared source, or use **Edit pattern** in Properties to change the
settings. Counts, distances and angles accept named dimensions. The document
retains these settings along with the stable source and output IDs. Patterns
allow 2 to 64 instances within the geometry budget.

## Search CAD commands

Open **Command palette** in the toolbar or press Ctrl/⌘+Shift+P with focus in
CAD. Search by name or task, such as **bolt circle**, and choose a matching
command. Arrow keys change the active result, Enter runs it, and Escape closes
the palette. Selection-dependent commands appear when their inputs are
available. Ctrl/⌘+K still opens shape search.

## Offset sketch profiles

In **Sketch & Extrude** or **Sketch & Revolve**, open **Offset profile** and
apply a signed distance to the draft. A positive distance grows the outside
boundary and shrinks holes. A negative distance shrinks the outside and grows
holes. Rectangles, circles, and outlines with straight edges and circular
arcs remain editable, including mixed regions. Existing named dimensions on
rectangles and circles keep their formulas with the evaluated offset added.

Offset arcs stay concentric. Inward corners trim to the intersection of the
offset supports and separating curved-outline corners receive round joins.
Straight-only outlines keep their mitered corners. A collapsed edge, split
loop or invalid hole leaves the prior draft in place. **Create** or **Apply
sketch changes** commits the draft in one Undo step.

## Trim a closed outline by line

Open **Trim by line** in an outline or region sketch. Enter two exact sketch
points or choose **Pick trim line** and tap both points in the preview. The
arrow points into the side to keep. **Trim draft** cuts the outside boundary
and closes it along the line. The remaining part of an intersected arc keeps
its center and radius. Existing holes stay in the retained area.

The current tool supports a cut that crosses the outside twice. A cut that
splits the profile or crosses or discards a hole leaves the draft intact.
Open-entity trimming and broader contour topology changes remain open.

## Open sketch paths

Use **Sketch path** to author and save a chain of lines and circular arcs
without creating a solid. Enter one absolute or relative point per line and an
optional bulge on each outgoing edge. The final point ends the path. Saved
paths are editable in **Objects → Sketches** and can serve as snap guides
without an implied closing edge.

**Trim by line** retains one continuous part of the open path and preserves the
analytic geometry of cut arcs. A trim that would leave disconnected pieces
leaves the draft intact. **Close into outline** joins the endpoints with a
straight edge, validates the outline, and keeps the sketch and profile IDs.
It can then be extruded or revolved. Undo restores the open path.

### Open-path DXF exchange

Open **DXF path** in the path editor to import one open lightweight polyline
or one connected chain of planar LINE and ARC entities on a single layer.
Coordinates convert to millimetres from the declared drawing units. For a
unitless file, confirm millimetres in the path dialog. The importer retains
the signed arc bulges and the layer. **Export path as DXF** writes the current
draft as an open lightweight polyline in millimetres. The path stays editable
after export and reimport. [Autodesk LWPOLYLINE reference](https://help.autodesk.com/cloudhelp/2024/ENU/AutoCAD-DXF/files/GUID-748FC305-F3F2-4F74-825A-61F04D757A50.htm)

### Point locks on open paths

Open **Point locks**, select a point, and enter the two coordinates in the
sketch plane. Coordinates accept millimetres and project parameter expressions.
Locked vertices have a distinct marker in the preview. The saved path follows
parameter edits, and trimming keeps the locks on surviving points. DXF export
and closure into an outline use the current coordinates. Unlocking a point
keeps its current position when the point rows are valid.

Document version 16 stores the vertex identities and locks. Coupled constraints,
degrees of freedom, and constraints on closed profiles remain open.
