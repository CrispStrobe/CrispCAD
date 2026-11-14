# OpenSCAD and JSCAD converters

The converters are independent BSD code. OpenSCAD syntax was implemented from
published language documentation. JSCAD uses the MIT Acorn 8.17.0 syntax parser,
with no transitive runtime dependencies, and an original bounded AST interpreter.
Submitted JavaScript is never passed to eval, Function, Node require or a host JS
runtime. @jscad/modeling 2.13.0 is a **test-only** independent geometry reference.
The GUI, SDK, CLI and MCP share the converters.

## Current coverage

| Input | Supported |
| --- | --- |
| OpenSCAD | Scalar/vector/boolean assignments before geometry; arithmetic, degree math and dependent parameters; top-level reusable modules and scalar/vector functions with positional/named/default arguments; declarative module/operator-local bindings; fixed vector indexing; cube/sphere/cylinder, including r1/r2 and d1/d2 tapers; parametric range/scalar-list loops, fixed vector-list loops, if/else, scalar conditional/comparison/logic expressions; centering and radius/diameter arguments; translate, XYZ/scalar-Z rotation, positive scale; union/difference/intersection and 3D convex hull; 2D profile Booleans, hulls, transforms and polygon paths/holes; linear_extrude with twist, slices and scalar/vector top scale; positive-angle rotate_extrude on nonnegative radial profiles. |
| JSCAD | CommonJS/ES imports of @jscad/modeling; exported main or explicitly selected entry; helper functions, destructuring/default arguments, arithmetic/Math; bounded loops and arrays; scalar input parameters; cube/cuboid/cylinder/sphere/polygon, rectangle/circle/ellipse profiles and planar profile transforms; 2D/3D Booleans, convex hull and hullChain; circular cylinderElliptic tapers; empty 3D geometry; translate/rotate/scale and axis shortcuts; flat output colours; basic vec2 maths and extrudeLinear with twist and steps; positive-angle extrudeRotate with start angle. |
| Native CAD Script | Primitives/CSG/transforms/repeat, frustum, hull, empty, choose, forRange and forValues, plus simple extrude, retained extrudeProfile and revolve over bounded 2D profile expressions. Profile closes automatically, needs 3–256 points, and rejects zero edges/area and self-intersections. |

Cylinder/taper tessellation supports 3–4096 segments and sphere tessellation
4–4096, subject to the 200,000 estimated-face budget. Small sphere counts may be
rounded by Manifold; triangle layout is not promised. OpenSCAD uses 48 segments
if $fn is absent, differing from its adaptive defaults. Extrusion profiles retain
the 256-point limit. Zero-sized boxes/cylinders/spheres contribute empty geometry;
a whole code object must still produce a printable solid for insertion.

OpenSCAD `color()` wrappers accept literal named/hex colors, constant RGB/RGBA
vectors in [0,1], and optional constant alpha. They preserve solid geometry while
omitting appearance; the converted CAD Script records that omission explicitly.
Computed color expressions and unsupported arguments are diagnosed.

Source limit is 32 KiB. JSCAD has 20,000 interpreter steps, 64 iterations per loop,
256 array items and call depth 32. The parsed AST is bounded to 8,192 nodes
and depth 128. Existing native expansion/mesh budgets also apply.
Errors carry a source location and machine-readable diagnostic code. Native
construction validation errors from SCAD imports point to the originating
top-level construction call; they do not claim an exact inner-expression span. Resource
limits are distinct from unsupported features and malformed input.

Known gaps, deliberately diagnosed:

- OpenSCAD include/use, recursive conditional function evaluation, vector/string
  conditional expressions, multiple loop bindings in one for (nest for operators),
  nested definitions, module
  child operators, global reassignment/assignment after geometry, assignments in
  anonymous blocks, 2D-profile-local bindings,
  negative/cross-axis revolutions, minkowski, imported
  meshes and arbitrary-axis transforms. BOSL2 library execution is not supported.
- JSCAD external/local modules, arbitrary JavaScript/host APIs, unsupported math
  helpers and geometry APIs, slice/callback extrusion, tapered-profile export,
  lofts, curved sweeps and per-face materials. The pinned nuts-and-bolts
  example currently stops specifically at extrusions.extrudeFromSlices.

This is a tested subset, not a full OpenSCAD or JSCAD implementation. The goal is
to make missing capabilities reproducible, then extend coverage from real files.

## Retained parameters and outputs

OpenSCAD scalar assignments become editable native parameters. Modules expand
symbolically: changing a retained parameter recomputes every expanded use, rather
than baking it into a snapshot. Named vectors retain their scalar dependencies;
vector indices currently require literal nonnegative integers. Module defaults
use the definition scope; regular caller arguments do not leak into called modules.
Special `$fn` parameters propagate through calls. Only file-scope module/function definitions are supported; `children()` and nested
definitions remain explicit gaps. User functions expand scalar or vector results,
including generated polygon points, while retaining scalar dependencies.

