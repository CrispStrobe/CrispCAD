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
| OpenSCAD | Typed scalar/vector/string values; final file/block assignments and forward references; lexical nested modules/functions and defaults; `children()` and indexed children; parameter-driven conditionals and multi-binding range/list loops; vector arithmetic/components/indexing; primitives including planar-faced polyhedra; reflections, signed scale, arbitrary-axis rotation, affine matrices and automatic 2D/3D resize; hull and bounded 2D/3D Minkowski sums; profile Booleans, holes, loops, modules, text and round/sharp offsets; twisted/tapered linear extrusion and signed revolution. |
| JSCAD | Bounded CommonJS/ES modeling imports, helper functions, destructuring, arrays, loops and scalar input parameters; existing primitives plus indexed polyhedra; 2D/3D Booleans/hulls/hullChain; planar profiles and twisted extrusion; positive-angle rotational extrusion and affine transforms; 3D reflection and transforms; evaluated snapshots and flat output-colour metadata. |
| Native CAD Script | Retained CSG including Minkowski, indexed planar-faced polyhedra, signed scale, mirror, arbitrary-axis rotation and resize; typed 2D construction trees with holes, text, offsets and profile loops/choices; extrusion/taper/twist/revolution; existing numeric parameters, patterns and lazy branches. |

Cylinder/taper tessellation supports 3–4096 segments and sphere tessellation
4–4096, subject to the 200,000 estimated-face budget. Small sphere counts may be
rounded by Manifold; triangle layout is not promised. OpenSCAD uses 48 segments
if all fragment controls are absent, differing from OpenSCAD adaptive defaults. Explicit
$fa/$fs use radius-dependent fragment calculations for circles and cylinders;
$fn takes precedence. Small sphere meshes still use native tessellation. Extrusion profiles retain
a bounded generated-point path as well as literal polygons. Zero-sized boxes/cylinders/spheres contribute empty geometry;
a whole code object must still produce a printable solid for insertion.

OpenSCAD `color()` accepts validated named/hex strings, constant RGB/RGBA
vectors in [0,1], and optional constant alpha. Appearance is omitted and disclosed
in conversion notes. Strings remain distinct from numeric expressions; they cannot
supply dimensions. Typed palettes and vectors may flow through lexical bindings,
module/function arguments, loops, and computed or parameter-driven indices.
Indices must resolve to valid integers; boolean indices are refused. Numeric
selectors retain lazy choices rather than flattening parametric geometry.
Immutable binding evaluation is memoized, with a shared 16,384-value visit guard.
`assert(condition[, message])` supports standalone statements, solid/profile child
chains and expression chains. Failed assertions abort the whole code object;
they do not discard just the asserted solid. Parameter-dependent conditions remain
in native assertion guards and are checked again on edits. Expression guards
support numeric scalars and nonempty nested numeric vectors, including structural
inspection and helper arguments. Constant successful assertions can return other
typed values. Parameter-dependent empty/string results and asserted loop
or comprehension input vectors, and assertions inside omitted `echo()` output,
and combinations with the `!` root modifier are rejected rather than losing
their checks.
Literal and parameter-driven messages are retained in statement and expression
assertions. Diagnostic text is parsed data, never executed as JavaScript. The existing resource limits also bound assertion
expansion. Exported geometry is an already validated snapshot.

Simple fixed-cardinality comprehensions can also appear among literal list
members, for example `[[0,0], for(i=[0:2]) points[i]]`; their generated elements
are flattened into that list. Each generator retains the 256-iteration bound and
the complete resulting list retains the 256-item bound. Up to eight sequential
bindings per generator and chained `for` generators are supported; inner binding
ranges can depend on already resolved outer values. One-level `each` accepts
fixed vectors (or a single scalar) and preserves contained assertion guards.
Filters retain numeric dependencies; C-style generators remain unsupported.

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

