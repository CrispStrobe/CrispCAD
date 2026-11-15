# Product requirements: accessible CAD, optional parametrics, permanent iterations

Owner direction, 2026-11-12: the finished GUI must be at least as intuitive and
versatile as the Layerling reference; every shape must have an explicit path to
reliable Jolt simulation. Parametric modeling should be optional. Model iterations
must remain recoverable without a fixed retention count.

## UX reference and acceptance

Reviewed the public [getting-started guide](https://layerling.com/guide/getting-started.html),
[shape workflow](https://layerling.com/guide/shapes.html),
[selection](https://layerling.com/guide/select-and-arrange.html),
[sketch workflow](https://layerling.com/guide/sketches.html),
[file workflow](https://layerling.com/guide/files-and-saving.html) and
[touch workflow](https://layerling.com/guide/tablet-and-touch.html).
The guide and owner screenshots are behavioral references. No reference
implementation, illustrations, icons, fonts or translations are incorporated.
Our requirements below are independently specified; current delivery is not a
claim of feature or usability parity.

| Workflow | Current foundation | Required before parity acceptance |
| --- | --- | --- |
| Discover and insert | Searchable catalog, editable recipes, optional lower-right dock, drag/tap surface placement with live ghost and highlighting | Recent/custom shapes, remembered categories, active construction workplanes |
| Find tools | Labeled task ribbon and keyboard shortcuts | Search tools/settings as well as shapes, contextual disabled reasons and in-place help; adaptive groups rather than a long scrolling ribbon |
| Manipulate | View cube, numeric/live transforms, direct drag, gizmos, snap, drop, rectangle selection, surface placement | Persistent workplanes, selection bounds with dimension handles, align/mirror/pattern and precise measurement |
| Construct | Closed mesh solids, retained boolean operands, imported STL, Solid/Hole cutters | Grouping/bundling, locking/hiding, split/hollow, edge operations and appropriate exact-body support |
| Draw | SVG-to-solid path | Editable planar sketches, arcs/curves, construction geometry, extrude/revolve/sweep and diagnostics |
| Touch | Tap/long-press, persistent multi-select, pinch/pan, onscreen controls | Finger/Pencil hit-target qualification, explicit gesture modes, tablet context menus, keyboard-free completion and focus/simple modes |
| Keep work | Local autosave plus append-only revision journal, model list, restore and portable history backup | Streaming large-history backups and further native recovery/performance qualification, thumbnails, folder organization and cross-device backup/sync |
| Simulate | Separate physics adapter and body/joint/material contract with geometric qualification gates | Interactive simulation UI, qualified mates/actuators, critical clearance fixtures, elastic/contact/material calibration and large-model performance qualification |

Usability acceptance must use tasks, not icon counts: build a dimensioned bracket
with a bore; place a part on an angled face; assemble and drive a hinge; change an
old iteration and recover both branches; export/reopen; complete the same tasks
on an iPad without a keyboard. Measure incorrect placements, recoverability,
completion time and help needed. Advanced commands must stay discoverable while
basic modeling stays simple.

## Optional parametric CAD: feasible, separate modeling layer

The current primitive parameters, retained boolean graph and optional named
parameters with unit-aware expression bindings are an initial foundation. The
first named-parameter milestone is described in [PARAMETERS.md](PARAMETERS.md).
A tessellated preset with numeric transforms is not a FreeCAD-style
parametric feature. Full sketch constraints, exact B-rep topology and STEP are
not implemented or promised by the current mesh kernel.

Continue the versioned, headless design-intent graph beside evaluated geometry:

1. Stable feature/sketch/body/face-reference IDs; named parameters with units,
   arithmetic expressions and explicit dependency edges. Validate cycles and
   invalid dimensions without executing arbitrary JavaScript.
   Named values, arithmetic dependencies, unit validation and primitive/transform
   bindings are implemented in document version 2. Document version 3 now adds stable sketch/profile/extrusion identities and a
   derived dependency graph; arbitrary topology references remain ahead. See
   [PARAMETRIC-MODEL.md](PARAMETRIC-MODEL.md).
2. Versioned feature definitions for primitives, catalog generators, sketches,
   extrude/revolve/sweep, booleans and later edge features. Keep user inputs,
   generator/kernel versions and external source assets, not just tessellation.
3. Deterministic recomputation with errors attached to the failing feature.
   Keep the last valid display and preserve user input. Handle topology changes
   through stable selection/reference rules rather than transient triangle IDs.
4. A solver interface for constrained sketches and a kernel interface for mesh
   and, if selected later, exact bodies. Audit every kernel/solver and its entire
   dependency set against the owner's permissive-license requirement. Do not
   assume the license of a wrapper also licenses its underlying CAD kernel.
5. Simple direct-modeling controls remain the default. An optional Parameters /
   Features view exposes formulas, dependencies, suppression and recompute.
   Geometry edits to driven features must edit their inputs or explicitly detach
   the dependency; never silently bake away design intent.
6. Recomputed geometry invalidates collisions, mass and inertia by source hash.
   Mechanical metadata and local joint frames follow stable body IDs. Preserving
   a visual mesh never implies that a mechanical relationship remains qualified.

Move headless catalog generation out of the DOM editor before making it the
canonical parametric evaluator. Store complete recipes in a versioned schema;
the current physics sourcePreset tag is provenance, not a regeneration feature.
New schema versions must preserve old documents and all archived iterations.
A full constraint/B-rep CAD is a substantial later project, not a toolbar change.

## Iterations: behavior and persistence contract

- Keep editing undo responsive with its existing in-memory bound. Separately,
  append every document change to durable revision storage with no automatic
  pruning, expiry, or revision-count cap.
- Each immutable revision has a parent, timestamp, sequential model-local
  iteration number and label. Restoring an earlier state appends a new revision
  based on that state; later work stays reachable. Named milestones force a new
  checkpoint even when geometry is unchanged.
- Share immutable mesh content and unchanged nodes by SHA-256 content address.
  Snapshot the entire model contract, including materials, joints and future
  design intent, rather than replaying old application commands.
- Journal data and model head updates commit in one transaction. Reject corrupt
  snapshots or archives before replacement. A failed save leaves prior history
  intact and is visible to the user. Concurrent writers preserve both revisions.
- Saved `.bcad` projects include a model's revisions, ancestry and shared
  geometry. `.bcadhistory` is accepted as a legacy archive extension. Import creates a separate model, so an old backup cannot overwrite
  the current library. The core serializer remains a single editable snapshot;
  the standalone save adapter supplies the full archive.
- “Indefinitely” means the app never discards versions automatically. Storage is
  finite and device/browser data can be removed externally. Keep portable copies;
  native macOS folder mirroring is implemented; streaming backups for larger
  projects remain future work. The
  first in-memory backup path has an explicit 64 MiB limit and fails without
  deleting history. It is not a claim of infinite storage or disaster immunity.

`@brickwright/cad-history` is host independent. The standalone host supplies the
IndexedDB journal and UI; Brickwright and CrispMesh can reuse the same revision
contract with their own native/project storage providers.

## Fast construction workflows (2026-11-14)

Original interaction code, guided by common CAD conventions and the official
[Tinkercad shortcut sheet](https://assets.ctfassets.net/jl5ii4oqrdmc/6TNFVIF89KMN9CPLLH97U0/cc996201b4d443c63c84b54a26c1891b/Tinkercad_keyboard_shortcuts_1_up.pdf).

| Workflow | Status / next acceptance task |
| --- | --- |
| Drag shape to grid or existing face | Implemented: evaluated ghost, highlighted target, outward face normal, tangent grid snapping and one committed edit. Curved surfaces use the actual tessellated face normal. |
| Tablet insertion without dragging | Docked browser: tap a shape, then tap a target. Drag thumbnails; swipe labels/category areas to scroll. |
| Keep shapes beside the model | Optional lower-right dock via pin or Settings. Preference is host-owned and remembered without a model revision. Popup click-to-add remains available. |
| Fine placement / recovery | Shift gives one tenth of grid spacing. Alt ignores surfaces and targets Z=0. Escape, outside drop, blur or model changes cancel the preview. H/S chooses cutter/solid before dropping. |
| Cut with intuitive holes | Solid/Hole controls, H/S, role-aware Union (Cmd/Ctrl+G), retained editable operands and Separate (Cmd/Ctrl+Shift+G). |
| Quick selection and navigation | Select-mode rectangle, Shift-additive selection, touch multi-select, default direct dragging, F/Shift+F, view cube, trackpad/pinch and camera presets. D drops selection to baseplate. |
| Align shapes | Next: on-canvas edge/centre handles with preview; first-selected or explicit fixed reference, one undo entry and driven-position handling. |
| Persistent face workplane | Next: pick/reset construction plane; reuse it for insertion, movement, dimension annotations and D. Current automatic face placement does not establish a persistent workplane. |
| Duplicate and repeat | Duplicate exists. Next: retain last translation/rotation pattern for repeat duplication, including parameter bindings. |
| Lock / hide / isolate | Next: compact contextual actions and browser states, with explicit export and selection semantics. |
| Direct dimension handles | Corner/side handles and editable millimetre dimensions in Select and Scale modes; fixed opposite anchor, proportional and centre options, local axes for rotated bodies. |

Face placement retains generator recipes, code, bindings, provenance and local
joint frames. It composes driven translations/rotations rather than freezing them.
No intersections are silently merged. Snapping is a placement aid, not a contact
constraint or collision certificate. New modeling features must keep the same
command/history/source path for GUI, script and MCP access.

## Direct-placement and resize reference check — 2026-11-15

The optional lower-right palette and highlighted-face placement are implemented,
but the popup header exposed docking as an ambiguous diagonal arrow. It now has
a readable **Lower right** action, changing to **Popup** when docked. The saved
preference and existing drag/tap placement remain; view changes create no model
iteration. Touch users drag thumbnails and can scroll using card labels.

Autodesk's [lesson guide](https://assets.ctfassets.net/jl5ii4oqrdmc/7vqtiHNyJW8CrtaiKTV9Ji/003e7fe0010f9e082bb8bdaeda08f749/0de442ca.pdf)
(page 12) explicitly describes Snap Grid precision for resizing as well as moving.
Its [official shortcut sheet](https://images.tinkercad.com/jl5ii4oqrdmc/24W19aTK6wTT0YydFO3xZd/ffda269b296a25b9ce3b8a19e65bf571/Tinkercad_keyboard_shortcuts_1_up.pdf)
assigns Shift to uniform resize and Alt/Option to resizing about the centre. This
check uses published primary documentation, not a logged-in interactive session.

Implemented dimension resizing:

- Select and Scale show four base corners, four base side handles and a height
  handle, with compact editable X/Y/Z dimensions along the measured edges.
- Snap Grid rounds dimension **changes** in millimetres. A fractional starting
  dimension is preserved. Grid Off removes rounding; exact numeric entry bypasses
  the grid. This replaces factor-based snapping in the viewport.
- The opposite side stays fixed. Shift preserves proportions; Alt/Option holds the
  centre. Both have touch-accessible toggles beside the selection. Uniform resizing
  snaps one driving dimension and derives the remaining dimensions by ratio.
- Ctrl/Command or Fine uses one-tenth pointer speed and one-tenth grid increments
  during resizing. Shift remains fine control for moving/rotating, and fine numeric
  steppers retain their existing Shift behavior.
- Same-oriented bodies use their common local frame. Mixed-orientation selections
  and cubes enforce proportional resizing to preserve valid transforms/equal edges.
- Dimensions and the Properties panel update during drag. Release saves one edit;
  Escape cancels. Transient previews/toggles do not enter project history.

Surface placement keeps dimensions unchanged. Persistent workplanes, alignment
previews, explicit fit-to-target and repeat duplicate remain separate future work.
