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
| OpenSCAD | Typed scalar/vector/string values; final file/block assignments and forward references; lexical nested modules/functions and defaults; `children()` and indexed children; parameter-driven conditionals and multi-binding range/list loops; vector arithmetic/components/indexing; primitives including planar-faced polyhedra; reflections, signed scale, arbitrary-axis rotation, resize without automatic axes; hull and bounded 2D/3D Minkowski sums; profile Booleans, holes, loops, modules, text and round/sharp offsets; twisted/tapered linear extrusion and positive-angle revolution. |
| JSCAD | Bounded CommonJS/ES modeling imports, helper functions, destructuring, arrays, loops and scalar input parameters; existing primitives plus indexed polyhedra; 2D/3D Booleans/hulls/hullChain; planar profiles and twisted extrusion; positive-angle rotational extrusion; 3D reflection and transforms; evaluated snapshots and flat output-colour metadata. |
| Native CAD Script | Retained CSG including Minkowski, indexed planar-faced polyhedra, signed scale, mirror, arbitrary-axis rotation and resize; typed 2D construction trees with holes, text, offsets and profile loops/choices; extrusion/taper/twist/revolution; existing numeric parameters, patterns and lazy branches. |

Cylinder/taper tessellation supports 3–4096 segments and sphere tessellation
4–4096, subject to the 200,000 estimated-face budget. Small sphere counts may be
rounded by Manifold; triangle layout is not promised. OpenSCAD uses 48 segments
if all fragment controls are absent, differing from OpenSCAD adaptive defaults. Explicit
$fa/$fs use radius-dependent fragment calculations for circles and cylinders;
An explicit positive $fn takes precedence. Small sphere meshes still use native tessellation. Extrusion profiles retain
the 256-point limit. Zero-sized boxes/cylinders/spheres contribute empty geometry;
a whole code object must still produce a printable solid for insertion.

OpenSCAD strings remain typed values, separate from numeric CAD expressions.
Global settings, local bindings, module/function results, string indexing and
bounded string helpers can feed colour selectors or geometry conditions. Numeric
selectors may retain choices between string, vector and profile values; numeric
coordinates keep their parameter dependencies. Strings are never coerced into
numeric dimensions or interpolated as executable native source. Array indexing
accepts supported scalar expressions, including global/local parameters, loop
bindings and function results. Missing or out-of-range entries produce undefined
values that can be guarded with `is_undef`; an unhandled undefined numeric
dimension is rejected. Mixed typed arrays are supported without making their
string members numeric.

`color()` validates named/hex strings or constant RGB/RGBA components in [0,1],
with optional constant alpha. Supported computed selectors and string flows
reach that same validation. Appearance colours and transparency are omitted from
the solid conversion, and notices survive in generated source and through
`getOpenSCADImportWarnings`. `echo()` console output is also omitted with a notice.
Local bindings are memoized within their lexical invocation, and cumulative
16,384-value-visit, array-size, depth and native construction limits bound actual
work; compact alias graphs do not permit unbounded expansion.