Conversion uses a full-render context: read-only `$preview` is `false`, with a
note only when it is read. Source assignments and argument/parameter overrides
of `$preview` are refused. Supported fragment controls pass through module,
transform and extrusion scopes; nested scopes restore the enclosing values and
explicit primitive counts take precedence. Export snapshots resolve facet counts.
The `#` modifier retains geometry with an omitted-appearance note; `%` and `*`
exclude their child geometry from the rendered solid; `!` selects a 3D root.
These semantics follow the official language documentation for
[special variables](https://files.openscad.org/documentation/manual/The_OpenSCAD_Language.html#Special_variables)
and [modifiers](https://files.openscad.org/documentation/manual/The_OpenSCAD_Language.html#Debug_Modifier).

SCAD source is bounded to 32 KiB / 8,192 tokens, construction translation to
4,096 visits and recursion to 32 levels. Native execution permits 256 statements,
4,096 expanded nodes and 16,384 evaluation steps; expressions permit 1,024
characters / 512 tokens. The 200,000 estimated-face budget remains in force.

Source limit is 32 KiB. JSCAD has 20,000 interpreter steps, 64 iterations per loop,
256 array items and call depth 32. The parsed AST is bounded to 8,192 nodes
and depth 128. Existing native expansion/mesh budgets also apply.
Errors carry a source location and machine-readable diagnostic code. Native
construction validation errors from SCAD imports point to the originating
top-level construction call; they do not claim an exact inner-expression span. Resource
limits are distinct from unsupported features and malformed input.

Known gaps, deliberately diagnosed:

- External `include`/`use`, library resolution (including BOSL2), C-style comprehensions, unrestricted recursion, some dynamic searches and list operations,
  anonymous-block assignment semantics, external meshes,
  surface/image geometry and automatic resize with multiple specified target dimensions.
  Parameter-dependent recursive functions remain bounded rather than becoming an
  unrestricted evaluator. Cross-axis rotational profiles remain refused; wholly negative radial profiles and clockwise sweeps are supported.
- Ambient library resolution (including BOSL2); explicit local
  `include` and file-scope `use` bundles are supported. Comprehension filters/C-style and
  variable-cardinality generators, symbolic random arguments, search outside fixed tables,
  symbolic numeric-to-string formatting,
  general matrix arithmetic, anonymous-block assignment semantics, external meshes,
  surface/image geometry, automatic resize axes and arbitrary-axis profile rotations.
  Parameter-dependent recursive functions remain bounded rather than becoming an
  unrestricted evaluator. Negative partial-turn and cross-axis rotational profiles
  remain refused; wholly left-side complete turns are supported.
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
Fixed vector-list loops expand symbolically. SCAD/native geometry loops allow at most 256 values each; native repeat remains capped at 64,
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
self-intersection is rejected. Extrusions have 1–4,096 steps. Evaluated profiles are
capped at 16,384 vertices and post-clipping extrusion/revolution estimates at
200,000 faces, in addition to source and expansion budgets. Profile-local named
references, loops, module calls and local bindings are not implemented yet.

SCAD twist uses its documented left-hand convention; the native kernel and JSCAD
use right-hand angles. Conversion changes the sign. Revolution segment counts
refer to a complete turn and are proportionally reduced for a partial turn.
Complete 360-degree revolutions accept profiles wholly on either side of the
radial axis. Left-side profiles are reflected radially before evaluation.
Negative partial-turn and crossing-axis profiles remain refused. JSCAD export
uses an explicit planar radial mirror for a wholly left-side full turn;
conservative profile bounds may refuse an export when the side is uncertain.
This implements the documented [OpenSCAD half-plane rule](https://files.openscad.org/documentation/manual/2D_to_3D_Extrusion.html)
for full turns without inspecting the upstream implementation.
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
call/nesting depth 32, 256 values per geometry loop, and 4,096 translator construction visits.
Native limits are 256 statements, 4,096 expanded nodes, 16,384 evaluation steps and
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

The integrated offline library includes the VPS agent's 74 reviewed MIT source
models alongside the existing 39 entries. A corrected scoped-$fn walking-stick
mesh uses a new derivative path; the previous file remains byte-identical for
historical provenance. Archived sources are unchanged and qualification is
separate from admission and runtime collision checks.

## Measured engine expansion — 2026-11-14

The frozen 256-file research sample now yields **137 positive solids**, versus
42 before this pass: 95 newly successful, all 42 previous successes retained.
Remaining outcomes are 74 unsupported, 29 resource-limited, 15 failures and one
15-second process timeout. The final run uses a 15-second per-file deadline;
the baseline used five seconds with no timeouts. A separate five-second replay
on the pre-merge implementation produced 134 positive solids and four timeouts.
These are execution outcomes, not semantic-equivalence or speed claims.

The main remaining blockers include external `use`/`include` dependencies,
comprehensions, `rands`/`search`, matrix/vector operations outside the supported
subset, source/expansion/mesh budgets, and empty or invalid constructions.
Aggregate hashes, transitions and caveats are recorded in
[evidence/import-engine-coverage-2026-11-14.json](evidence/import-engine-coverage-2026-11-14.json).
Original analytic fixtures, MIT JSCAD comparisons and real Jolt hole queries
validate specific operations independently; the corpus itself has no geometry
oracle. No research models are admitted through this measurement.

## Retained arrays, transforms and notice gaps — current continuation

Generated polygon points retain nested range/list generators, filters, let bindings,
indexing and supported reductions. Native derived scalar `const` expressions can
resolve in their consuming loop scope; generated aliases are hidden from editable
parameter controls. Matrix products, affine transforms, profile projection,
clockwise/negative-side revolution, one-target automatic resize and assertions
share the retained native engine. Signed revolution snapshots lower to reflected
positive sweeps for JSCAD; uncertain radial bounds are explicitly diagnosed.

Native geometry loops permit 256 values, with 4,096 expanded nodes and the unchanged
200,000 estimated/evaluated face cap. Scalar AST caching stores syntax only, never
lookup values or host callbacks. Font complexity metadata improves work estimates;
it does not fix font substitution. Extra harmless argument names are disclosed;
known unsupported geometry arguments are still refused.

Notices are now stable records retrievable through `getCodeImportNotices`. The
[gap register](CONVERTER-GAPS.md) covers every notice and its acceptance work.
Numeric lettering now follows executable-tested SCAD formatting, and custom
assertion messages survive parameter edits in both solids and profiles. Original
saved native programs retain their earlier formatting. Random streams, exact
fonts/shaping, materials, string parameters and JSCAD source-backed parameters
remain explicit work rather than being hidden behind successful-solid counts.

Concurrent reviewed-library work adds an explicit unbound `$t=0` notice, scalar
fragment defaults and distinct construction-depth diagnostics. These are merged
with retained comprehensions; fixed-cardinality lists materialize symbolically,
while supported parameter-dependent polygon generators remain live. The animation
notice is tracked separately from mechanical simulation in CONVERTER-GAPS.md.

### Bounded function values and SCON defaults — 2026-11-14

Function literals (`function(x) expression`) can be stored in variables, passed
as arguments and returned by functions. Calling a named function-valued variable
uses the existing bounded function evaluator and a captured lexical environment.
Numeric dimensions can remain symbolic through closure calls. Expression-level
`let` evaluates bindings sequentially; `is_function` distinguishes function values.
Immediate chained calls and parameter-dependent choices between callable values
remain unsupported. Function values never become executable JavaScript or new
runtime geometry kinds. Assertions on unsupported typed returns are refused.

`search` supports a fixed needle list and a fixed list/table, optional constant
match count (zero means all), and an optional constant column. Only matches that
resolve during conversion are accepted; parameter-dependent match membership is
refused. Every comparison consumes the existing evaluation budget. Existing
32-level function/construction depth and source, token and array limits remain.
These semantics were implemented from published language documentation, without
reading the GPL implementation:
[function literals](https://files.openscad.org/documentation/manual/User-Defined_Functions_and_Modules.html),
[search](https://files.openscad.org/documentation/manual/Other_Language_Features.html).

The six unchanged SCON example roots improved from 0/6 to 5/6 strict STL passes.
`ex1`, `ex2`, `ex3`, `ex4` and `tldr` are admitted separately; `ex5` reaches the
unchanged construction-depth limit of 32 and remains excluded. This does not
qualify arbitrary SCON configuration edits, JSON import or unused helpers.


### Generated-list cohort and warned text argument — 2026-11-14

The authored `dinther--pathbuilder/meshbuilder.scad` default now parses its
multi-binding and `each` syntax, then hits the unchanged 16,384-step value-work
limit. It remains excluded. `thehans--FunctionalOpenSCAD/functional.scad` first
requires unsupported `version_num` and also remains excluded. This pass changes
no source, iteration, output-list, depth, token or work limits, and does not claim
that either generated-list demo produces a qualified solid.

The unchanged Angelo `Coin_02.scad` default does pass after accepting the
nonstandard `text(center=...)` argument as a warned ignored argument. Default
left/baseline alignment is retained; `center` is not converted into text alignment.
Its argument assertion checks are retained even though the argument value is not
used. Other unknown text arguments remain refused. The existing bundled Droid
font fallback and font-metric warning still apply. The authored `Sign_03.scad`
remains a strict topology failure. Outcomes and runtime identities are retained in
`library/corpus-audit/editor-screening-cycle20.json`.


### Symbolic choices and shared scalar expressions — 2026-11-14

Arithmetic can retain undefined alternatives from symbolic vector indexing;
string arithmetic stays refused. Type predicates with identical results in all
alternatives resolve without retaining a redundant type branch. `len` of a
non-list/non-string value remains undefined. Assertions on conditional values
and undefined results retain explicit guards through type inspection, arithmetic
and otherwise unused arguments; failing edits remain atomic.

Long scalar formulas can be shared as lazy native `const` aliases. The importer
still refuses an individual generated expression above 1,024 characters and the
native source, token, statement, dependency and work limits still apply. Aliases
do not become editable parameters or eagerly evaluate inactive branches.

The two unchanged A2D defaults measured in `editor-screening-cycle21.json`
improved from 0/2 to 1/2 strict STL passes. `GrillCircle` passes at 3,372 triangles
and 80×80×2mm. `ParametricBoxWithLid` now reaches the unchanged importer work
limit and stays excluded; this transition is not an admission gain. No further
retries of that over-budget default are part of this cohort.

## Scoped local `use` bundles (cycle 23)

`importOpenSCADBundle` resolves both `include` and file-scope `use` only from
explicit, SHA-256-verified in-memory originals. Existing path, aggregate byte/token,
occurrence, cycle and depth guards remain unchanged. `use` imports only direct
module/function declarations. Library assignments remain lazy in an isolated file
scope and do not become caller parameters. Library root geometry and assertions
are retained as original text but never evaluated. Nested `use` stays within the
containing library; textual `include` declarations remain exportable. Caller
`children()` retain their original lexical environment. Ambient loading remains
unsupported. The implementation follows the published
[include/use documentation](https://files.openscad.org/documentation/manual/Include_Statement.html),
without consulting upstream compiler implementation.

The exact archived `Scene_House.scad` and its four dependencies now produce
26.810686449 mm³ of geometry and a 2,284-triangle STL. Direct editor insertion,
serialization and undo/redo pass. Strict STL topology fails: 44 invalid edges and
54 invalid vertex fans, including an edge with four incident faces. The source
remains excluded: **0/1 qualified before, 0/1 after; no new admission**. See
`library/corpus-audit/editor-screening-cycle23.json`. No source repair or limit
change was applied. Seven other ranked `use` roots retain independent blockers
and receive no expected admission credit.

## Reconciled retained evaluator

Typed `const name: unit = expression` and inferred `const name = expression`
are lazy, unit-checked declarations. Constants and named shapes resolve in the
consuming loop scope. Reduction cache keys include bound values, and memoized
function calls distinguish captured closures. Unused numeric domains remain
inactive; shape names, reference cycles and dependency limits are still checked.

Fixed vector-valued comprehensions, mixed literal/generated lists and scalar
sharing preserve parameter dependencies. Expression assertions retain formatted
messages and checks on default/ignored arguments. Root modifiers combined with
assertions are refused until their evaluation ordering is modeled fully.

JSCAD snapshot export lowers signed scale to positive scale plus reflections.
Entirely negative radial profiles and clockwise turns retain placement; profiles
crossing the axis are refused. Source bundles remain bounded, hash-checked,
in-memory dependency sets with lexical `use` and original provenance.

The official 2021.01 executable accepts only text, size and font positionally.
Other text options are named; extra positional arguments are diagnosed and
ignored. Numeric formatting and each-scalar fixtures also have executable probes.

Mixed positional/named call arguments retain source order. Unnamed arguments
count positional slots independently of named ones, and the later assignment
wins when both target the same parameter. Function memoization includes this
order; a guard on an overwritten argument is still checked. Repeated explicit
keyword names remain diagnosed rather than guessed.

Explicit bundles now try a second, deterministic candidate when a relative
`include`/`use` target is absent: the exact same path at the supplied bundle root.
Relative files take precedence. Paths containing `..` remain relative-only;
escaped/absolute/URL paths still fail. Both candidates are restricted to the
hash-verified input files. No filesystem lookup, dependency alias, source rewrite
or library-root geometry execution is introduced. Fallback occurrences record
`resolution: "bundle-root"` in bundle provenance.

This resolves one measured authored default, Angelo `Projects/Scene_City_Street.scad`,
with its five exact Street dependencies: **0/1 → 1/1 strict passes**, 842 triangles,
9.927364671 mm³ of evaluated volume. Offline editor insertion, native code edits,
atomic invalid edits, provenance, serialization and undo/redo pass. The five
shared dependencies are not counted as additional admissions. The `lookup` and
`version_num` cohorts have no confirmed admission-ready default; their existing
refusals are unchanged. See `library/corpus-audit/editor-screening-cycle25.json`.

## Resize and extrusion option semantics

Retained 3D automatic resize supports several target dimensions and all-zero
targets. A new retained `resize2d` operator handles profile resizing before
extrusion/revolution, using the bounds of the evaluated boolean/offset result.
Automatic axes follow the largest requested scale, not the first target.

Boolean option handling now matches executable probes: primitive/extrusion
`center` accepts actual Booleans, scalar numeric `auto` is ignored, and numeric
entries in auto vectors retain their documented nonzero behavior. Explicit
fractional slice counts truncate; nonpositive straight-extrusion counts use one
geometrically equivalent step. Twisted/tapered automatic slicing is not guessed.

Original synthetic probes against the official 2021.01 executable are recorded
in [the resize/extrusion evidence](evidence/resize-extrusion-oracle-2026-11-14.json). New sources use corrected
option lowering; existing saved native programs keep their existing instructions.
JSCAD export of resize is still an explicit gap; SCAD and native round trips,
parameter/history edits and resized Jolt cutouts have regression coverage.

The same frozen 256-file replay yields **166 positive solids** (previously 165):
two newly supported files, 37 unsupported, 33 limited, 18 failed and two timeouts.
One previous positive hit the unchanged 15-second deadline. Its native program is
identical before/after; alternating old/new engine rechecks both pass and time out.
Successful rechecks retain its previous volume, bounds and triangle count. The
other 164 previous positives retain volume and bounds at 1e-6 tolerance. The frozen
result is kept as measured; retries do not replace its timeout with a pass.
73 of the 166 positives still have conversion notices. This is execution coverage,
not upstream fidelity certification. See the [aggregate replay and validation](evidence/import-engine-resize-2026-11-14.json).

## Bounded random import snapshots (cycle 26)

Constant calls with at most 64 samples use bounded imported snapshots, charging
every draw to the existing work budget. Larger lists, retained seeded lists and
parameter-dependent calls keep their native symbolic path and work/expansion
limits (including lazy length queries); they are not frozen into
constant snapshots. Known reversed ranges and fractional/negative counts fail.
Explicit seeds reproduce their own independent streams. Unseeded calls use a
source-derived stream: FNV-1a over exact UTF-8 source initializes an independent
xorshift32 generator; sampled values are resolved into the imported native code.
Conversion warnings and library provenance disclose this policy. These are valid
bounded sample snapshots, not a claim to reproduce OpenSCAD's random sequence or
all possible stochastic outputs. Source declarations and seed arguments are not
rewritten. The original compiler implementation follows the published
[`rands` argument documentation](https://files.openscad.org/documentation/manual/Mathematical_Functions.html);
no upstream generator implementation is used.

Constant nonnegative fractional list/string indices now select their integer
part; negative indices remain undefined. Symbolic indices retain the existing
exact-index matching subset, and booleans/strings are not numeric indices. This
allows the authored Bricks palette sample without weakening colour validation.

One exact authored root, `Asset_SCAD/Bricks.scad`, improves **0/1 → 1/1 strict STL
and editor passes**. Its reproducible snapshot consists of two separate boxes,
24 triangles and 264.357610779 mm³. Both planar dimensions of each box remain
within the authored 5–10 mm range; height 3 mm and second origin [10,0,0] are retained.
See `library/corpus-audit/editor-screening-cycle26.json`.

Cycle 28 adds no converter behavior. Four exact archived JSCAD examples/SCAD
transformation fixtures are newly packaged for offline library insertion using
the existing converters. Their baseline and editor-export STL identities agree.
The attempted Round-Anything filter/sign/format/memoization changes were reverted;
construction/work and other resource limits, random snapshot semantics and all
historical refusals remain unchanged. Admission measurements and distinct
compiler-versus-library outcomes are recorded in
`library/corpus-audit/editor-screening-cycle28.json`.
