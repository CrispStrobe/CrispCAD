# Roadmap

## Now: a usable standalone CAD workbench

Implemented in the current workbench update: labeled tool groups, a camera-synchronized front/right/top view cube, other principal views, a millimetre baseplate, framing and zoom, perspective/orthographic projection, snap controls, and placing bodies on the workplane. Keep navigation and view preferences outside the CAD document and undo history. Keep the editor embeddable with instance-local events and complete disposal.

The Layerling screenshot supplied by the owner is a visual workflow reference. Implement our own UI and interaction code; do not copy its implementation, assets, or translations. This milestone does not add sketching, fillets, STEP, or the other advanced operations visible in that reference.

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
