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

### STEP supplier-part references

Choose **File → Import STL or STEP…** and select a text `.step` or `.stp`
file. Brickwright tessellates AP203, AP214 and AP242 in a local WebAssembly
worker. It converts the source coordinates to millimetres, resolves assembly
placements, and names the resulting references from the STEP parts and
occurrences. The import places the assembly on the workplane as a set of
individually selectable references. Part colors are retained where supplied.
The geometry saves with the project and the entire import is one Undo step.

These reference meshes are for visual placement and clearance checks.
Printing, solid operations and physics use solid bodies. Exact B-rep editing,
per-face styles and STEP export remain open. Files are limited to 16 MiB and
150,000 triangles including expanded assembly instances. Unsupported geometry
reported by the reader stops the import before the project changes.

The shipped Wasm is produced from the locked MIT `oxideav-step 0.0.1` and
`oxideav-ifc 0.0.4` crates. Use `sh tools/step-wasm/build.sh` with Rust 1.100.0
and its `wasm32-unknown-unknown` target to regenerate it.
[STEP reader](https://docs.rs/oxideav-step/0.0.1/oxideav_step/) · [NIST AP242 reference](https://www.nist.gov/services-resources/software/step-file-analyzer-and-viewer)

### Editable 2D DWG exchange

Open **Sketch & Extrude → Import DXF or DWG outline** or **Sketch path →
DXF or DWG path**, then use **Choose DWG file**. The file is decoded locally
by the on-demand browser worker using the pinned MIT acad-ts 3.9.0 codec.
The sketch importer applies the DXF geometry rules to the decoded model
space, including scale, layer selection, coplanarity, signed arc bulges
and polyline widths. Unitless inputs require an explicit millimetre
assumption. The sketch remains a draft until the user creates the extrusion
or saves the path. The project stores the editable geometry.

The selected geometry must fit the shared sketch workflow. Blocks, text,
hatches, layouts and 3D solids are outside that workflow. Exclude layers
with unsupported entities when importing. Files and decoded drawings are
limited to 1 MiB, and a stalled worker is stopped. The qualified versions
include AutoCAD 2000 and 2018.

Choose **Export sketch as DWG** in extrusion Properties or **Export path
as DWG** in the path editor. The worker writes AutoCAD 2018 DWG at 1:1
in millimetres in the local sketch plane. Circles and polylines remain native
entities. The exported geometry uses current parameter values. Layer names,
colors, linetypes, lineweights, plot and lock state are written for the supported
sketch layers. A true-color layer exports its RGB color and on/off state.
Separate DXF indexed fallback colors and independent new-viewport frozen
state may change on DWG round trips through the codec. DXF export remains
available. Full drawings and assemblies, older DWG output versions and broader
interoperability qualification remain open.
[acad-ts DWG documentation](https://github.com/node-projects/acad-ts/blob/master/docs/CadReaderDocs.md)

### Editable DXF profiles

Open **Sketch & Extrude → Import DXF or DWG outline** and choose a text DXF with
planar circles, closed lightweight polylines, or closed chains of native 2D
lines and arcs. The importer joins chain endpoints within 0.000001 mm and
retains arcs as editable polyline bulges. Each chain uses one DXF layer.
Disjoint endpoints, branches and duplicate edges trigger validation errors.
The importer accepts
one exterior loop and up to 15 separate holes. The exterior is identified by
containment, so the entity order in the file can vary. Declared units are
converted to millimetres. For unitless files, opt in if the coordinates are
millimetres. The preview shows the holes, and the loop coordinates and circle
radii can be edited before creating the solid. When the drawing contains
multiple layers, keep the outline and hole layers checked, clear unrelated
layers, and choose **Import selected layers**. Only entities on the selected
layers are validated as sketch geometry. Single-layer files open directly in
the draft. The layer picker reads entity layer names and keeps legacy
polyline vertices and block attributes with their parent entities.
[Autodesk DXF entity groups](https://help.autodesk.com/cloudhelp/2024/ENU/AutoCAD-DXF/files/GUID-3610039E-27D1-4E23-B6D3-7E60B22BB5BD.htm)
[Autodesk DXF sequence endings](https://help.autodesk.com/cloudhelp/2016/ENU/AutoCAD-DXF/files/GUID-FD4FAA74-1F6D-45F6-B132-BF0C4BE6CC3B.htm)

Sketch and path import use model-space coordinates. The importer skips
paper-space objects before listing layers, including title blocks, viewports,
and paper geometry that shares a layer with a model profile. The dialog
reports when it skipped layout objects from the entity list. Layout tabs,
viewport transforms and paper-only geometry are outside the sketch workflow.
[Autodesk DXF model and paper space](https://help.autodesk.com/cloudhelp/2021/ENU/AutoCAD-DXF/files/GUID-66D32572-005A-4E23-8B8B-8726E8C14302.htm)

Tilted or elevated coplanar geometry unfolds into the sketch plane you
select, at actual size. The importer combines object-coordinate arcs,
circles and polylines with world-coordinate lines, preserves circle radii
and signed bulges, and rejects selections that span multiple planes.
The DXF export uses the resulting sketch coordinates. Original world
placement and general 3D curves remain separate from this sketch workflow.
[Autodesk DXF object coordinate systems](https://help.autodesk.com/cloudhelp/2024/ENU/AutoCAD-DXF/files/GUID-D99F1509-E4E4-47A3-8691-92EA07DC88F5.htm) · [Autodesk arbitrary axis algorithm](https://help.autodesk.com/cloudhelp/2024/ENU/AutoCAD-DXF/files/GUID-E19E5B42-0CC7-4EBA-B29F-5E1D595149EE.htm)

Region circle centers and radii
accept named dimensions. For example, starting with a 40 mm-wide plate, set
\`spacing\` in Parameters and position the two holes at \`20 mm - spacing / 2\`
and \`20 mm + spacing / 2\`. The same formulas drive the solid and its DXF
export. Increasing spacing past the plate edge produces an error before
committing the edit. Import remains a draft until
Create. Saving and reopening retains the profile, and DXF export writes native
circles and closed polylines at 1:1 scale. It retains entity layer names and
polyline bulges. For selected layers, DXF exchange retains indexed and RGB
colors, on/off and freeze/lock flags, the plotting flag, lineweight and simple
dash, gap and dot patterns. Dash lengths convert with the drawing units.
These properties travel with the sketch and do not change its solid geometry.
Complex text and shape linetypes, entity-level overrides and plot styles remain
outside the layer round trip. [Autodesk DXF layer records](https://help.autodesk.com/cloudhelp/2021/ENU/AutoCAD-DXF/files/GUID-D94802B0-8BE8-4AC9-8054-17197688AFDB.htm) · [Autodesk DXF linetype records](https://help.autodesk.com/cloudhelp/2020/ENU/AutoCAD-DXF/files/GUID-F57A316C-94A2-416C-8280-191E34B182AC.htm)

Add the signed bulge as a third vertex value to edit a curve.
The curve stays analytic in DXF, and the modeling mesh approximates it using
chords with up to 0.025 mm of sagitta error within the supported detail budget.

The current region workflow rejects touching, crossing, nested and disjoint
loops. DXF lightweight polylines retain constant and tapered widths at
actual size. Edit a vertex as **X, Y, bulge, start width, end width** to
change the width of its outgoing edge. The sketch and solid use the
centerline. DXF export writes the widths back as drawing properties. Trim
interpolates widths at new endpoints, and a closing edge starts at zero
width. Offset supports uniform-width outlines.
[Autodesk DXF lightweight polylines](https://help.autodesk.com/cloudhelp/2024/ENU/AutoCAD-DXF/files/GUID-748FC305-F3F2-4F74-825A-61F04D757A50.htm)

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
and arcs use only their authored sweep.

For coupled segment relations on a closed polygon, open **Outline
constraints** in Sketch & Extrude. Add horizontal, vertical, length,
parallel, perpendicular, or equal-length constraints and choose **Solve
outline**. The solver anchors point 1 and reports remaining degrees of
freedom. Drag a free vertex to see the solved outline in blue while the
existing dimensions hold. Release validates the drop and updates the
coordinate rows. An invalid move leaves the draft intact. Create or Apply
saves it in one Undo step. Open a
saved outline to edit its constraints and solve with current parameter
values. Points keep their identities by row. Restore the saved point count
or clear the constraints before changing the topology. Trimming and
offsetting require clearing the constraints. **Parameters**, **Design
inputs**, and **Model source** re-solve affected outlines as part of the same
undoable edit. Conflicts leave the previous parameters and shapes intact.
**Arc radius** drives the radius of an existing curved segment from a value
or named dimension, preserving the side and sweep through the endpoints.
**Arc tangent to line** keeps an existing arc tangent to an adjoining straight
segment. **Arc tangent to arc** keeps adjoining arcs smooth through the
shared endpoint as the reference arc changes. In a region, choose
**Region loop constraints** and select the boundary or cutout outline to
edit. **Region loop positions** sets a dimensioned X/Y offset between
the first vertices or selected edge midpoints of two outlines. **Region
edge matches** drives a straight edge from the length of a reference
edge on another loop. Drag a free vertex on a constrained boundary or cutout
to update the region. The solve rechecks the full outline and holes, keeps
incoming constraints, and propagates changes to dependent loops. Other
cross-loop dimensions and tangent relations remain open.

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

Open **Title block** to add a drawing number, revision, and drafter to a
part or assembly sheet. The preview and vector PDF show the identifiers in the
footer and keep the 50 mm scale check. The same fields appear on assembly
parts-list pages. Values are optional. Clearing all three restores the standard
footer. Document version 29 stores the fields with the sheet.
Enable **Show section A-A** to add a cut through the extrusion in sketch
coordinates. Choose the constant X or Y coordinate and enter a millimetre
value or named dimension. A dashed cut line and direction marks identify the
plane. The section hatches solid material and leaves cutouts clear. The
saved cut updates in previews and PDF when the source changes.
In **Drawing dimensions**, choose a dimension type and select
its sketch anchors. Pick the label position on the page, or
enter paper coordinates, then add the dimension. Dimensions keep their
placement on the sheet and use current distances and diameters from the
source sketch. If an anchor disappears, edit the dimension to pick a new
anchor or remove it before exporting.
Enable **Offset section** to cut at two parallel positions. Set the second
section position and the jog coordinate along the perpendicular sketch axis.
The first cut runs up to the jog and the second continues from it. The cutting
line shows the step, and the section view projects both legs into one hatched
view. All three coordinates accept named dimensions. A jog that leaves either
leg clear of the material blocks export until corrected.

Horizontal and vertical dimensions also accept actual outline points,
including the endpoints of arcs and points on polygonal holes. The anchor
picker lists their sketch coordinates and marks the chosen points in the
preview. After saving, the dimension follows a point moved in its row and
keeps links to unchanged points through contour edits. If an edit removes a
point or leaves its identity ambiguous, the sheet asks for a replacement.

An **Aligned dimension** measures the straight-line distance between two
anchors and draws the dimension line parallel to them. Choose the endpoints
of a slanted straight edge to label its true length. On a curved edge the
same dimension measures the chord. The page scale changes the spacing on
paper while the label retains the model length.

Choose **Radius dimension** for a sketch circle or circular arc, or
**Arc length dimension** for an arc. The picker highlights the selected arc.
Radius and arc length use the authored circular geometry at any drawing scale.
Arc links follow the ordered endpoints and update when the curvature changes.
If the edge is straightened or the directed endpoint pair is removed, repair
or remove the dimension before exporting.

## Assembly drawing sheets

Open **Objects → Drawings → Create assembly drawing** for linked top, front
and right views of the complete solid assembly in its design position.
The views use the evaluated geometry of solids, including transformed and
imported bodies. Reference bodies and hole cutters are excluded. Hidden
edges can be shown as dashed lines. Choose a smaller scale to fit a larger
assembly on A4. A drawing set can mix assembly and sketch sheets.

The projection uses mesh silhouettes and sharp edges, clips them by depth,
and omits coplanar triangulation seams. Assembly projection runs in a
dedicated browser worker, and unchanged geometry shares its projected lines
across scale, hidden-line, preview and PDF changes. Detailed meshes may
exceed the projection budget.

Enable **Include parts list** on an assembly sheet to add one entry per
evaluated solid body in Objects order. Names and item numbers reflect the
current assembly. Use **Preview page** to inspect the list. Long names wrap,
and larger lists continue on additional pages in single-sheet and drawing-set
PDF exports. The SB3 stores the option with the sheet.

Enable **Show section A-A** to cut an assembly at a world X or Y
coordinate. The top view marks the cutting plane, and the section hatches
each solid separately while leaving holes and gaps clear. The section uses the
evaluated geometry and carries through preview, PDF and SB3 reopen. Named
length parameters can drive its position. The drawing reports when the plane
misses the solids.

Enable **Offset section** to add a single jog. The first cut contributes
material before the jog coordinate and the second cut contributes material
after it. The top view marks the stepped path. The section keeps distinct
components separately hatched and merges touching cut regions from the same
component at the jog. Both legs must cross material.

In **Model edge dimensions**, choose **Add edge dimension**, pick a visible
model edge and place its label on the sheet. The label measures the full
edge as projected in the chosen orthographic view. Edge links use the
solid body and its local endpoints, so placement edits retain the link when
the edge remains visible in that view. If a geometry change removes the
edge or it can no longer be seen in the selected view, replace or remove the
dimension before exporting.

Assembly drawings also support up to four jogs. Enable **Offset section**,
set the first jog, and use **Add jog** to continue the cutting path. Each jog
has a coordinate along the section and a new parallel cut position. Jog
coordinates must increase along the displayed world axis, adjacent positions
must differ, and each leg must cross solid material. The preview and PDF show
the full stepped path. Older one-jog sheets keep their original format.

Under **Model edge dimensions**, choose **Radius**, **Diameter**, or **Arc
length** and pick the visible curve in a face-on view. The dimensions use the
authored radius or sweep of a cylinder, a circle in a sketch extrusion, or a
sketch bulge arc. They follow parameter and placement edits while the curve
remains visible and projects as a circle or circular arc. Curves in imported
meshes, boolean results, and oblique or elliptical projections currently use
projected straight-edge measurements.

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
the signed arc bulges and the layer. For multilayer drawings, keep the layer
containing the guide and choose **Import selected layers**. **Export path as DXF** writes the current
draft as an open lightweight polyline in millimetres. The path stays editable
after export and reimport. [Autodesk LWPOLYLINE reference](https://help.autodesk.com/cloudhelp/2024/ENU/AutoCAD-DXF/files/GUID-748FC305-F3F2-4F74-825A-61F04D757A50.htm)

### Point locks on open paths

Open **Point locks**, select a point, and enter the two coordinates in the
sketch plane. Coordinates accept millimetres and project parameter expressions.
Locked vertices have a distinct marker in the preview. The saved path follows
parameter edits, and trimming keeps the locks on surviving points. DXF export
and closure into an outline use the current coordinates. Unlocking a point
keeps its current position when the point rows are valid.

Document version 16 stores the vertex identities and locks.

### Directed segment constraints on open paths

Open **Segment constraints**, choose a segment, and set its endpoint distance
and direction. Direction is measured counterclockwise from +X in the sketch
plane. Both values accept project parameter expressions. The first point drives
the next point, and adjoining constraints propagate in path order. A driven
endpoint cannot also have a point lock. The preview, snap guides, and DXF export
use the evaluated path. Removing a constraint keeps the current endpoint.
Trimming keeps a relation when both vertices survive on the same segment.
Closing the path uses the evaluated geometry.

Document version 28 retains open-path relationships and their expressions.
Document version 31 retains coupled segment constraints on closed outlines.
Parameter editor and inspector changes re-solve retained outline relations.
Document version 32 retains driving arc radii. Version 33 retains arc-to-line
tangency. Version 34 retains arc-to-arc tangency. Version 35 retains
constraints on individual region loops. Version 36 retains relative loop
positions. Version 37 retains edge-midpoint position anchors. Version 38
retains shared edge lengths across loops. Other edge relations remain open.

## Command line and code workspace

The shared editor now has an opt-in **CAD terminal** bottom dock. It uses the
existing command palette registry and session history; `help`, Tab, aliases,
Up/Down, Escape, typed `box` and `move`, `list`, and stable-ID selection are
available. Committed GUI/model-source changes expose a recallable `apply-edit`
command with changed retained-graph fields, preconditions and selection. Replay
validates the candidate and creates one Undo step; it does not call `load` or
create another history stack. See [CAD terminal](CAD-TERMINAL.md).

Still open: qualification on both hosts and physical touch hardware, richer
semantic output and input coverage, picked points in pending commands,
command scripts and a persistent CAD Script workspace (distinct from the
existing Model Source pane).

Keep sketching and object editing available through the pointer and keyboard.
Add a dockable CAD command line with prompts, completion, aliases and
history. Start by routing existing CAD commands through the same editor
actions as buttons and the command palette. Accept picked geometry or typed
coordinates where a command needs input. Support Escape to cancel a pending
command and group a completed command into one Undo step.

Let users open CAD Script from that surface in a persistent editor with a
live preview, source diagnostics, parameter completion and an explicit
Apply action. Keep model source editable on reopen. Develop coordinates,
snapping and constrained 2D drawing against the same CAD session so typed
commands and on-canvas tools lead to the same model.

Cota documents a prompt-driven command line with history, completion, and
absolute, relative and polar coordinates. Use those workflows to evaluate
discoverability and keyboard efficiency. [Cota documentation](https://mxchristian17.github.io/cota/docs/)

### Optional precision design in Costumes

Keep the existing Scratch Paint canvas, selection, brush, fill, and artwork
editing as the default Costumes experience. Add an opt-in **Precision design**
switch in Settings → Workspace. Show its contextual controls only while
Precision is active on a vector costume or backdrop. Keep the switch local
to the user. Turning it off hides the tools and preserves the artwork and
CAD geometry. Basic drawing must start normally even if CAD is disabled.

1. **Choose geometry.** Reuse the Costumes selection and path handles. Add
   a precision grid, units, origin, snaps, coordinate entry, and dimensions
   around the selected shapes. Use the existing CAD sketch representation
   and constraint solver for exact geometry. Advance lines, rectangles,
   circles, and arcs first. Add splines and more constraints after the
   underlying editable geometry supports them.
2. **Preview profiles.** Show a separate highlight on each closed region
   eligible for solid extrusion. Preserve nested holes and let users choose
   individual regions. Point to gaps, self-intersections, unsupported
   shapes, and ambiguous overlaps. Converting strokes to outlines,
   closing a gap, and approximating a curve require an explicit preview
   and tolerance. Keep artwork fills, gradients, and painted shadows
   independent of the profile highlight.
3. **Send to CAD.** After choosing a region, show its target plane, origin,
   size in millimetres, and scale. Create an editable CAD sketch on Apply.
   Keep the costume intact. Start with an explicit snapshot, then support
   a deliberate update from source with a change preview. After saving a
   closed sketch, **Preview extrusion** opens the CAD preview for that
   sketch. Cancel leaves the sketch in place. **Create extrusion** adds
   the solid in its own Undo step.
4. **Qualify both modes.** Verify the original child-facing drawing flow
   with Precision off and no CAD code loaded. Test mouse and pencil or
   touch selection, legacy SVGs, units, nested holes, multiple islands,
   close-gap review, imports that contain bitmap or gradient artwork,
   Undo, and SB3 save and reopen. Editing a linked source after an
   extrusion exists must preserve that extrusion until the user accepts
   an update.

Fusion makes closed profiles visible through shading and requires a plane
and scale for SVG placement. Shapr3D puts applicable constraints next to the
editing context and lets users select a closed region for extrusion. Adopt
these interactions with the existing Brickwright drawing tools and CAD
session. [Fusion sketch profiles](https://help.autodesk.com/view/fusion360/ENU/?contextId=SKT-3D-SKETCH) · [Fusion SVG placement](https://help.autodesk.com/cloudhelp/ENU/Fusion-Model/files/SLD-INS-SVG.htm) · [Shapr3D constraints](https://support.shapr3d.com/hc/en-us/articles/7407627891100-Adding-and-removing-constraints) · [Shapr3D extrude](https://support.shapr3d.com/hc/en-us/articles/7874453786908-Tools-menu-Extrude-tool)

The Costumes Properties panel now offers **Precision drawing** under the
opt-in setting. Enter the center and size of a rectangle or circle, the
endpoints of a line, or the center, radius, and signed sweep of a circular arc.
The result is an editable path on the existing vector canvas with one Undo
entry. A precision circle stays analytic through the SVG handoff as long as
the path still describes a circle. Open lines and arcs use a dimensioned
stroke and can transfer through the stroke outline preview. **Open paths**
imports the centerline as an editable CAD sketch path instead. It preserves
straight segments, circular SVG arcs, and supported precision arcs drawn in
Costumes. Other curves can be approximated using the existing tolerance.
Span controls the larger of the width and height, including vertical paths.
From **Send to CAD**, choose **Update an existing sketch** to select a compatible
project sketch. The preview overlays old and new geometry and lists the solids
that depend on it. Declining the review leaves the model untouched. Applying it
updates the same sketch in one Undo step. An optional source link remembers which costume or backdrop
owns a sketch across rename, reorder, and SB3 reopen. A single linked
sketch is selected when the user opens the update list. It restores
the source mode and conversion settings, then matches the region by a unique
precision shape ID or SVG element ID. Anonymous geometry can match if its
profile is unchanged and unique. Changed anonymous, duplicate, and older
links ask for a region before preview. Every geometry update still needs
confirmation. Direct drawing constraints remain open.

The transfer shows the original artwork beside the selected CAD profile.
Local linear and radial gradient paint keeps its SVG shape geometry. CAD
uses the contour, and the original artwork keeps its colors. An initial
filled preview tries the default curve tolerance of 0.2 mm when curves
need sampling. The user can adjust the tolerance, turn approximation off,
or choose another region. Transfer adds the selected profile.

The initial handoff offers **Send to CAD** for vector costumes and
backdrops when Precision design is enabled. Select a region, set its width
and plane, and add an editable sketch. Use **Placement** to set the lower-left
corner or center to precise coordinates on that plane. The default keeps the
lower-left corner at the origin. Placement shifts all outlines and holes by
the same amount and persists in standard sketch coordinates. It retains straight closed
edges, full circles, and supported nested holes. Strokes are excluded from
the geometry. Users can opt into **Approximate curves** and choose a
0.01–10 mm chord tolerance for closed Bézier and elliptical contours. The
preview shows the straight segments that will be stored in the sketch.
Full circles retain their circle profile. **Close small gaps** adds a straight
edge between the endpoints of the same subpath, up to the chosen distance at
the final sketch scale. The preview highlights each added edge. Contours with
crossings are still rejected. **Profile source → Strokes** expands a solid
SVG stroke into an editable filled outline using its width, caps, and joins.
It preserves holes in closed strokes and circle profiles in circular strokes.
Use uniform scale and an absolute stroke width. Curved centerlines require the
curve approximation opt-in, and rounded caps and joins are sampled at up to
22.5° per segment. Each subpath becomes a separate profile. Stroke union,
nonuniform scaling, and dashed strokes remain open.

#### SVG conversion and dependency choice

Use the existing Costumes vector editor and Brickwright CAD geometry stack.
The existing icon-tag importer already parses a restricted, local SVG subset
with Three.js and extrudes a decorative mesh. It scales the icon to a fixed
size. The precision handoff should reuse its input checks and path-reading
approach, with explicit scale and an editable CAD sketch as the result.

| Approach | Fit for Brickwright |
| --- | --- |
| Three.js SVGLoader, ExtrudeGeometry, STLExporter | Good for a quick visual preview or a standalone STL converter. Exporting multiple meshes through the same STL writer does not perform a Boolean union. |
| JSCAD SVG Deserializer and STL Serializer | A useful reference for a batch converter and for fixtures with known units. Brickwright already uses JSCAD modeling. Evaluate the import and export packages only if they improve a measured gap in the existing paths. |
| Brickwright sketch and Manifold | Use as the production path. Retain the sketch and extrusion feature in the project. Evaluate and validate the resulting solid with the existing kernel and use the current STL or 3MF export. |
| build123d and Open CASCADE | Useful for comparing analytic B-rep and STEP behavior. The Open CASCADE LGPL license and exception are outside Brickwright's current permissive-only distribution requirement. |

Interpret nested contours according to their SVG fill rules after applying
transforms. Preserve circles and supported arcs as editable geometry. Offer
a visible tolerance for approximating other curves and an explicit choice
for expanding strokes. Present issues such as zero-area regions, unresolved
crossings and unsupported elements before conversion. Verify closed
topology, orientation, positive volume, and physical dimensions after
extrusion. STL carries triangles and no unit metadata, so retain the
dimensioned geometry and source mapping in the project.

[Three.js SVGLoader](https://threejs.org/docs/pages/SVGLoader.html) · [Three.js STLExporter](https://threejs.org/docs/pages/STLExporter.html) · [JSCAD SVG Deserializer](https://jscad.app/docs/module-io_svg-deserializer.html) · [Manifold license](https://github.com/elalish/manifold/blob/master/LICENSE) · [Open CASCADE license and exception](https://github.com/Open-Cascade-SAS/OCCT#license)
