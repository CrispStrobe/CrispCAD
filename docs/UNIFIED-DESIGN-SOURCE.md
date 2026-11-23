# One design, edited through GUI or source

Open **File → Model source** to keep an editable source dock beside the canvas.
**Code an object** also offers **Create & show model source** (or **Apply & show
model source** for an existing body). Selecting an object follows its source call;
clicking a body call selects the object. Follow selection can be disabled.

The existing retained document graph is shared by both workflows. Changing a GUI
value patches its corresponding source value; creating/deleting a part adds/removes
its call. Unchanged calls, comments and whitespace are preserved. Changing the
structure of a compound value may rewrite that block.

**Apply model source** validates and evaluates the complete candidate before one
transaction, one undo step and one saved iteration. Preview, typing and opening the
dock create no iterations. GUI drags still commit on release. Source, parameters,
geometry and comments travel together in the history-inclusive `.bcad` file.

Changing a parameter referenced by a retained outline relation solves the
affected outline during Preview and Apply. A conflicting solve leaves the
draft available for correction and keeps the saved model intact. On Apply,
the source dock updates the coordinates and preserves nearby comments.

## Retained design language

This original, bounded declarative language uses MIT Acorn for parsing. It does
not execute JavaScript. Stable IDs identify project parameters, sketches, bodies,
root order and joints. A minimal body call looks like:

```js
box("body", {name: "Plate", size: [40, 20, 4]});
roots(["body"]);
```

Keep the generated `project(...)` header when editing a complete design. Define
model parameters with `parameter("width", {expression: "40", unit: "mm"})` and
use `expr("width / 2")` in supported driven fields. Primitive bodies, retained
booleans, rectangle/circle sketches and extrusions use the same data as Properties.

A `code` call embeds multiline native CAD Script in a `cad` template with local
input overrides. Imported/programmed objects therefore retain their formulas.
It remains one coded body; the surrounding model source describes all bodies.
Foreign OpenSCAD/JSCAD programs still pass through the bounded converters first.

Managed part templates appear as one `generated(...)` call with an editable preset
recipe, rather than exposing every screw construction component. Changing the
recipe uses the same reconstruction and joint guards as Properties. Explicitly
setting the recipe argument to `null` detaches it and exposes ordinary construction
calls. Construction children cannot be silently changed under an active recipe.

Mesh calls reference project-contained buffers using `asset("stable-id")`; these
buffers are not expanded into text. `sources()` keeps immutable provenance records.
Asset copies inherit their source attribution. Source alone is therefore not a
portable substitute for the complete `.bcad` file and its embedded data.

## Concurrent edits and compatibility

A clean dock refreshes after GUI changes. A dirty draft is retained, and Apply
refuses a stale revision. **Merge GUI changes** combines independent field edits
and appended parts while retaining draft comments. Changes to the same value
report a conflict; the draft and saved model remain available. **Reload model
source** explicitly discards the draft. Merging between different projects is
refused. Source preflight also enforces reference-helper and generator guards.

Persisted source uses document schema **6**. Versions 1–5 and their history remain
readable and unmodified until an accepted edit upgrades the current model. Older
apps reject schema 6 rather than discard its source. Ambiguous legacy extension
fields cannot be overwritten by this upgrade. The source and document must
validate to the same graph before loading or committing.

The core SDK exposes `modelSource`, `enableModelSource`, `prepareModelSource` and
`applyPreparedModelSource` on a session, plus `applyModelSource` for synchronous
hosts. Use `prepareModelSourceWithOutlineSolve` with a solver callback and abort
signal when the candidate needs new outline coordinates. Geometry hosts should
evaluate the prepared candidate before applying its revision-bound token.
Preparation leaves the session intact. MCP exposes
`cad_get_model_source` and `cad_apply_model_source`; see [MCP](MCP.md). That server
operates its own headless project session, not a live GUI connection.

Limits remain explicit: GUI source 8 MiB, documents 16 MiB and portable history
archives 64 MiB, with AST/record bounds. Archives are never pruned to fit. MCP
accepts source up to 65,536 characters and retains its tighter headless model and
transport limits. The browser worker solves constraints on single closed
outlines, including driving radii and tangency to an adjoining line or arc.
Region boundaries and cutouts can each retain their own outline constraints.
Retained X/Y offsets position one outline relative to another within the
same region. An edge-midpoint anchor stores the two vertex IDs of the edge.
Region edge matches store the reference and target loop IDs and both pairs
of vertex IDs. Model Source solves reference loops before their dependent
edges. Other edge relations between separate loops remain open.
