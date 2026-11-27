# Parametric modeling contract

Implemented milestone, 2026-11-13. This is the shared model for the standalone
app and future Brickwright/CrispMesh hosts. The BSD core owns definitions and
validation; the geometry worker evaluates them. No new dependency was added.

## Definitions, evaluated geometry and saved iterations

These are three different things:

1. **Design definitions** are canonical: named dimensions, bounded arithmetic
   expressions, analytic sketches, feature inputs, transforms and retained boolean
   operands. IDs identify constructions, not their current tessellation.
2. **Evaluated meshes** are disposable output. Manifold evaluates a validated
   definition; rendering, STL/3MF and Jolt preparation consume that output. A mesh
   must not become the only source of an editable sketch or feature.
3. **Model iterations** are immutable snapshots of the complete definition. They
   preserve design inputs and branches. The feature dependency graph describes
   one snapshot; it is not the user's undo list or their saved iteration list.

Existing primitives and booleans remain editable and can coexist with sketch
features. Parametric modeling stays optional. Importing an STL does not infer a
sketch or recover the author's dimensions.

## Saved schema

Document **version 3** adds `sketches` and the `extrusion` node kind. Versions 1
and 2 remain readable without conversion to meshes. Merely opening an old model
does not change its version. Adding a sketch upgrades only the current document;
old history snapshots remain in their original format. Older applications reject
version 3 rather than opening a damaged approximation.

```ts
type FeatureScalar = number | string; // literal mm, or a unit-aware expression
interface PlanarSketch {
  version: 1;
  id: string;
  name: string;
  plane: 'XY' | 'XZ' | 'YZ';
  profile:
    | { kind: 'rectangle'; id: string; width: FeatureScalar; depth: FeatureScalar }
    | { kind: 'circle'; id: string; radius: FeatureScalar; segments: number };
}
interface ExtrusionFeature {
  kind: 'extrusion';
  featureVersion: 1;
  sketchId: string;
  distance: FeatureScalar;
  symmetric: boolean;
  // Normal SolidNode identity, name, color, transform and physics also apply.
}
```

Sketch/profile and feature IDs survive editing and recomputation. One sketch may
feed multiple extrusion features. Its ID is independent of the feature's ID.
The current model has one solid output per solid node; the feature output uses
that node's stable ID. A boolean retains its input nodes and gains its own output
ID. Combining articulated bodies still requires detaching their joints.

A rectangle is centered about the sketch origin and stays closed and orthogonal
by construction. A circle stays centered and closed, with an analytic radius and
explicit 12–256 segment tessellation. These are constrained profile templates,
not a general sketch constraint solver. Local `(u,v,n)` maps to `(x,y,z)` as:

| Plane | Mapping | Positive extrusion |
| --- | --- | --- |
| XY | `(u,v,n)` | +Z |
| XZ | `(u,-n,v)` | −Y |
| YZ | `(n,u,v)` | +X |

Extrusion distance is positive. Symmetric extrusion spans `−distance/2` to
`+distance/2`; otherwise it starts at the sketch plane. Normal node transforms
apply afterwards. Position/rotation/scale can use existing expression bindings.

Sketch dimensions and extrusion distance accept numbers or the same expressions
as named parameters, such as `plateWidth / 2` or `thickness + 2 mm`. Bare numbers
use mm. Expressions never execute JavaScript. Units, bounds and all referenced
parameters are validated before committing. See [PARAMETERS.md](PARAMETERS.md)
for expression syntax and limits. Up to 256 sketches are supported within the
existing 16 MiB snapshot and 2000 solid-node budgets.

### Document versions

The document `version` is the oldest schema that can represent the document, not the version
of the application that saved it. Opening or saving never changes it; an edit raises it only
when it adds something an older schema cannot hold (a sketch: 3, a mirror: 13, a pattern: 14,
an artwork-linked sketch: 39–40, …). Older applications refuse versions they do not know
instead of opening an approximation, and nothing is ever downgraded. So a project keeps opening
in older builds until it uses a newer feature.