Module and operator block assignments use lexical scope. The final assignment
applies throughout that scope, so geometry can precede its local declarations.
Captured bindings resolve in their defining scope even when an inner scope shadows
the same name. Cycles and dependency chains deeper than 32 are diagnosed. Anonymous
blocks have different scope behavior in OpenSCAD: assignments there are explicitly
rejected until scope flattening is implemented. Global assignments still need to
precede geometry and cannot be reassigned. Unused declarations/definitions need
not produce geometry; a library-only file is not an instantiable solid.

Range and scalar-list loops lower to native forRange/forValues templates and
recompute their instance counts, positions and dimensions after parameter edits.
Fixed vector-list loops expand symbolically. Loops allow at most 64 values each,
with global expansion/node/face budgets and a 4,096-evaluation guard against nested
explosion. Two-component descending ranges retain the documented legacy OpenSCAD
endpoint-swapping behavior; explicit stepped ranges remain directional.

Native choose resolves only the selected shape branch. Scalar conditions use an
AST with short-circuit &&/|| and lazy ternary evaluation, retaining native parameter
dependencies. Inactive numerical domains do not fail. Booleans retain their type
for equality (true is not the number 1). Dimensions are checked; shape dimensions
must be numeric. Recursive source functions still expand symbolically and hit
explicit recursion limits rather than implementing general recursive execution.

Math functions include degree-based sin/cos/tan and inverse trigonometry, atan2,
sqrt, abs, floor/ceil/round, exp/ln/log, pow and min/max. This bounded whitelist is
also available to native parameter formulas. Invalid domains/nonfinite results
fail; inverse trigonometry returns scalar degree values. Symbolic expressions
are capped at 256 characters, preventing recursive argument expansion from
exhausting memory. Construction depth and statement limits also apply.

JSCAD is converted at selected parameter values into an **evaluated snapshot**. Its interpreter
honours declared numeric ranges/integers; numeric/boolean string overrides can be
normalized from MCP input. Keep the original source for JSCAD parametric changes.

- Native .cadcode export applies local overrides as source defaults and preserves
  dependent expressions. It remains editable native code.
- OpenSCAD/JSCAD export resolves parameter values but retains procedural CSG,
  transform order and profile extrusion. It is explicitly labelled a snapshot.
- importJSCAD returns separate outputs, flat colours, input values and warnings.
  The code editor imports a single combined rigid body and explains this choice.
- CLI --to bcad preserves separate roots and flat colours, verifies geometry, and
  writes a new history-inclusive project. It keeps original source coordinates;
  the GUI's new-object workplane placement is a separate interaction.
- CLI file exports include a .conversion.json sidecar with exact original source,
  its hash, conversion inputs and warnings. Existing files are not overwritten.
  These sidecars do not invent a licence grant: retain upstream licence files and
  author/provenance metadata from the library manifest alongside converted assets.

## CLI

Build the workspace packages first. Commands emit one JSON result; exit 2 means
conversion failed. They make no source-requested file/network calls.

```sh
npm ci
npm run build:packages
node scripts/convert-code.mjs part.scad --to jscad --out part.jscad
node scripts/convert-code.mjs gear.js --to bcad --parameters '{"numTeeth":20}' --out gear.bcad
node scripts/convert-code.mjs mountPlate.js --entry create --args '[25]' --to cadcode
```

--from openscad|jscad|cadcode overrides extension detection. --locale de localizes
human diagnostics; JSON field names stay stable. Without --out the JSON result
includes converted source. .bcad files contain a new complete history archive;
the converter never modifies an existing model or prunes existing revisions.

## VPS library handoff

Use core APIs importOpenSCAD(source), importJSCAD(source, parameters,
{entryPoint, arguments}), exportOpenSCAD(program), exportJSCAD(program) or
exportCodeSource(program). importJSCAD exposes both a combined program and its
individual outputs. The script module exports convertSource for Node consumers.
MCP cad_convert_code accepts input/output formats, source, parameter overrides and
optional JSCAD entryPoint/arguments, without changing its model/history session.

For batch bring-up:

```sh
node scripts/check-code-corpus.mjs --manifest /path/library/manifest.json --report /tmp/conversion-report.json
```

Manifest shape (paths are relative to the manifest):

```json
{"models":[{"id":"part-001","file":"parts/part.scad","format":"openscad","sha256":"...","license":"MIT","licenseFile":"LICENSE","expected":"converted"}]}
```

Optional per-file fields: parameters, entryPoint and arguments. For a tracked gap,
use expected:"unsupported" and expectedGap:"extrusions.extrudeFromSlices" (or the
appropriate stable API/feature identifier). Leave expectations absent for discovery.
Reports separate converted, unsupported, limited, failed and unexpected outcomes,
with source locations, actual geometry volume/bounds/triangles and elapsed time.
--strict also fails for known unsupported/limited entries. A changed declared
source hash is an integrity failure, not an unsupported feature.

