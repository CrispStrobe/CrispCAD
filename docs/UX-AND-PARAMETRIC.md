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
| Discover and insert | Searchable categorized catalog, geometry-derived previews, pin, SVG/text/QR options | Place on click and faces, drag placement, recent/custom shapes, remembered categories, shape-specific parameter controls |
| Find tools | Labeled task ribbon and keyboard shortcuts | Search tools/settings as well as shapes, contextual disabled reasons and in-place help; adaptive groups rather than a long scrolling ribbon |
| Manipulate | View cube, numeric transforms, gizmos, snap, drop, multi-select | Direct drag, face placement, selection bounds with dimension handles, align/mirror/pattern and precise measurement |
| Construct | Closed mesh solids, retained boolean operands, imported STL | Clear solid/hole roles, grouping/bundling, locking/hiding, split/hollow, edge operations and appropriate exact-body support |
| Draw | SVG-to-solid path | Editable planar sketches, arcs/curves, construction geometry, extrude/revolve/sweep and diagnostics |
| Touch | Tap/long-press, persistent multi-select, pinch/pan, onscreen controls | Finger/Pencil hit-target qualification, explicit gesture modes, tablet context menus, keyboard-free completion and focus/simple modes |
| Keep work | Local autosave plus append-only revision journal, model list, restore and portable history backup | Native durable journal mirror/recovery, streaming large-history backups, thumbnails, folder organization and cross-device backup/sync |
| Simulate | Separate physics adapter and body/joint/material contract with geometric qualification gates | Interactive simulation UI, qualified mates/actuators, critical clearance fixtures, elastic/contact/material calibration and large-model performance qualification |

Usability acceptance must use tasks, not icon counts: build a dimensioned bracket
with a bore; place a part on an angled face; assemble and drive a hinge; change an
old iteration and recover both branches; export/reopen; complete the same tasks
on an iPad without a keyboard. Measure incorrect placements, recoverability,
completion time and help needed. Advanced commands must stay discoverable while
basic modeling stays simple.

## Optional parametric CAD: feasible, separate modeling layer

The current primitive parameters and retained boolean graph are an initial
foundation. A tessellated preset with numeric transforms is not a FreeCAD-style
parametric feature. Full sketch constraints, exact B-rep topology and STEP are
not implemented or promised by the current mesh kernel.

Introduce a versioned, headless design-intent graph beside evaluated geometry:

1. Stable feature/sketch/body/face-reference IDs; named parameters with units,
   arithmetic expressions and explicit dependency edges. Validate cycles and
   invalid dimensions without executing arbitrary JavaScript.
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
A future schema migration must preserve old documents and all archived iterations.
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
- Portable `.bcadhistory` backups include a model's revisions, ancestry and shared
  geometry. Import creates a separate model, so an old backup cannot overwrite
  the current library. `.bcad` remains a single editable snapshot.
- “Indefinitely” means the app never discards versions automatically. Storage is
  finite and device/browser data can be removed externally. Keep portable copies;
  add native journal mirroring and streaming backups for larger projects. The
  first in-memory backup path has an explicit 64 MiB limit and fails without
  deleting history. It is not a claim of infinite storage or disaster immunity.

`@brickwright/cad-history` is host independent. The standalone host supplies the
IndexedDB journal and UI; Brickwright and CrispMesh can reuse the same revision
contract with their own native/project storage providers.
