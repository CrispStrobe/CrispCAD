# Shape and workspace quality follow-up

Independent BSD-3-Clause implementation. Reference products supply behavioral
observations only; do not inspect/copy their geometry implementation, meshes,
assets or UI code. Public guide observations are recorded as requirements, not
as evidence that our implementation has parity.

- [x] Implement conventional screw ends: flat, chamfer, cone, dog, cup, oval,
  threaded gimlet; retain editable dimensions. Add headless/wood presets.
- [x] Preserve old screw recipes; test regenerated watertight solids and undo.
- [x] Complete screw GUI/browser checks and physics qualification.
- [x] Replace bent-heart hull unions with one conforming indexed shell.
- [x] Make the teardrop roof tangent to its circular arc.
- [x] Validate curved-shell topology, visual smoothness and Jolt geometry.
- [x] Replace the sketch/extrude text-heavy dialog with a visual preview and
  direct handles, keeping expressions and retained sketch editing.
- [x] Visible grid follows Snap Grid by default; allow independent spacing;
  remove zoom-driven disappearance and the duplicate mm field.
- [x] Right-pane shape browser plus screen-fitting dialog; Shapes above
  Properties by default, saved pane order and upper/lower split slider.
- [x] Route native Mac trackpad scrolling to camera; suppress webpage navigation
  and pull-to-refresh while preserving scrolling in actual controls.
- [x] Editable ruler length, mm/inch graduation and optional numbering.
- [x] Audit default topology and physics qualification for every spawn preset;
  record retained-parameter gaps.
- [ ] Complete the catalogue-wide edited-dimension, curvature and mechanical-fit
  review; default closed solids alone do not establish those properties.

Primary behavioral references: [shape settings](https://layerling.com/guide/shapes.html),
[sketching](https://layerling.com/guide/sketches.html),
[mechanisms](https://layerling.com/guide/threads-and-mechanics.html),
[measurement](https://layerling.com/guide/measuring-and-notes.html).
The available local MCP skill was reviewed; no local editor was running at port
3000. No connected Layerling MCP tools were exposed. Public documentation is the
primary reference. A disposable public-editor session was also used to observe
its editor and shape selector. Live bent-heart comparison was not completed;
no reference assets or implementation were retained in this repository.

Conventional screw-point references:
[McMaster point descriptions](https://www.mcmaster.com/info/types-of-set-screw-points.html)
and [manufacturer's 2014 offering](https://www.holo-krome.com/uploads/7/2/7/5/72754089/9702327hk_holokromebrochure_websingles.pdf).
Use generic geometric proportions and names, not branded serrations, patented
cutting/flute arrangements, markings or copied drawings. Catalogue geometry is
not a claim of ISO/DIN dimensional certification or manufacturing qualification.
A generic-shape implementation is not a blanket worldwide patent clearance;
newer combinations/claims and manufacturing applications need a specific review.
[EPC term](https://www.epo.org/en/legal/epc/2020/a63.html),
[USPTO term guidance](https://www.uspto.gov/patents/maintain).


## Catalogue audit and remaining gaps

Run `npm run build:packages && node scripts/audit-shape-quality.mjs` to regenerate
`artifacts/shape-quality.json` for all 59 spawn presets. The current defaults yield
58 closed positive-volume solids and one excluded reference ruler. Run
`npm run verify:physics` separately: all 59 defaults pass qualification or are
explicitly excluded measurement helpers. Those default checks do not establish
correctness across every parameter combination, mechanical fit or manufacturing
suitability. Curved-shape and screw-point regression tests cover selected edited
variants as well.

The current audit finds 27 presets without retained shape-specific generators
(39 at the first audit; twelve were completed in the everyday-shape pass). They still
support transforms and dimensions, but editing their design intent is incomplete.
Priorities for follow-up are:

1. Completed: twelve everyday families now retain dimensions, curvature, walls
   and resolution. See [retained shapes](RETAINED-SHAPES.md) for inputs and limits.
2. Counterbores/countersinks, ports, bosses and ribs: meaningful clearance,
   bore and wall dimensions, predictable attachment origins.
3. Gears, pulleys, springs, hinges and mating parts: retain mechanical design
   inputs, establish dimension/clearance tests and qualify edited collision shapes.
4. Remaining decorative/library templates: distinguish meaningful editable
   parameters from arbitrary mesh scaling; avoid implying functional electronics
   or QR semantics for illustrative shapes.

The rendering change computes smooth normals only across shallow angles. It
preserves sharp edges and leaves kernel/export/physics geometry unchanged. It
must not substitute for curvature resolution or retained parameters.

Collision qualification compares source and compound before an avoidable
Float32 union export/reimport. Both missing and extra volumes, plus the numerical
volume-conservation residual, count against the unchanged 2% default budget.
Old saved qualification reports remain readable; their certificates confer no
runtime authority and edited geometry still requires fresh qualification.


## Mac secondary-click menu follow-up

The user's screenshot established that “Reload” was WebKit's context menu,
not a pull-to-refresh indicator. A right-button camera drag temporarily disables
OrbitControls; that also disables its own context-menu suppression. The canvas
now consumes `contextmenu` in a separate capture handler, which remains active
throughout orbit/pan and is removed when the viewport is disposed. This is
separate from precise scroll/pinch routing. The regression uses a real secondary
pointer down/drag/up, checks menu cancellation both during and after the drag,
and verifies camera movement without model/history edits or page reload.
