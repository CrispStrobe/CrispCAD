# CrispCAD: first delivery scope

Build one BSD-3-Clause CAD editor that works independently and can be mounted
inside Brickwright without forking the editor or replacing its storage system.
This delivery is a functional mesh-solid MVP, not Layerling feature parity.

Deliver now: standalone responsive browser app; framework-independent embedded
editor; immutable, versioned millimetre/Z-up documents; box/cylinder/sphere;
editable dimensions and transforms; selection, duplicate/delete; retained
union/subtract/intersection trees; undo/redo; worker-based Manifold evaluation;
project JSON save/load; standalone autosave/recovery; STL import/export; 3MF
export; a tested Brickwright SB3 attachment adapter; LDraw coordinate/mesh bridge;
embedding fixture with two independent editors; build and integration guides.

Reuse BSD touch/transform arithmetic from Brickwright at the commit and hashes
in brickwright-provenance.json. Do not import Layerling source, UI, assets or
translations. Do not modify the active Brickwright checkout during extraction.
The monolithic LEGO editor depends on simulation, connectors and fixed-part
contracts: preserve that behavior there, extract its independent arithmetic,
and implement a general-solid model behind a separate stable API.

Boundary: core knows no browser, React, Scratch, Three, Tauri or storage globals.
Geometry knows no editor UI. Editor owns its DOM, worker and scoped keyboard
listeners, and is disposable. Hosts own file access, storage, prompts and project
lifecycle. Host and standalone load precisely the same editor package.

Integration contract: versioned CAD document stored at brickwright/cad.json in
SB3, independently of the existing brickwright/state.json and simLab records.
Adapter round-trips all other ZIP entries. Existing Brickwright code must call
the adapter when it saves/loads; unmodified old hosts do not promise to preserve
new sidecars when re-saving. A later integration patch owns that wiring.
LDraw conversion uses 0.4 mm per LDU and a right-handed frame conversion. Mesh
handoff provides geometry, bounds and pose; it does not invent connector or
physics metadata or silently turn solids into qualified LEGO mechanisms.

Deferred: exact B-rep/STEP, fillets/chamfers, constrained sketches, parametric
extrusion, arbitrary LEGO/LDraw editing in the new UI, physics, multi-user sync,
full application integration into Brickwright, public publishing, App Store
submission and claims of legal cleanroom certification. iPad browser behavior
is exercised with touch emulation; physical acceptance is separately recorded.

Acceptance: build every package; real kernel geometry/volume and export tests;
invalid/cyclic/future documents cannot replace a live design; independent undo;
SB3 old sections preserved; frame transforms round-trip; browser create/edit/
boolean/save/reload; mobile viewport; embedded instance and lifecycle isolation.

## Subsequent workbench/catalog/history milestone

The later implementation adds 49 catalog entries, a shared headless Jolt adapter,
explicit materials/mechanical intent and articulated hinge data, and persistent
model revisions with immutable mesh sharing. See PHYSICS.md for precise preview
qualification and its limits; UX-AND-PARAMETRIC.md defines the remaining UX and
optional parametric scope. The first-delivery exclusions above describe the
initial MVP and do not claim that the later mechanical or exact-CAD milestones
are finished.


## Parametric definition milestone

The current model additionally retains rectangle/circle sketch definitions and
versioned extrusion features with expressions and reusable identities. The
original parametric-extrusion exclusion above applied to the first delivery.
[PARAMETRIC-MODEL.md](PARAMETRIC-MODEL.md) specifies the delivered schema, editor
workflow and remaining general constraint, topology and exact-kernel work.