The small local seed corpus has nine pinned files, exact hashes and full MIT/BSD
licences: three JSCAD components, one slice-extrusion gap, three OpenSCAD transform
fixtures, and two BOSL2 include gaps. No large library is being built here; the VPS
agent owns collection and curation. Use source hash + converter revision + entry
and parameter values as the conversion cache key. Fresh .bcad project IDs/history
timestamps make raw archive bytes unsuitable as a deterministic geometry key.
Successful conversion is not a Jolt qualification; keep that pipeline separate.

## Evidence and next extensions

Six of nine upstream fixtures convert to evaluated positive-volume solids; three
are explicit known gaps. The involute gear matches JSCAD volume and bounds and
also works at 20 teeth. The module-design component works via create(25), and
Basic Booleans retains five output records and flat colour metadata. All 34 native
examples round-trip via the supported OpenSCAD and JSCAD syntax. Exported JSCAD is
checked against the actual MIT modeling library for volume and bounds.

Next valuable work is typed source-expression/list handling, anonymous-scope flattening,
callback/slice loft IR and 2D profile operations. Add a small pinned failing fixture with exact
licence/provenance for each capability before changing the converter. Never turn
an unsupported operation into an unreported approximation or execute source JS.

Historical checkpoint: d946a9b was pushed while the extrusion work was in progress.
Current validation and delivery notes are recorded in DELIVERY.md.

Language behavior references: [OpenSCAD modules and functions](https://files.openscad.org/documentation/manual/User-Defined_Functions_and_Modules.html),
[mathematical functions](https://files.openscad.org/documentation/manual/Mathematical_Functions.html) and
[variable scope](https://files.openscad.org/documentation/manual/General.html#Scope_of_variables).
The installed MIT JSCAD 2.13.0 API and independent test geometry establish the
profile defaults, centering and radian transform behavior. No GPL implementation
was used.

## Profile engine and measured coverage — 2026-11-14

Profiles now remain a native 2D construction tree through parameter recomputation.
`rectangle2d`, `circle2d`, `polygon2d(points, paths)`, planar transforms and
`union2d`/`subtract2d`/`intersect2d`/`hull2d` evaluate through Manifold CrossSection.
Polygon contours use even/odd filling, including holes. Each contour must be simple;
self-intersection is rejected. Extrusions have 1–256 steps. Evaluated profiles are
capped at 16,384 vertices and post-clipping extrusion/revolution estimates at
200,000 faces, in addition to source and expansion budgets. Profile-local named
references, loops, module calls and local bindings are not implemented yet.

SCAD twist uses its documented left-hand convention; the native kernel and JSCAD
use right-hand angles. Conversion changes the sign. Revolution segment counts
refer to a complete turn and are proportionally reduced for a partial turn.
Negative/cross-axis radial profiles are refused rather than silently clipped.
`convexity` is preview-only and does not affect our rendered solid.

Curved meshes are **not bit-identical upstream reproductions**. Manifold and JSCAD
triangulate nonplanar twisted side faces differently. The checked off-axis 2×1 mm
rectangle, height 10 mm, twist 90°, eight steps has native volume 18.246149 mm³
versus JSCAD 21.497655 mm³. At 128 steps both are within 0.6% of the ideal
20 mm³ volume, but differ by about 1.03% relative to native. Tests preserve this
limitation explicitly; JSCAD conversion warns and SCAD-generated source comments
identify native tessellation. Use adequate resolution and verify critical parts.
This is tessellation loss, not retained exact B-rep CAD.

The fixed research sample improves from **38/256 to 42/256** positive-solid
conversions, with no previously converted file regressing. Four unsupported files
now convert; two now reach explicit resource limits. Final counts: 42 converted,
204 unsupported, 7 limited, 3 failed. This is a deterministic evenly spaced sample
of deduplicated files, **not** a general compatibility percentage or fidelity score.
Sources, raw reports and generated research geometry remain outside the repository.
Reviewed local corpus: **39 converted, two explicitly unsupported seeds**. The GUI
admits those 39 working sources, including three new CC0 files with independently
checked volumes, exact source hashes, licence evidence and previews.

The remaining research blockers include strings, colour/echo operators, library
include/use, module children, reassignment, profile-local constructs and mesh/sweep
features. The underlying kernel can already perform many operations; converter
language semantics and the exposed construction IR remain the larger coverage gap.
JSCAD parameters still become evaluated snapshots; per-face colours and original
foreign feature identities are not retained. Tapered profiles round-trip through
native CAD/SCAD; JSCAD export refuses them until slice extrusion is supported.
