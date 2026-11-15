# Roadmap

## Now: a usable standalone CAD workbench

Implemented in the current workbench update: labeled tool groups, a camera-synchronized front/right/top view cube, other principal views, a millimetre baseplate, framing and zoom, perspective/orthographic projection, snap controls, and placing bodies on the workplane. Keep navigation and view preferences outside the CAD document and undo history. Keep the editor embeddable with instance-local events and complete disposal.

The Layerling screenshot supplied by the owner is a visual workflow reference. Implement our own UI and interaction code; do not copy its implementation, assets, or translations. That navigation milestone did not add advanced modeling operations. The sketch-template/extrusion foundation below is now implemented; general sketch constraints, fillets and STEP remain ahead.

## Possible later path: CrispMesh integration

Status: optional future path, not committed or implemented. CrispMesh's current Studio uses Preact, Three.js and Tauri. Embed the same CAD packages through a host adapter rather than a separate fork or a second native wrapper.

Suggested first workflow: **Edit a simplified scan in CAD**. Preserve the full-resolution reconstruction, edit a validated geometry-only derivative, and export STL/3MF or reopen the editable CAD document.

Required work:

- Mount/dispose the editor in a lazy CAD pane. Host project persistence, native open/save/share, local worker/WASM URLs and compatible stylesheet/WASM security policy belong to CrispMesh. Align Three.js versions or keep renderer objects isolated behind typed-buffer APIs.
- Establish verified physical scale and up orientation before dimensional editing. CAD is millimetres, right-handed Z-up; reconstructions can have arbitrary scale/orientation. Persist forward/inverse transforms and calibration provenance.
- Add indexed typed-buffer mesh handoff and explicit memory/triangle budgets. Current STL ingestion is capped at 16 MiB and 750,000 position components (about 83,333 triangles); it is not a full-resolution photogrammetry ingestion path. Evaluate versioned binary/external immutable mesh assets for larger projects instead of large embedded JSON arrays.
- Diagnose open, non-manifold and otherwise unsuitable meshes before booleans. Offer explicit simplification/repair and a reference-only path; preserve the original and do not silently fill intentional openings.
- Save a CAD sidecar with source artifact identity/hash, calibration and conversion metadata. Incoming reconstruction updates must not overwrite edits. Make derived assets participate in project save, reopen and cleanup.
- Preserve the original textured reconstruction separately. The current CAD pipeline has no photographic UV/texture preservation through boolean operations; that would be separate scope.
- Verify scan → calibration → CAD → save/reopen → export, scale correctness, cancellation, invalid inputs, offline operation and iPad memory use. Retain standalone and Brickwright embedding tests.

Licensing boundary: keep the BSD CAD packages independent; do not copy CrispMesh's AGPL implementation into them. CrispMesh currently records its owner's official-store distribution permission in its NOTICE. Retain dependency notices and review the actual release dependency inventory.

Planning estimate, not a delivery commitment: a few days for an embedding proof; several weeks for a dependable simplified-scan workflow. General mesh repair, large scans and texture-preserving edits require separate scoping.

## Later: Brickwright integration

Use the existing SB3 sidecar adapter and coordinate conversions. Wire the shared editor to Brickwright's host UI and persistence. Connector/physics metadata and LEGO assembly semantics remain explicit host responsibilities. See INTEGRATION.md.

## Required product direction: UX, parametrics and iterations

The finished editor must meet or exceed the reference's usability and versatility,
with independent implementation and permissively licensed dependencies. See
[UX-AND-PARAMETRIC.md](UX-AND-PARAMETRIC.md) for workflow acceptance, optional
parametric architecture, persistent revision semantics and the remaining work.

Current milestone adds the full category catalog and persistent model iterations.
The next delivered milestone adds a native macOS host and optional named parameters,
unit-aware formulas and primitive/transform bindings, including retained boolean
operands; see [PARAMETERS.md](PARAMETERS.md).
Full parametric sketches/B-rep and complete mechanical/elastic simulation are
separate implementation milestones with explicit qualification requirements.

## Workbench revision after owner inspection