Source conversion uses the full-render context: the read-only `$preview` builtin
is `false`, and a note is added to converted CAD Script only when the builtin is
read. Source assignments and parameter/named-argument overrides are rejected;
the boolean builtin cannot supply a numeric index. Exported OpenSCAD/JSCAD
snapshots contain explicit resolved facet counts, so they do not depend on
preview mode. This adds no UI preview-mode setting. The fixed context follows
the official [`$preview` documentation](https://files.openscad.org/documentation/manual/The_OpenSCAD_Language.html#$preview)
for full rendering; this subset diagnoses upstream-style overrides instead of
supporting a configurable source context.

Supported special fragment controls propagate through module and transform
calls. Nested scopes restore the enclosing values, and an explicit positive
`$fn` takes precedence over adaptive `$fa`/`$fs` calculations. Curved geometry
keeps the stated finite segment and mesh budgets. The `#` highlight modifier
retains its child geometry and records omitted highlight appearance. `%`
background and `*` disabled geometry are excluded from full-render output;
`!` selects root geometry instead of retaining unrelated roots. These are
render semantics, not blanket permission to ignore an unsupported active
operation. The language references cover
[special variables](https://files.openscad.org/documentation/manual/The_OpenSCAD_Language.html#Special_variables)
and the [debug modifier](https://files.openscad.org/documentation/manual/The_OpenSCAD_Language.html#Debug_Modifier).

For the built-in 3D `translate()` only, Brickwright normalizes a numeric `[x,y]`
vector to `[x,y,0]` and records that interpretation in converted CAD Script.
Named arguments, symbolic coordinates, lexical module bindings and scoped `$fn`
keep their existing behavior. This compatibility rule does not relax rotation,
scale or primitive size vectors, and does not repair original source files.
The official [OpenSCAD mailing-list discussion](https://lists.openscad.org/empathy/thread/SDXLQNVUH347BJKWM2J3VAUXTNH4NVUT)
describes translation lists of two or three numbers. The independent importer
tests establish Brickwright's XY/zero-Z interpretation; they do not claim a
native OpenSCAD execution or parity with every upstream version.

Source limit is 32 KiB. JSCAD has 20,000 interpreter steps, 64 iterations per loop,
256 array items and call depth 32. The parsed AST is bounded to 8,192 nodes
and depth 128. Existing native expansion/mesh budgets also apply.
Errors carry a source location and machine-readable diagnostic code. Native
construction validation errors from SCAD imports point to the originating
top-level construction call; they do not claim an exact inner-expression span. Resource
limits are distinct from unsupported features and malformed input.

Known gaps, deliberately diagnosed:

- External `include`/`use`, library resolution (including BOSL2), array/list
  comprehensions, randomness/search helpers, symbolic numeric-to-string formatting,
  general matrix arithmetic, anonymous-block assignment semantics, external meshes,
  surface/image geometry, automatic resize axes and arbitrary-axis profile rotations.
  Parameter-dependent recursive functions remain bounded rather than becoming an
  unrestricted evaluator. Negative/cross-axis rotational profiles remain refused.
- JSCAD slice/callback extrusion, general lofts/sweeps, external/local modules and
  host APIs remain unsupported. Export to JSCAD refuses native Minkowski/resize,
  text/offset profiles and tapered-profile extrusion where no supported lowering
  exists. No flattening or substitute bounding solid is emitted.

This is a tested subset, not a full OpenSCAD or JSCAD implementation. The goal is
to make missing capabilities reproducible, then extend coverage from real files.

## Retained parameters and outputs

OpenSCAD numeric assignments become editable native parameters. Modules and
functions expand symbolically, retaining dependencies. Nested definitions capture
their declaring variable/function/module environments; defaults use the definition
scope. Duplicate definitions and assignments use the final declaration in that
scope. `children()` evaluates caller geometry in the dimensional context of its
consumer. String, vector and component/index expressions retain supported numeric
selectors. Missing values can be guarded with `is_undef`; unselected constant
branches are not evaluated. `$fn` and other supported special controls pass through
module and transform scopes. `$preview` is a read-only full-render false value.

Module and operator block assignments use lexical scope. The final assignment
applies throughout that scope, so geometry can precede its local declarations.
Captured bindings resolve in their defining scope even when an inner scope shadows
the same name. Cycles and dependency chains deeper than 32 are diagnosed. Anonymous
blocks have different scope behavior in OpenSCAD: assignments there are explicitly
rejected until scope flattening is implemented. File assignments are hoisted and their final definitions apply even after geometry. Unused declarations/definitions need
not produce geometry; a library-only file is not an instantiable solid.

Range and scalar-list loops lower to native forRange/forValues templates and
recompute their instance counts, positions and dimensions after parameter edits.
Fixed vector-list loops expand symbolically. Loops allow at most 64 values each,
with global expansion/node/face budgets and a 16,384-evaluation guard against nested
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
are capped at 1,024 characters, preventing recursive argument expansion from
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

Next valuable work includes bounded list comprehensions, anonymous-scope flattening,
callback/slice loft IR and the remaining profile/export gaps. Add a small pinned failing fixture with exact
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

## Earlier profile-engine checkpoint — 2026-11-14

This measured checkpoint predates the expanded language pass below. Its counts
and refusals record that evaluation; they are not current capability claims.

Profiles remain a native 2D construction tree through parameter recomputation.
`rectangle2d`, `circle2d`, `polygon2d(points, paths)`, planar transforms and
`union2d`/`subtract2d`/`intersect2d`/`hull2d` evaluate through Manifold CrossSection.
Polygon contours use even/odd filling, including holes. Each contour must be simple;
self-intersection is rejected. Extrusions have 1–256 steps. Evaluated profiles are
capped at 16,384 vertices and post-clipping extrusion/revolution estimates at
200,000 faces, in addition to source and expansion budgets. At this checkpoint,
profile-local named references, loops, module calls and local bindings were not
implemented; the expanded language pass now supports them.

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
At that checkpoint the reviewed local corpus had **39 converted, two explicitly
unsupported seeds**. Its GUI admitted those 39 working sources, including three new CC0 files with independently
checked volumes, exact source hashes, licence evidence and previews.

That research run recorded blockers in strings, colour/echo operators, library
include/use, module children, reassignment, profile-local constructs and mesh/sweep
features. Several language blockers are resolved by the expanded pass below; the
historical report has not been relabelled as a new screening run. The current
gaps listed above still require explicit converter or kernel work.
JSCAD parameters still become evaluated snapshots; per-face colours and original
foreign feature identities are not retained. Tapered profiles round-trip through
native CAD/SCAD; JSCAD export refuses them until slice extrusion is supported.

## Expanded language and engine pass — 2026-11-14

The independent translator now uses a typed value parser rather than treating
all input as numeric text. Literal strings remain distinct from scalar expressions;
no string can inject native source. Numeric parameter dependencies remain editable.
String settings resolve at conversion and are reported as such; numeric selectors
can retain choices between string/profile branches. Unknown/missing values can be
tested with `is_undef`. Inactive constant branches and boolean guards are lazy.
File-scope assignments use the final declaration even after geometry. Module input
normalization reads the incoming value instead of creating a false cycle.

Local bindings are immutable and memoized within their lexical invocation. Their
captured module/function environments do not change under inner shadowing. A
16,384-value-visit budget bounds actual expansion; shared alias DAGs can be indexed
without expanding every branch. Source is still limited to 32 KiB / 8,192 tokens,
call/nesting depth 32, 64 values per loop, and 4,096 translator construction visits.
Native limits are 256 statements, 1,024 expanded nodes, 16,384 evaluation steps and
200,000 estimated/evaluated faces. Scalar expressions allow 1,024 characters and
512 tokens; these are finite execution limits, not complete-language promises.

Text profiles use the existing unmodified Apache-2.0 Droid vector fonts, shared
with manual lettering. An original bounded outline decoder feeds CrossSection;
Three's independent font/shape path supplies the test reference. Font metrics,
style and kerning may differ from the foreign source and are disclosed. Supported
text is left-to-right, at most 128 printable glyphs, with explicit missing-glyph
errors. Profile offsets support round or sharp miter joins; chamfer joins remain
refused. Planar Minkowski uses convex/triangle decomposition and union of actual
pair sums, with a pair budget, rather than substituting a hull of the whole input.
Polyhedron faces are planar, simple and triangulated with original bounded ear
clipping; SCAD winding is reversed into the native convention.

Conversion notices survive in generated code and are exposed through
`getOpenSCADImportWarnings` to GUI, CLI, MCP and insertion provenance. The GUI
shows a brief status and collapsed notes. Source colours/transparency and preview
highlights are omitted explicitly; render-disabled/background geometry is excluded.
Actual kernel resource refusals carry `resource-limit` through feature diagnostics.

That integration included the VPS agent's 74 reviewed MIT source models alongside
the existing 39 entries. Subsequent explicitly screened additions are tracked in
[the library catalogue notes](../library/README.md#external-corpus-models-available-in-the-editor). A corrected scoped-$fn walking-stick
mesh uses a new derivative path; the previous file remains byte-identical for
historical provenance; the [previous qualification record](../library/corpus-audit/qualification-history/walking-stick-v1.json) is retained. Archived sources are unchanged and qualification is
separate from admission and runtime collision checks.
