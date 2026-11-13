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
| OpenSCAD | Scalar/vector/boolean assignments before geometry; arithmetic, degree math and dependent parameters; top-level reusable modules with positional/named/default arguments; fixed vector indexing; cube/sphere/cylinder; centering and radius/diameter arguments; translate, XYZ/scalar-Z rotation, positive scale; union/difference/intersection; linear_extrude of a simple polygon, square or circle. |
| JSCAD | CommonJS/ES imports of @jscad/modeling; exported main or explicitly selected entry; helper functions, destructuring/default arguments, arithmetic/Math; bounded loops and arrays; scalar input parameters; cube/cuboid/cylinder/sphere/polygon, rectangle/circle/ellipse profiles and planar profile transforms; Booleans; translate/rotate/scale and axis shortcuts; flat output colours; basic vec2 maths and untwisted extrudeLinear. |
| Native CAD Script | Existing primitives/CSG/transforms/repeat, plus extrude(height, [[x,y], ...]) for a simple XY profile. Profile closes automatically, needs 3–256 points, and rejects zero edges/area and self-intersections. |

Cylinder tessellation supports 3–256 segments, including hexagonal parts. Sphere
limits remain 12–96 segments. OpenSCAD round surfaces use 48 segments if $fn is
absent; this differs from OpenSCAD's adaptive defaults. Analytic intent and CSG
order are retained, but matching tessellation/triangle layout is not promised.

Source limit is 32 KiB. JSCAD has 20,000 interpreter steps, 64 iterations per loop,
256 array items and call depth 32. The parsed AST is bounded to 8,192 nodes
and depth 128. Existing native expansion/mesh budgets also apply.
Errors carry a source location and machine-readable diagnostic code. Native
construction validation errors from SCAD imports point to the originating
top-level construction call; they do not claim an exact inner-expression span. Resource
limits are distinct from unsupported features and malformed input.

Known gaps, deliberately diagnosed:

- OpenSCAD include/use, user functions, for/if, nested modules, module child operators, local/reassigned variables,
  2D profile Booleans/holes, twisted/scaled extrusion, hull/minkowski, imported
  meshes and arbitrary-axis transforms. BOSL2 library execution is not supported.
- JSCAD external/local modules, arbitrary JavaScript/host APIs, unsupported math
  helpers and geometry APIs, 2D profile Booleans/holes, slice/callback extrusion,
  hulls, lofts, curved sweeps and per-face materials. The pinned nuts-and-bolts
  example currently stops specifically at extrusions.extrudeFromSlices.

This is a tested subset, not a full OpenSCAD or JSCAD implementation. The goal is
to make missing capabilities reproducible, then extend coverage from real files.

## Retained parameters and outputs

OpenSCAD scalar assignments become editable native parameters. Modules expand
symbolically: changing a retained parameter recomputes every expanded use, rather
than baking it into a snapshot. Named vectors retain their scalar dependencies;
vector indices currently require literal nonnegative integers. Module defaults
use the definition scope; regular caller arguments do not leak into called modules.
Special `$fn` parameters propagate through calls. Only file-scope module definitions
are supported; local assignments and `children()` remain explicit gaps.

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

Next valuable work is bounded OpenSCAD local-scope/loop/function semantics,
callback/slice loft IR and 2D profile operations. Add a small pinned failing fixture with exact
licence/provenance for each capability before changing the converter. Never turn
an unsupported operation into an unreported approximation or execute source JS.

Historical checkpoint: d946a9b was pushed while the extrusion work was in progress.
Current validation and delivery notes are recorded in DELIVERY.md.

Language behavior references: [OpenSCAD modules and functions](https://files.openscad.org/documentation/manual/User-Defined_Functions_and_Modules.html),
[mathematical functions](https://files.openscad.org/documentation/manual/Mathematical_Functions.html).
The installed MIT JSCAD 2.13.0 API and independent test geometry establish the
profile defaults, centering and radian transform behavior. No GPL implementation
was used.