Implemented: a single application row, one Shapes entry, consolidated File/Export,
About and Settings, project library, compact iteration selector, stronger selection
indicators, default Select/drag with V/Escape, and visible numeric transform fields.
Screw/thread/nut and heart recipes are editable and regenerate transactionally;
other catalog generators still need their specific controls. Normal saved `.bcad`
files include history. macOS mirrors the library to a configurable filesystem
folder and refuses file updates that discard or rewrite saved iterations.

## Parametric foundation: implemented 2026-11-13

Document version 3 retains separately identified analytic sketches and versioned
extrusion features, with unit-aware expressions and deterministic dependency
analysis. A shared sketch can drive several extrusions and retained booleans.
The Sketch dialog preflights the whole solid and commits one undoable edit;
reopen, archive history, duplicate, paste and Jolt collision invalidation retain
the definition. Existing version 1/2 projects remain supported.

The concrete schema, headless APIs, reference boundaries and next implementation
order are in [PARAMETRIC-MODEL.md](PARAMETRIC-MODEL.md). Prioritize headless catalog
features and sketch entity/constraint contracts next, then further solid features,
semantic attachments/mates and incremental recomputation. The current profiles
are rectangle/circle templates, not a freehand constrained sketch editor.


## Parametric CAD strategy and practical modeling workflow

The cross-application comparison, pinned FluidCAD/Solidcraft/Macad3D source reviews,
licensing boundary and implementation order are in
[PARAMETRIC-CAD-STRATEGY.md](PARAMETRIC-CAD-STRATEGY.md). Prioritize constrained
sketches, scoped part inputs, stable outputs and datum-based references over
copying another editor's preset list. Solidcore is an experimental permissive
exact-backend candidate to benchmark; no new kernel has been adopted.

The current library presents 30 essentials by task, including retained parametric
L bracket, mounting plate and spacer templates. The other 22 constructions,
including SBC and QR, are discoverable through Additional shapes or search.
Existing models and factory IDs remain supported. XYZ values are optionally
shown beside the selection and update during transform/direct drags, as do the
inspector values. Preview frames are not history entries; accepted release is one
edit. The preference belongs to the host/view, not the saved CAD definition.

## Code-defined parts and model browser: implemented 2026-11-13

Document v4 retains original CAD Script source and scoped overrides. GUI preview
and accepted edits share the same core compiler/kernel as the headless stdio MCP
server. Full archives retain all iterations. See [Code mode](CODE-MODE.md) and
[MCP](MCP.md) for the supported subset and the headless/live-window boundary.
Next: live host transport with revision guards, reusable parameterized functions,
2D code profiles and constrained sketch integration. An implicit field backend is
an optional research path, inspired only by ImplicitCAD documentation; no AGPL
implementation or new kernel is adopted. Require explicit tolerance and mesh/
collision qualification before such a backend can produce printable bodies.

The model browser now uses compact body rows, collapsible authored boolean inputs,
code parameters, sketch/extrusion inputs, and model parameter/sketch sections when
present. Generated preset internals remain hidden. Preserve selection and keyboard
editing when browsing inputs. Saved iterations remain in the existing selector;
construction dependencies are not a second chronological history. Add constraints,
datums, assemblies and feature suppression/rollback only with their real data
models and editing tools. Do not add empty categories or imply a solver exists.

Browser interaction and staged UX acceptance are in [Model browser](MODEL-BROWSER.md).

[Constraint solving](CONSTRAINTS.md) pins the CAD-modeling-app/dart_csp review,
records executable Dart/JS probes, and specifies the retained entity model and
optional geometric solver extension. This is the next constrained-sketch path,
not a claim that a general sketch solver is already integrated.

The updated [constraint performance](CONSTRAINT-PERFORMANCE.md) probes qualify
current dart_csp geometric sessions in JS/Wasm workers. Production integration
still needs our retained sketch entities, worker adapter and coupled-sketch acceptance. [Localization](LOCALIZATION.md) and
[workbench preferences](WORKBENCH-PREFERENCES.md) record the current English/German,
editable lettering, projected numbers, transformed dimensions and appearance APIs.

## Workspace and library follow-up (2026-11-13)

Delivered compact dismissible menus, independent browser/canvas columns, browser
history footer, Projects in File, adaptive selection actions, Shift/Fine controls,
34 tested original code examples, new-code/sketch workplane placement and expanded
About with offline notices. STL import/export remain mesh workflows.

