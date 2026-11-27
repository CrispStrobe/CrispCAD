# Code an object

Choose **Code** in the workbench or **Object → Code an Object…** on macOS.
The original CAD Script language describes one retained construction. Preview
builds the solid without changing the model; Create/Apply preflights the complete
model and saves one undoable edit. Errors preserve the draft and last valid solid.
Select the object and choose Code again, or expand its **Code & parameters** in
the browser, to reopen the definition. Code operands remain editable after booleans.

For a persistent editor, choose **Code workspace** in the command palette or
enter `code` in the optional **Terminal** dock. The workspace stays beside the
canvas, previews after a short typing pause, and keeps its draft on close.
Standalone saves drafts on the device, scoped to the project and code object.
Ctrl/Command+Space completes parameter names. Create/Apply is still explicit and
uses the same Undo history; preview and typing do not create model revisions.
If the model changes while editing, **Use current model** keeps the draft and
explicitly refreshes its baseline before another preview or Apply. **New code
draft** starts another object while retaining the previous draft. See the
[workspace guide](TERMINAL-WORKSPACE.md#persistent-code-workspace) for storage
limits and embedding options.

```text
param width: mm = 60;
param depth: mm = 30;
param thickness: mm = 5;
param bore: mm = 3;
let plate = move([0, 0, thickness / 2], box(width, depth, thickness));
let holes = move([-20, 0, thickness / 2],
                 repeat(3, [20, 0, 0], cylinder(bore, thickness * 2)));
return subtract(plate, holes);
```

Open the [example project](../examples/coded-three-bore-plate.bcad), or copy
the [example source](../examples/three-bore-plate.cadcode).

Parameters appear beside the source. Enter expression overrides, or clear a field
to use its source default. Inputs are scoped to this object, independently of
model parameters; copying an object retains independent local inputs. Updating
source preserves object ID, placement, appearance and physics settings. Units
are millimetres/degrees; scalar means dimensionless. Expressions support named
parameters, `+ - * / %`, comparisons, &&/||/!, lazy ternaries, parentheses and explicit mm/cm/m/in/deg/rad units.
The final `return` is required. Named shapes support forward references; cycles
and duplicate declarations are errors. `//` starts a comment.

| Function | Meaning |
| --- | --- |
| `box(width, depth, height)` | Centred box |
| `cylinder(radius, height[, segments])` | Centred cylinder along Z |
| `frustum(bottom, top, height[, segments])` | Centred taper; one radius can be zero |
| `hull(a, ...)` | 3D convex hull, including a single concave input |
| `empty()` | No solid, useful in branches |
| `choose(condition, a, b)` | Resolve only the selected branch |
| `forRange(i,start,end,step,shape)` | Parametric directed range, at most 256 values |
| `forValues(i,[values],shape)` | Parametric scalar-list instances |
| `sphere(radius[, segments])` | Centred sphere |
| `union(a, b, ...)` | Combine solids |
| `subtract(base, cutter, ...)` | Remove cutters from base |
| `intersect(a, b, ...)` | Common solid |
| `move([x,y,z], shape)` | Translate in millimetres |
| `rotate([x,y,z], shape)` | Rotate in degrees |
| `scale([x,y,z], shape)` | Signed axis scale |
| `repeat(count, [dx,dy,dz], shape)` | Union a bounded linear repetition |

Nested transforms execute from the inside out. Each returned construction is
one rigid body, including disconnected components; make separate objects for
separate simulation bodies. Code regenerates actual Manifold mesh solids and
uses the existing Jolt collision qualification/invalidation pipeline. Changing
source or overrides invalidates old collision preparation. This does not create
mechanical joints or flexible material simulation automatically.

Source and overrides live in document version **4** and are included in the normal
history-inclusive `.bcad` archive. Existing v1–3 projects still open. Older app
versions reject v4 rather than flattening or silently losing code. Preview creates
no saved iteration. Restoring an iteration retains later work.

The interpreter accepts a bounded modeling language, not JavaScript, Haskell or
`.scad` files. There is no `eval`, arbitrary imports, filesystem or network access.
Current limits: 32 KiB UTF-8 source, 8,192 tokens, 256 statements, depth 32,
4,096 expanded shape nodes, 200,000 estimated faces, repeat count 64 and curve
segments up to 4,096 (default 48), additionally bounded by the face budget. The normal expression and document limits also apply.
The supported conditional, loop and profile operations remain bounded. General
user-defined native functions, arbitrary loops and implicit surfaces remain ahead.

![Independent source editor, solid preview and local parameter controls](images/code-editor.png)

## Reference ideas and implementation boundary

These comparisons concern public documentation, not copied implementation:

- [OpenSCAD](https://github.com/openscad/openscad): retained declarative source,
  parameter-driven reuse, CSG and nested transforms. Its implementation was not
  used. Our language is independent and does not promise OpenSCAD compatibility.
- [JSCAD](https://github.com/jscad/OpenJSCAD.org): separate reusable modeling
  modules from browser and command-line hosts. Its MIT project is a potential
  permissive ecosystem reference; no JSCAD code or dependency was added here.
- [ImplicitCAD](https://github.com/Haskell-Things/ImplicitCAD): programmatic reuse,
  rounded constructions, twisted extrusion and implicit functions whose zero
  boundary describes a surface. This AGPL project is an ideas-only reference;
  no implementation was read or incorporated. An optional future implicit backend
  must specify field units, bounds, meshing tolerance and collision validation.
  It must retain the source definition rather than pretending a sampled mesh is
  an exact B-rep. No implicit backend has been adopted.

The first milestone uses our existing BSD core and Apache-licensed Manifold;
there are no new production dependencies. See [CAD strategy](PARAMETRIC-CAD-STRATEGY.md)
and the [MCP interface](MCP.md) for the shared headless path.

The Code an object dialog now includes 34 original examples: primitives, units,
forward references, mounting plates, washers, spacers, sleeves, brackets, trays,
lids, handles, clips, guides, patterns and Boolean constructions. Load example
replaces only the current draft; Preview is noncommitting. New created code bodies
are placed on the workplane; subsequent definition edits preserve their pose.
The core exports `codeExamples` and `codeExampleProgram(id)`; MCP `cad_code_help`
returns the same sources with locale-specific titles. Every shipped example is
compiled, evaluated and STL-round-tripped as a positive-volume solid in tests.

Source interchange now supports the documented OpenSCAD/JSCAD subsets. Code Import
accepts .scad, .js, .jscad and .cadcode. Source Export offers native editable source
or evaluated OpenSCAD/JSCAD snapshots. `extrude(height, [[x,y], ...])` builds a
simple planar polygon, with 3–256 points. See [converter coverage](CODE-CONVERTERS.md)
for exact limits, parameter semantics, provenance and the VPS ingestion interface.

## Blocks and pseudocode

[Block modelling](CAD-BLOCKS.md) compiles nesting block programs into
this language, with parametric OpenSCAD/JSCAD exports from the same tree.

## Code alongside manual modeling

[Model source](UNIFIED-DESIGN-SOURCE.md) is the design-level companion to Code an
object. It keeps GUI edits and retained source synchronized, embeds native code
bodies as multiline templates and applies an accepted source change as one saved
modeling step. It does not require exporting/reimporting the project.

## Retained planar profiles

Profiles can contain holes, planar Booleans and hulls before extrusion or
revolution. Their scalar expressions remain driven by code parameters:

```text
param width: mm = 40;
param bore: mm = 5;
param height: mm = 8;
return extrudeProfile(height,
  subtract2d(rectangle2d(width, 30, true), circle2d(bore, 48)));
```

`extrudeProfile(height, profile[, twistDegrees, steps, topScaleX, topScaleY])`
starts at Z=0; positive twist follows the right-hand convention.
`revolve(profile[, angleDegrees, segmentsPerFullTurn])` revolves one-sided radial
X coordinates around the profile Y axis and maps that axis to world Z.
Complete 360-degree turns also accept wholly nonpositive radial profiles,
reflected before revolution; crossing-axis and negative partial-turn profiles
remain refused.
Use `move2d`, `rotate2d`, `scale2d`, `union2d`, `subtract2d`, `intersect2d`,
`hull2d` and `polygon2d(points[, indexPaths])` for profiles. Profile expressions
are inline trees; named profile references and profile loops are future work.
See [converter coverage](CODE-CONVERTERS.md#profile-engine-and-measured-coverage--2026-11-14)
for tessellation differences, resource limits and export gaps.

`spurGear2d(module, teeth[, pressureAngleDeg, backlash])` returns an involute
spur-gear profile generated by a standard basic rack (addendum 1·m, dedendum
1.25·m), including trochoidal root fillets and low-tooth-count undercut. Tooth 0
is centred on +X. Defaults are 20° and 0 mm; teeth are 6–200. Gears of equal
module and pressure angle mesh at centre distance `module*(z1+z2)/2`; turn an
even-toothed driven gear by `180/z2` degrees so a tooth space faces the driver.
`internalSpurGear2d(...)` returns the matching ring-gear tooth-space cutter to
subtract from a disc. Both resolve to ordinary polygons, so OpenSCAD/JSCAD export
is an evaluated snapshot. Profile generation is adapted MIT code from kernelCAD.

The native profile language also supports `text2d("label", size, "sans", "center",
"baseline", spacing, curveSteps)`, `offset2d(distance, roundFlag, segments, profile)`,
`minkowski2d`, `choose2d`, `forRange2d` and `forValues2d`. Fonts are `sans`, `serif`
or `mono`; alignment strings and text remain literal source values. Numbers and
profile choices can depend on code parameters. New 3D operations are
`minkowski(a,b,...)`, `polyhedron(points,faces)` (native faces counterclockwise from
outside), `mirror([nx,ny,nz],shape)`, `axisRotate([nx,ny,nz],angle,shape)` and
`resize([width,depth,height],shape)` (zero preserves an axis). These use actual solid
geometry and existing worker/preflight/history/collision boundaries. Unsupported
foreign export operations fail explicitly; see CODE-CONVERTERS.md.

## Derived expressions and additional construction

`const span: scalar = i * width;` declares a bounded derived numeric expression.
It resolves when consumed, including inside a loop binding `i`, and does not add
an editable GUI parameter. `param` declarations remain the public input controls.
Syntax trees are cached separately from values; dependency cycles and work budgets
still apply.

`affine([m00,m01,m02,tx,m10,m11,m12,ty,m20,m21,m22,tz], shape)`
retains a row-major affine transform. `affine2d(a,b,tx,c,d,ty,profile)` applies its
planar counterpart. `resize([x,y,z],[true,true,false],shape)` optionally scales
zero target axes by the largest scale factor among specified target dimensions. Existing two-argument
resize keeps its previous behavior.

`polygonGenerated2d(pointRange(i,start,end,step,point(x,y)))` retains generated
vertices. `pointValues`, `pointConcat` and `pointChoose` also compose point lists.
Native scalar `sumRange` and `filterAt` provide bounded reductions/filtered indices.
These are produced by supported SCAD comprehensions and remain parametric.

`assertCode(condition, "message", shape)` and `assert2d` retain source assertions.
A message can use `formatSCAD("width=",width)` for reference-compatible numeric
lettering/diagnostics; existing `formatText` keeps native number formatting.
Signed revolutions and wholly negative radial profiles are supported. A profile
crossing the radial axis is diagnosed rather than replaced with a solid.

### Lazy scalar aliases

`const name = expression;` names a scalar expression without exposing another
editable parameter. Aliases may read parameters and other aliases; parameter
definitions can read aliases in their global scope. They resolve only when used in the active
shape/profile branch, so inactive assertions and invalid numeric domains stay
inactive. In a loop, resolution and caching use that iteration's binding scope.

```cad
param width: mm = 20;
const half = width / 2;
return box(width, half, 2);
```

Aliases share the existing source, token and 256-statement budgets. Every
expression remains limited to 1,024 characters; alias cycles and dependency
chains beyond 32 are refused, and resolution uses a 65,536 scalar-work guard in addition to the 16,384-step
shape evaluation budget. The importer uses aliases to avoid repeating large
symbolic formulas. No source defaults or geometry limits are changed.

Named shapes are also resolved in the consuming loop scope. Their active declaration
graph is checked for unknown names/cycles; inactive conditional branches and
loop-dependent references are checked when consumed. `assertValue(condition,value[,message])`
checks lazily, including an optional literal or `formatSCAD` diagnostic message.
Text in this expression form is diagnostic data; it cannot supply a numeric
modeling argument or execute code.

## Evaluated profile resize

`resize2d(width,depth,autoX,autoY,profile)` resizes the evaluated profile, including
its boolean cuts and offsets. Zero targets keep their size unless the matching
auto flag is true. Automatic axes follow the largest specified scale factor;
all-zero targets are an identity. Empty input stays empty. The existing
`resize([x,y,z],[autoX,autoY,autoZ],shape)` follows the same rule in 3D.

SCAD import/export retains these operations and parameter dependencies. JSCAD
export of resize remains explicitly unsupported until it has evaluated bounds;
conservative profile bounds must not be used to guess the scaling of a cut body.

OpenSCAD Boolean options such as `center` use actual Boolean values; numeric
`center=1` means the default false. Numeric entries inside a resize auto vector
use their nonzero values, while a numeric scalar `auto` is ignored. Explicit
fractional extrusion slices are truncated. Nonpositive slice counts for straight,
untwisted, untapered extrusions use an equivalent one-step construction. Automatic
slices for twisted/tapered profiles remain part of the tessellation gap.


## Matched-section lofts

`loft([section0, section1, ...])` constructs a capped solid from matching closed
XY rings, each a list of `[x,y,z]` points. Coordinates may reference native numeric
parameters. Each section lies on one Z plane; section heights must be strictly
ordered, vertex counts must match, and winding must be consistent. Consistently
clockwise or descending sections are normalized. Concave rings are supported;
self-crossing rings, repeated edges and mixed winding are rejected. The constructor
retains authored vertex correspondence: vertex *i* of a section is joined to vertex *i*
of the next.

**Side surfaces are ruled (CAD Script revision 2, 2026-11-26).** Each side quad between
two sections is the ruled (bilinear) surface through its four corners, the surface
kernelCAD's `loft(…, { ruled: true })` and the exact kernel's ruled loft build. Where
the quad is planar (sections that are scaled or shifted, not turned) that is two
triangles. Where one section is turned against the next the quad is twisted: the mesh
then fans four triangles around the mean of its corners, which has exactly the ruled
surface's volume (its area is the ruled area to about 1e-3), and the exact backend
builds the ruled surface itself (volume and area exact). For a 10-gon of radius 82 at
z 0 and a 10-gon of radius 77.9 turned by π/10 at z 150 the volume is
h/6 · (A₀ + 4A½ + A₁) = 2,772,519.67 mm³.

Programs saved before revision 2 keep **revision 1** lofts: every side quad is split
along the diagonal from vertex *j* of a section to vertex *j*+1 of the next (as JSCAD's
`extrudeFromSlices` does), 2,678,272.48 mm³ for the example above; the other diagonal
would give 2,866,766.86. See [Language revisions](#language-revisions) for which
programs use which, and how to upgrade.

### Smooth lofts

`smoothLoft([section0, section1, ...])` (2026-11-26) takes the same sections as `loft` and
joins them with one smooth surface instead of ruled sides: kernelCAD's default
(`loft(…, { ruled: false })`) and the exact kernel's smooth loft. Vertex *i* of every section
lies on one curve, a B-spline that interpolates vertex *i* of each section:

- degree min(3, sections − 1): two sections give exactly the ruled `loft`, three a quadratic;
- section parameters by chord length: for each vertex, the cumulative 3D distance from
  section to section, normalized to 0..1; the parameters are the mean over the vertices, with
  the vertex before the last (authored index *count* − 2, where the kernel's section curve starts
  and closes) counted twice;
- knots by averaging those parameters (Piegl & Tiller, eq. 9.8), clamped at both ends;
- global interpolation: each curve passes through its vertex of every section.

Every side face is straight across (between the curves of vertex *i* and *i* + 1 at the same
parameter) and curved along the loft, and every slice of constant parameter is a planar polygon
at one Z. This is the surface SMLib (and so the lab's native kernelCAD build) produces, checked
control point by control point against the kernel's STEP output; the exact backend builds it
with the kernel's smooth loft and refuses the solid if its volume differs from the surface's
exact volume (`smoothLoftVolume`, the integral of slice area times dz, exact by Gauss-Legendre)
by more than 1e-7.

The mesh slices the surface at every section, at every knot and in between, so that along each
vertex curve the chord sag is at most **1e-4 of the smallest section's XY diagonal**
(`SMOOTH_LOFT_TOLERANCE`; per polynomial piece h²/8 · max |C″|, at most 256 slices per piece).
Consecutive slices are joined like ruled loft sections (planar quads as two triangles, twisted
ones as a fan around their centre), so the mesh is closed and manifold and passes through every
authored section. Volumes are typically within 1e-4 of the exact surface's (for the catalog's
wind turbine blades, 3.7e-6 to 6.3e-5).

The surface must rise along Z everywhere: sections close together in Z but far apart in XY can
make the interpolating curves turn back, which is refused ("Smooth loft folds back along Z").
A slice that would cross itself is refused too. Booleans, transforms and every other function
treat a smooth loft like any other solid.

`smoothLoft` is the same in both [language revisions](#language-revisions). A document that
holds a program calling `smoothLoft` is **document version 43**; `checkDocument` refuses
`smoothLoft` below 43, and SDKs that predate it refuse version 43 ("unsupported format, version
or units") as well as the function itself ("Unknown modeling function"). Documents without
`smoothLoft` keep their version.

### Loft pairing

`loft([section0, ...], {pairing: "closest"})` and `smoothLoft([...], {pairing: "closest"})`
(2026-11-27) choose which vertices of neighbouring sections are joined. The default,
`{pairing: "authored"}` or no option, joins vertex *i* to vertex *i* as written (everything
above). `"closest"` pairs sections the way OpenCASCADE's `BRepOffsetAPI_ThruSections` does, for
programs converted from models written against that loft:

- the first section keeps its start and direction;
- each following section is re-started at the vertex, and run in the direction (forward or
  backward), that minimizes the sum of distances from its vertices to the previous section's
  (as re-started), after shifting it in the first section's plane so that the two outlines'
  centroids (length-weighted, of the outline as a curve) line up;
- a tie keeps the first candidate in the order start 0 forward, start 0 backward, start 1
  forward, and so on.

A section drawn the other way round is turned to match, so `"closest"` accepts sections of mixed
winding that an authored loft refuses; after re-starting, the sections must pass the same checks
as authored ones (one winding, simple, ordered along Z), otherwise the loft is refused. Side
surfaces (ruled, triangulated in revision 1, or smooth) are then built exactly as for authored
sections. The mesh and the exact backend use one rule: the exact backend passes the authored
sections to the exact kernel's `loft(…, {pairing: 'closest'})`, and the mesh applies the same
computation (`closestLoftOrders`, operation for operation) before meshing; the exact solid is
refused unless its volume equals the mesh's ruled volume (1e-7) or, for `smoothLoft`, the
smooth surface's exact volume. A re-started smooth loft's section curves start and close at the
last vertex (the kernel builds the re-started sections as wires of lines), so its surface can
differ slightly from the authored one even where no section moves. CAD Script sections are
always straight-edged single outlines, so none of the kernel's refusals for curved or
multi-outline sections apply. Example: a square drawn from its second corner on top of one drawn
from its first gives a prism with `"closest"`, and a twisted solid as authored.

The [.kcad.ts converter](CODE-CONVERTERS.md#kernelcad-kcadts-models-2026-11-24) writes
`{pairing: "closest"}` on every loft it converts. Where two starts are (nearly) equally close, as
for outlines turned by half a step, rounding the coordinates to the converter's usual 1e-6 mm could
pick the other one, so the sections of such a loft are written with every digit. A document that holds a program with a pairing
option (either value) is **document version 46**; `checkDocument` refuses it below 46, and SDKs
that predate it refuse version 46 ("unsupported format, version or units") as well as the option
itself. Programs without the option, and documents without such programs, are unchanged and keep
their version; the option changes no program revision.

For `loft` and `smoothLoft`, the existing source/token/mesh budgets still apply. Additional loft limits are
128 sections, 256 vertices per section, 4,096 total vertices and 131,072 section
intersection comparisons. No input is resampled to fit. Native edits retain their
parameters and history. SCAD/JSCAD exports are evaluated polyhedron snapshots;
the existing polyhedron import budgets can reject large exported snapshots.

The JSCAD converter supports bounded `extrudeFromSlices` procedures with explicit
callbacks returning `slice.fromPoints` or `null` for intermediate sections.
`slice.transform`, 2D/3D point input, translation/scaling matrices and safe record
spread are supported. Both caps are required; inside-out JSCAD shells are rejected rather than silently
reoriented. General tilted sections, changing
vertex counts, section holes, default callbacks and open/closed sweep modes remain
gaps. The full archived nuts-and-bolts demonstration still exceeds existing work
or generated-source budgets; its authored resolution is not reduced silently.

### Language revisions

A code object stores `program.version`, the CAD Script revision it is written in.
Revision 2 changed only `loft` (above); every other function is the same in both.

| Revision | `loft` side quads | Written by |
| --- | --- | --- |
| 1 | two triangles along a fixed diagonal | programs saved before 2026-11-26; JSCAD slice imports (JSCAD triangulates the same way); every program without a `loft` call |
| 2 | ruled surfaces | new or edited programs that call `loft`, the kernelCAD converter |

The revision belongs to the program, not to the document, so old and new lofts can sit
in one document without either changing. The session applies these rules on every edit:

- A program that does not call `loft` (anywhere in its source, whatever its parameters
  choose) is stored as revision 1, where both revisions agree. Projects without lofts
  therefore keep their document version and stay readable by older SDKs.
- New code (the code panel and workspace, `.cadcode` imports, the MCP tools,
  `scripts/convert-code.mjs`, the kernelCAD converter) is written in
  `CAD_SCRIPT_REVISION` (2). Copy, paste, duplicate and JSCAD imports keep the revision
  they have.
- Editing a program never introduces revision-1 lofts: adding a `loft` to a program that
  had none gives a ruled loft. A program that already called `loft` at revision 1 keeps
  revision 1 when edited, so its geometry only changes where its source does.
- A document that holds a revision-2 program is document version 42
  ([PARAMETRIC-MODEL.md](PARAMETRIC-MODEL.md#document-versions)); `checkDocument` refuses
  revision 2 below 42. SDKs from before revision 2 refuse version 42 ("unsupported format,
  version or units") and revision-2 programs ("Unsupported code program schema"); they never
  build a ruled loft along the diagonal.

Opening a project never changes a program's revision. To rebuild saved lofts as ruled
surfaces, open the code object and choose **Upgrade lofts to ruled surfaces** (shown only
for revision-1 programs with a `loft`), run the shared command `upgrade-lofts [all|"name"|id ...]` (terminal, command palette, MCP
`cad_run_commands`, CLI), or call `session.upgradeLofts(ids?)`: one Undo step
labelled "Upgrade lofts to ruled surfaces" that sets the selected (or every) such program to
revision 2 and raises the document to version 42; Undo restores the triangulated lofts and
the document version. Model source writes a revision-2 program as
`code(id, {...}, source, overrides, 2)`; four arguments mean revision 1.

### Bounded extrema and elliptical tapers

`minRange(i,start,end,step,value)` and `maxRange(...)` retain an extrema reduction.
The six-argument form inserts a predicate before `value`. Reductions preserve the
value's units, bind the index only inside the predicate/value, and visit at most
256 inputs under the expression work budget. Empty native reductions fail;
OpenSCAD list reductions retain undefined/guard behavior for empty results.

`ellipticFrustum(rx0,ry0,rx1,ry1,height[,segments,startAngle,endAngle,angularSegments])` retains the dimensions of an
elliptical taper. It uses centered Z placement and 4–4096 segments, subject to the
normal face budget. Ends accept two positive radii or a point `[0,0]`; line ends
are not supported. Construction produces an indexed mesh in linear space/time,
without expanding thousands of coordinates into the source. Large evaluated
polyhedron exports may exceed the existing reimport source/point budgets.

### Curved solid constructors

- `torus(majorRadius, tubeRadius [, tubeSegments, ringSegments, tubeRotation,
  sweep, start])` retains ring dimensions and angles. Angles use degrees; default
  angles are 0/360/0. Tube radius must be smaller than major radius. Segment
  defaults are 48; sweep zero contributes empty geometry. Partial rings are capped.
- `ellipsoid(radiusX, radiusY, radiusZ [, segments])` retains three radii with
  explicit latitude/longitude tessellation. A zero radius contributes empty
  geometry. It differs from the historical native `sphere` mesh, which is unchanged.
- `roundedCylinder(radius, height, capHeight [, segments])` retains a cylinder
  with elliptical rounded end caps. This is a capsule-like cap, not an edge fillet.
  Cap height must be smaller than the radius and half the total height. Zero cap
  height gives a straight cylinder using the requested segment count.

All constructors lower to existing shape/profile representations and remain under
normal source, expression, face and evaluated-geometry budgets. Ellipsoid face
cost is checked before mesh allocation. Source and parameter definitions survive
history; large evaluated polyhedron exports can still exceed reimport text limits.

### Elliptical angular sectors

`ellipticFrustum` accepts optional start/end angles in degrees after the segment
count. Defaults remain 0 and 360. Endpoints wrap; equal endpoints denote a full
turn. The count describes a full turn, with angular sectors using its proportional
integer part. At least one side segment is required; increase the count for a
very narrow sector. Caps and radial cut faces are triangulated explicitly,
including cases where changing ellipse proportions twist a radial face.

Full-turn calls keep their existing sampling/order. Angular dimensions and radii
remain editable source parameters; normal source, face and evaluation budgets
are unchanged. Collision preparation remains separately qualified and can refuse
a valid rendered construction when no accurate collider is available.

An optional final `angularSegments` overrides the number of sector intervals
directly (1–4096). JSCAD snapshots supply this count calculated in source radians,
so conversion to degrees cannot change tessellation at integer boundaries.
Native parametric models can omit it to retain density-based angular refinement.

### Reviewed archive package namespaces

`scripts/lib/openscad-bundle-namespace.mjs` assembles supplied originals beneath
one explicit checkout-directory name. For a source containing
`include <openscad-new-dimensions/constants.scad>`, retain virtual file keys such
as `openscad-new-dimensions/demo/demo.scad` and
`openscad-new-dimensions/constants.scad`. The existing bundle importer first
checks a relative candidate, then an exact supplied bundle-root candidate.
There is no suffix search, prefix stripping, ambient filesystem or URL loading.

The assembly helper rejects escaped package/file paths, normalized collisions
and accessor records. It preserves every source string and declared SHA256;
the result still requires `importOpenSCADBundle` verification of all originals,
including unused files, and unchanged byte/depth/work guards. Archive licence
review remains separate from bundle assembly and from actual mesh qualification.

The reviewed new-dimensions demo now clears its misassembled package paths,
but actual conversion refuses unsupported `parent_module(2)` at
`label.scad:21:32`. Mesh/editor/preview gates do not run after that refusal;
this correction adds no admitted model. See
`docs/evidence/package-namespace-and-wall01-trace-2026-11-15.json` for the exact
source hashes, safety tests and independent Wall01 source-to-output contact trace.