**Version 41 (2026-11-25) adds `exact-feature` nodes**: exact fillet, chamfer and shell built
by the optional exact B-rep kernel. A project that has none keeps its version (40 or lower) and
stays readable by builds that predate 41; adding the first exact feature raises it to 41. Undo
returns to the earlier version, and history revisions keep the version they were saved with.

**Version 42 (2026-11-26) adds CAD Script revision 2: ruled lofts.** A code object's
`program.version` may be 2, which builds `loft` side quads as ruled surfaces instead of two
triangles along a fixed diagonal ([CODE-MODE.md](CODE-MODE.md#language-revisions)).
`checkDocument` accepts revision 2 only in version 42 documents. A document reaches 42 only
when it holds a revision-2 program, that is a program that calls `loft` and was created or
edited since revision 2, or whose lofts were upgraded with **Upgrade lofts to ruled
surfaces** (one Undo step). Programs without `loft` are stored as revision 1, so projects
without lofts keep their version, and saved revision-1 lofts keep their triangulated
geometry, byte for byte, until the user upgrades them. Builds that predate 42 refuse such a
document rather than building its lofts along the diagonal.

**Version 43 (2026-11-26) adds CAD Script `smoothLoft`**, the smooth (cubic) surface through
three or more loft sections ([CODE-MODE.md](CODE-MODE.md#smooth-lofts)). `checkDocument` accepts
a program that calls `smoothLoft` only in version 43 documents; a document reaches 43 only when
such a program is added or edited in, and Undo returns to the earlier version. `smoothLoft` is
the same in both CAD Script revisions, so it changes no program revision and no saved geometry.
Builds that predate 43 refuse such a document (and the function).

**Version 44 (2026-11-27) adds edge references to exact features**: a fillet or chamfer may
round or bevel chosen edges, `edges: {references: [...]}`, instead of every edge or one face's
edges. `checkDocument` accepts references only in version 44 documents; a document reaches 44
only when such a feature is added or edited in (Undo returns to the earlier version). Features
with `'all'` or a face selector keep version 41 and are lowered exactly as before: faces are named
only for features that hold references. Builds that predate 44 refuse such a document.

```ts
interface ExactFaceSelector { faceNormal: [number, number, number]; outermost?: true }
// Version 44. Face names: `<leaf node id>:f<k>`, prefixed `<pattern id>#<copy>/` per pattern copy.
interface ExactEdgeReference { faces: [string, string]; index?: number; of?: number }
interface ExactFeature {
  kind: 'exact-feature';
  featureVersion: 1;
  source: string;                       // the body it rounds, bevels or hollows
  operation: 'fillet' | 'chamfer' | 'shell';
  size: FeatureScalar;                  // radius, distance or wall thickness (mm)
  edges?: 'all' | ExactFaceSelector     // fillet and chamfer only
    | { references: ExactEdgeReference[] };  // version 44: chosen edges
  openFaces?: ExactFaceSelector[];      // shell only: 1–6 removed faces
  display?: { sourceKey: string; positions: number[]; indices: number[] };
  // Normal SolidNode identity, name, color, transform and physics also apply.
}
```

- Selectors follow the kernel interface: every edge, or the edges of one planar face chosen by
  outward normal (`outermost` takes the furthest matching face); shell faces are removed by
  outward normal. Normals are in the frame the source is placed in.
- Edge references (version 44, `packages/core/src/exact-edge-references.ts`): when the exact
  backend lowers the source of a feature that holds references, every face of every leaf
  construction (box, cylinder, sphere, extrusion, revolution, code object) is named
  `<leaf id>:f<k>` (k: the face's position on the freshly built leaf), and each pattern copy
  prefixes its faces with `<pattern id>#<copy>/`. The exact kernel keeps a name on the face and on
  its pieces through Booleans, transforms, mirrors and nested exact features; faces an operation
  makes anew (a fillet's round) have none. An edge is named by the sorted names of the two faces
  it bounds; where several edges bound the same two faces, `index` of `of` records which one, in
  the order of their sample centroids (x, then y, then z). Each recompute resolves the references
  on the current B-rep. Parameter edits move faces but keep their names, so the reference finds
  its edge again. If the two faces no longer meet, or meet at another number of edges than `of`,
  the recompute fails with `stale-edge-reference` (the message names the faces) and the feature
  stays stale; no other edge is picked. Paste, duplicate and regenerate rewrite the node ids in
  face names, and `exactFeatureKey` replaces them by their position in the source subtree, so a
  pasted feature keeps its display mesh.
- `display` is a cache: the exact result tessellated at 0.01 mm / 10°, bounded like a `mesh`
  node (750 000 coordinates, 1 500 000 indices). `sourceKey` is `exactFeatureKey(doc, id)`, a
  signature of the settings, the source subtree's geometry (ignoring IDs, names, colours,
  physics and other displays) and the values of parameters its expressions name. Manifold uses
  the mesh only while the key matches; otherwise evaluation fails with
  `FeatureEvaluationError` code `stale-exact` naming the node. A missing `display` is valid and
  stale. Only commits inside `session.withKernel(...)` may set a display, and only one whose key
  matches the model being committed.
- `constructionInputs` includes `source`; copy, paste, duplicate, regeneration and model source
  remap it like a mirror source. Model source writes `exactFeature(id, {...}, asset(id))`,
  referencing the mesh like an imported mesh asset. History archives store the display as a
  shared content object, so moving or renaming a feature does not copy it.
- STEP export and exact measures rebuild the operation on the exact source; they never read
  `display`.

**Version 45 (2026-11-27) adds `exact-body` nodes**: solids imported from STEP by the exact
kernel (**File › Import STEP as exact bodies…**, `import step`, MCP `cad_import_step`, CLI
`import`). A document reaches 45 only when such a body is imported; Undo returns to the earlier
version, and documents without one keep their version.

```ts
interface ExactBody {
  kind: 'exact-body';
  bodyVersion: 1;
  brep: { format: 'step'; text: string };   // one solid, AP214, mm, local frame; ≤ 8 MiB
  measures: { volume: number; area: number; min: Vec3; max: Vec3 };  // exact, at import
  display: { positions: number[]; indices: number[] };  // kernel tessellation, 0.01 mm / 10°
  origin?: { file: string; sha256: string; bytes: number; body: number; bodies: number };
  // Normal SolidNode identity, name, color, transform and physics also apply.
}
```

- `brep.text` is the defined form of the B-rep: the body as the exact kernel re-writes it, one
  solid per node, checked at import to read back with the same volume and area (1e-7) and box
  (1e-6 mm). It is never edited; `session.update` refuses `brep`, `display`, `measures`, `origin`.
- `display` is required and never stale (the B-rep cannot change), so a document opens, displays,
  simulates and prints without the kernel: Manifold builds the mesh like a `mesh` node, with the
  node's transform. It is closed and consistently oriented and bounded like a `mesh` node.
- Exact export, exact measures and exact `fillet`/`chamfer`/`shell` read the body from
  `brep.text` (the exact backend caches it between requests). An exact feature on an imported
  body depends on the B-rep through `exactBodyKey` (a signature of the text).
- Only commits inside `session.withKernel(...)` may add one (`session.addExactBodies`), so the
  recorded command carries the kernel. Model source writes `exactBody(id, {...}, asset(id))`;
  history archives store `brep` (content kind `brep`) and `display` as shared content objects,
  so moving or renaming the body stores no copy. Documents stay within 16 MiB in all.

**Version 46 (2026-11-27) adds the CAD Script loft pairing option**, `loft([...], {pairing:
"closest"})` and the same for `smoothLoft` ([CODE-MODE.md](CODE-MODE.md#loft-pairing)): sections
re-started at the vertex and direction closest to the previous one, as OpenCASCADE's ThruSections
pairs them. `checkDocument` accepts a program that writes the option only in version 46
documents; a document reaches 46 only when such a program is added or edited in, and Undo returns
to the earlier version. The option is the same in both CAD Script revisions, so it changes no
program revision and no saved geometry. Builds that predate 46 refuse such a document.

## Graph and errors

`designGraph(doc)` derives a deterministic topological order from canonical
parameter expressions, sketch inputs, extrusion references, transform/dimension
bindings and boolean inputs. Keys are namespaced (`parameter:name`, `sketch:id`,
`feature:id`). `affectedDesignEntries(doc, changedKeys)` reports the changed
entries and transitive dependants, in recomputation order. Parameter names are
currently expression symbols: renaming one requires updating its references.
Sketch/feature identities do not use their displayed names.

The first evaluator rebuilds the document in the geometry worker and memoizes
shared solid inputs within that evaluation. The dependency API establishes the
contract for later incremental caching; it does not yet skip every unaffected
feature across evaluations. Versioned cache keys must include feature inputs,
resolved parameters, dependencies, evaluator/kernel versions and source assets.

`FeatureEvaluationError.diagnostic` contains `source`, stable `id` and `message`.
Geometry-worker errors retain this structured diagnostic. Definition errors
leave the committed model unchanged. The sketch dialog keeps the invalid draft
open for correction and checks the complete resulting solid in the worker before
committing one edit. Unexpected kernel failures in other editing workflows keep
the previous valid display and offer Undo, as before. No failed edit silently
replaces a feature with a mesh.

## Editing, copying and history

![Editing a retained sketch with dimensional expressions](images/parametric-sketch.png)

The editor's **Sketch** action opens a definition dialog with a dimensioned 2D
preview, plane, formulas, distance and symmetry. **Properties → Edit sketch &
extrusion** reopens that same definition, including a retained boolean operand.
**Parameters → Feature dependencies** shows the graph without adding construction
pieces to Objects. Native macOS also exposes **Object → Sketch and Extrude**.

Headless hosts use these core session methods:

- `addSketch(profile, options)` and `extrudeSketch(sketchId, options)` for reusable
  sketches and distinct features.
- `addSketchExtrusion(profile, options)` for one atomic user action.
- `updateSketch(id, patch)` for all dependants of a shared sketch.
- `editExtrusion(id, {sketch?, distance, symmetric})` for one atomic edit, with
  undo/redo and one archived iteration. Profile ID and kind must remain stable.
- `designGraph`, `affectedDesignEntries`, `evaluateSketch`, `evaluateExtrusion`
  and `resolveDesignReference` for host UI and analysis.

Duplicate copies sketches independently and preserves their formulas linked to
the same named parameters. Shared sketches within the duplicated selection stay
shared within that copy. Clipboard paste remaps sketch/profile/feature IDs and
namespaces colliding parameter names, including formulas inside sketches and
extrusions. Deleting a body removes the solid; sketches remain reusable design
inputs until an explicit sketch deletion workflow is implemented.

The revision store includes sketch definitions in its snapshot header, so full
`.bcad` archives retain formulas and profile identities without a new history
format. [The sketch mounting plate](../examples/parametric-sketch-plate.bcad)
contains two extrusions sharing one circular sketch for its bores.

## References, physics and integration boundaries

`DesignReference` currently resolves **feature outputs** and **sketch profiles**
by ID. Rectangle profile edges have semantic `bottom/right/top/left` identifiers;
a circle has one analytic circumference identifier. These describe construction
geometry, not the arbitrary triangles or faces remaining after a boolean.
Arbitrary face/edge attachments are deliberately not supported yet.

Sketches, formulas and feature inputs participate in `documentGeometryKey`.
Changing them invalidates collision proofs, mass and inertia. Collision generation
uses the actual evaluated extrusion and booleans through the existing Jolt
qualification path; a saved mesh or old certificate cannot stand in for a fresh
qualification. Tests check recomputed mass, refusal of old collision data and a
real Jolt floor drop. Sketch editing of joint-connected bodies currently requires
explicit joint detachment; automatic mate/frame regeneration needs semantic
attachment references first.

Hosts share the same core schema, worker results and revision codec. Keep native
file handling, UI framework, scene cameras and simulation runtime state outside
these definitions. A future simulation session must pin a source geometry key,
and restart/requalify after a design edit.

## Next implementation order

1. Move remaining catalog generators to versioned, headless feature evaluators;
   let their numeric inputs use the same named dimensions and formulas. Existing
   screw/heart recipes remain numeric version-1 recipes for now.
2. Add editable sketch entities (stable point/line/arc IDs), construction geometry
   and a solver boundary. Distance, coincidence, horizontal/vertical, radius and
   angle constraints need IDs, units, driving/reference roles and diagnostics for
   underconstraint, conflict and redundant constraints. A permissive-license
   solver and its dependency closure must be verified before inclusion.
3. Extend profile evaluation to closed wires/holes; add revolve, hole, mirror and
   pattern feature definitions. Add suppression and structured downstream-blocked
   diagnostics while preserving editable inputs. Never implement suppression as
   deleting source definitions.
4. Add semantic feature attachments and a body/assembly identity layer for
   multi-output operations and persistent mates. Resolve references uniquely;
   ambiguous or missing topology must ask for repair, never pick another face.
   Use this contract for joint frames and actuators before an interactive simulator.
5. Add incremental recompute and content-addressed evaluated results. Qualify an
   exact-body/STEP backend separately if required; the current mesh kernel does
   not supply B-rep or stable arbitrary face identities.

These extensions should evolve versioned definitions, not append unrelated UI
state or replayable mouse commands to saved projects. Full sketch constraints,
B-rep/STEP, feature suppression and general FreeCAD parity are not delivered by
this milestone.


The follow-up [CAD strategy](PARAMETRIC-CAD-STRATEGY.md) records the six commercial/
open CAD workflow comparisons and a pinned FluidCAD/Solidcraft architecture review.
Practical `createDesignTemplate` factories now expose their upstream driving inputs
in Properties. On-canvas transforms remain independent of design dimensions:
scaling geometry does not silently rewrite a width equation.

## Cube and fastener recipes

A Cube is a box with generator recipe version 2, preset `cube`, and one `edge`
value. The core validates equal intrinsic edges and uniform local scale. Numeric
edits, gizmo previews/commits and parameter bindings share the constraint. Cube
bindings expose `width` for the edge and `scaleX` for uniform scale; redundant
independent depth/height/scaleY/scaleZ bindings are refused. A normal Box remains
independent in all three dimensions. Model source, copies and history retain the
recipe. Older readers reject the unknown recipe version instead of silently
losing the constraint.

New screw presets are hex-head, socket-head, countersunk and pan-head. Version-2
screw recipes retain `headStyle`, `driveStyle`, `driveDepth`, `headAngle`,
`threadAngle` and orientation alongside the existing numeric thread inputs.
Drive choices are slot, cross recess, hex socket and no recess. The UI exposes the
major thread diameter; stored `values.diameter` remains the core diameter, so the
major diameter is core diameter plus twice the radial thread depth. Hex head and
socket dimensions are widths across flats. Countersunk height follows its angle;
V-thread flank angle, pitch, depth, handedness and starts remain editable.

New family presets are head-up. Explicitly upgrading a legacy screw retains its
old orientation. Version-1 recipes and their generated geometry remain unchanged.
These are editable representative fastener geometries, with a simplified V-thread;
they do not claim ISO/DIN tolerance classes, crest/root truncations or mating-fit
certification. Real Jolt tests verify the new drive recesses in rigid preview;
thread engagement still requires a qualified mechanism model.
