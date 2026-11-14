# Code an object

Choose **Code** in the workbench or **Object → Code an Object…** on macOS.
The original CAD Script language describes one retained construction. Preview
builds the solid without changing the model; Create/Apply preflights the complete
model and saves one undoable edit. Errors preserve the draft and last valid solid.
Select the object and choose Code again, or expand its **Code & parameters** in
the browser, to reopen the definition. Code operands remain editable after booleans.

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
retains authored vertex correspondence and uses triangles between adjacent rings.

The existing source/token/mesh budgets still apply. Additional loft limits are
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