Next library milestone: per-asset provenance in documents, a validated catalogue
manifest, attributed export sidecars and hash-checked local cache before remote
catalogue insertion. Start with original code examples and CC0 calibration parts;
review native FreeCAD assets and individual Thingi10K grants. Storage and content
licence boundaries are in MODEL-LIBRARY.md. No mass dataset import or new remote
library repository is implied by this plan.

## Shared GUI and source milestone (2026-11-14)

File → Model source now provides a nonmodal projection of the retained model. GUI
actions patch source fields/calls; an accepted source Apply is one normal modeling
transaction with undo and saved history. Source recipes reconstruct generated parts
through the same factory as Properties. Draft conflict checks, semantic merging,
project-contained assets and complete source/history round trips are implemented.
See [the workflow and schema](UNIFIED-DESIGN-SOURCE.md).

Next: integrate constrained sketch entities and the qualified geometric worker
through these same transactions; add feature suppression/rollback and richer
source mapping only with their retained dependency models. Existing source-backed
primitives, sketches, booleans and generators provide the shared foundation.

## Fast construction follow-up (2026-11-14)

Delivered: optional lower-right shapes dock, drag/tap onto highlighted faces,
editable oriented placement previews, fine snapping, safe cancellation, Solid/Hole
cutters and rectangle selection. Existing popup insertion and transform workflows
remain available. See [workflow acceptance](UX-AND-PARAMETRIC.md#fast-construction-workflows-2026-11-14).

Next priorities: previewed alignment, persistent face workplanes, duplicate-repeat,
lock/hide/isolate and direct dimension handles. Keep these contextual and usable
without a keyboard; do not add another permanent ribbon or explanatory text wall.


## Everyday generator retention — 2026-11-15

Twelve additional shape families now retain numeric design recipes shared by
Properties, Model source and MCP. Linked hollow-part dimensions and separate
surface-detail controls are implemented. The catalogue parameter gap is now 27
presets. See [RETAINED-SHAPES.md](RETAINED-SHAPES.md) for the exact scope,
legacy handling and the remaining formula/constraint boundary. Cutting tools and
enclosure parts are next; functional mechanical parts follow with fit and
collision evidence.


## Existing-object surface dragging — 2026-11-15

Existing selections now have default-on surface contact dragging, a magnet/`C`
opt-out, visible face targets and temporary Alt bypass. Relative geometry and
scales are preserved; one release creates one transform/history step. Exact
source-buffer bounds are cached, input is coalesced per frame, and the shape
palette no longer blurs the canvas. See [SURFACE-DRAGGING.md](SURFACE-DRAGGING.md)
for behavior and the limits of the performance evidence.


## Cutting/enclosure generator retention — 2026-11-15

Counterbores, countersinks, rounded ports, screw bosses and ribs now retain their
design inputs across Properties, model source, MCP and revisions. Countersink
seat depth is derived from the angle and displayed live; clearance is diametral.
Edited bores, support ribs and recesses have actual-geometry collision tests.
The remaining shape-parameter gap is 22. Curves/vessels and mechanical parts
remain ahead; this does not add constrained sketches or certified fastener fits.


## Curved/hollow generator retention — 2026-11-15

Six more shapes retain profile and section inputs across GUI, model source, MCP
and saved revisions. Vases use a smooth profile with a separate floor; finishing
washers derive seat depth from their angle. Collision construction handles dense
radial profiles, small tips and compound-sector seams without changing Jolt or
loosening qualification limits. The parameter gap is now 16; bent tubes, lofts,
mechanical constructions and decorative templates remain. See
[CURVED-SHAPES.md](CURVED-SHAPES.md) for formulas and boundaries.


## Retained transition/sliding templates — 2026-11-15

Bent tubes, rectangular-to-round solid/duct transitions and dovetails now retain
their dimensions through GUI, source, MCP and revisions. Section-grid collision
metadata follows actual geometry; warped hollow cells have a bounded exact-kernel
refinement path. Dovetail clearance offsets profile planes rather than scaling a
key. The catalogue parameter gap is 13. Hinges, springs, gears, pulleys and other
mechanical constructions remain next with explicit fit/clearance acceptance.
See [RETAINED-TRANSITIONS.md](RETAINED-TRANSITIONS.md).
