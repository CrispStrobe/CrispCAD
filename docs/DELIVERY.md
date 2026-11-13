# First delivery — 2026-11-12

The scope in SCOPE.md is implemented as a standalone application plus four
reusable BSD-3-Clause packages. This is a mesh-solid MVP, not feature parity
with Layerling. No application integration changes were made in the active
Brickwright checkout.

## Verified

- TypeScript package/application build and production asset generation pass.
- 27 headless tests pass: document validation, future/cyclic/oversized rejection,
  transactional commands, independent histories, retained operands, graph-depth
  bounds, immutable mesh sharing, real Manifold volumes/transforms, STL round-trip,
  3MF structure, worker cancellation/recovery, SB3 preservation and frame conversion.
- 14 browser workflows pass in Chromium and iPad WebKit: create/dimension/edit,
  retained booleans, download/reimport, autosave/reload, invalid-file protection,
  multiple embedded editors, unmount/remount, narrow panel layout, scoped keyboard
  commands, actual touch tap selection and offline editing.
- Offline acceptance stops the actual HTTP origin server after precaching,
  proves Node can no longer fetch it, then reloads the saved design and adds a
  solid in each browser. Static responses vary by Origin to exercise module
  request/precache header differences. The worker ignores Vary for its own static
  program cache. WebKit's network-offline emulator produced an internal navigation
  error; the stopped-server test avoids attributing that tooling failure to the app.
- All four npm tarballs install offline into an independent temporary host. That
  host imports the public APIs and evaluates a real 10×20×30 mm solid, volume 6000.
- A read-only fixture using the real Brickwright SB3 writer and loader preserves
  the driving-base LEGO model and every original archive entry through CAD attach/
  extract. This verifies the adapter, not the future application's UI wiring.
- The iPad host archives and exports with the existing shared Brickwright
  Distribution certificate. No new Distribution certificate was created.
- Brickwright CAD 0.1.0 build 2 was installed over the paired iPad’s local-network
  tunnel and launched successfully. Physical Files/AirDrop/Pencil acceptance is
  still separate from installation/launch.

The local test browser cache was provisioned on the internal temporary volume
because this Mac's default cache points to an external disk. For a normal build:

```sh
npm ci
npm run build
npm test
npx playwright install chromium webkit
npm run test:e2e
npm run verify:packages
npm run verify:brickwright -- /path/to/brickwright-lite
```

GitHub Actions is configured to build and run package/headless/browser checks;
no remote repository or CI run is claimed. The optional real-Brickwright fixture
is an extra local integration check and is not needed to build this standalone repo.

## Product limits

- Primitives, booleans and imported closed STL meshes; no B-rep/STEP, sketch
  solver, fillet/chamfer or LEGO mechanism editing in this UI.
- LDraw mesh handoff deliberately requires separately authored connector and
  physics metadata. It must not be represented as an already-qualified robot part.
- The standalone app has one local autosaved workspace; portable .bcad files
  keep independent projects. Browser storage quotas can reject large autosaves;
  the host reports the failure and file export remains available.
- STL and 3MF exports are meshes; 3MF currently has geometry without materials.
- Positive non-shearing transforms are supported. Group transforms that would
  introduce shear are refused. Separating a transformed boolean requires reset.
- Browser tests use emulated iPad/touch environments. Native installation/launch
  does not establish physical Apple Pencil, keyboard, large-file or Files/AirDrop
  round-trip acceptance; these remain device acceptance checks.

Integration steps and lifecycle responsibilities are in INTEGRATION.md. Signing
and direct-device installation are in IPAD.md.

## Workbench UX update — 2026-11-12

- Original grouped icon ribbon and editable design header; collapsible Objects
  and Properties panels and horizontal ribbon scrolling for narrow hosts.
- Camera-synchronized SVG view cube: Top/Front/Right faces and all six exact
  principal views through the view menu. Home/Fit, zoom and perspective/
  orthographic projection operate on the actual viewport camera.
- Numbered 400 × 400 mm workplane with 1 mm minor and 10 mm major lines,
  origin axes, visibility toggle and independent movement snap spacing.
- Persistent touch multi-select and undoable Drop to workplane based on evaluated
  world-space bounds, including rotated bodies.
- Navigation and view choices leave the editable document and history unchanged.
- Production build, 27 headless tests, 18 Chromium/iPad WebKit workflows and
  offline installation of all four packed packages into an independent host pass.
  Browser workflows include actual orbit/cube synchronization, projection,
  document preservation and undo/redo of rotated-body placement.
- Visually reviewed desktop and iPad landscape screenshots. Physical touch,
  Pencil, Files and share-sheet acceptance remain separate from browser checks.
- The possible CrispMesh integration is recorded in ROADMAP.md; no CrispMesh
  source files were changed and no integration is claimed.
- Native version 0.1.0 build 3 archived and exported using the existing
  Brickwright keychain, then installed and launched successfully on the paired
  iPad over its local-network tunnel. No store upload was performed.

## Catalog, simulation boundary and permanent iterations — 2026-11-12

- Implemented 49 searchable, categorized catalog entries with original geometry-
  derived previews, pinning, text/name/QR input and sanitized filled-SVG icons.
  The capsule is a flat-based rounded slot, matching the reference workflow.
  Mechanical parts and generic board/grid/pulley templates are starting designs;
  this does not qualify their manufacturing fit or every parameter variation.
- Added versioned body material/mechanical intent and local hinge/fixed frames.
  A hinge inserts as three independent bodies with two joints. Helpers are excluded
  from exports, mass and simulation. Joint identity/remapping, composite-density
  guards and helper validation survive save/load and editing commands.
- Added the independent headless cad-physics package using the existing MIT
  Brickwright Jolt fork. Actual solid mass/COM/inertia, qualified compound
  preprocessing, SI conversion, fixed steps, source/buffer integrity and native
  small-part contact tolerances are exercised by real debug-build tests.
- The full default-catalog report passes: 48 rigid solids create native shapes,
  simulate one second at 200 Hz, stay finite and pass the floor-surface check;
  one ruler is excluded. Mechanical/elastic behavior remains explicitly separate:
  an unconfigured spring/thread/gear/belt/snap-fit is not called a mechanism.
- Added append-only model revisions, model selection, named iterations, restore
  that preserves later work, content-addressed mesh sharing, and portable history
  backup/import. History has no automatic pruning; its current in-memory backup
  path is capped at 64 MiB and fails without deleting revisions. Native journal
  mirroring and streaming large-history backups remain roadmap work.
- Model changes archive transactionally. Tests cover more than the 100-entry edit
  undo bound, multi-writer serialization, aborted-write rollback, reload, branching
  restore, portable import as a separate model and corrupt-archive refusal.
- Added native/custom-scheme-safe secure UUID generation and an MIT SHA-256
  fallback when randomUUID/WebCrypto are unavailable. Both browser engines verify
  creation, autosave and history restore with those APIs deliberately disabled.
- Validation: production build, 92 headless tests, 24 Chromium/iPad WebKit workflows,
  the full catalog rigid-preview qualification, and independent packed-package
  geometry/real-physics checks pass. Offline SDK verification supplies the pinned
  GitHub Jolt runtime as a local tarball; registry dependencies use the npm cache
  populated during setup. No remote CI run or publishing is claimed.
- Read the owner's linked guide and relevant workflow chapters. The required
  reference-UX acceptance criteria and optional feature/constraint architecture
  are in UX-AND-PARAMETRIC.md. Complete GUI parity, constrained parametric sketches,
  B-rep/STEP and an interactive mechanical/elastic simulation workspace remain
  separate milestones. CrispMesh remains an optional future integration path.
- Signed native version 0.1.0 build 4 and installed it on the paired iPad over
  WLAN. Installation succeeded; automatic launch was denied by iPadOS because
  the device was locked. Physical Files/Pencil and touch acceptance remain pending.

## Native macOS inspection host

- Built an original Swift/AppKit/WebKit host for macOS 14+, with bundled offline
  assets, a loopback-only stable origin, native Open/Save dialogs and native
  confirmation/checkpoint sheets. No desktop runtime dependency was added.
- The arm64 app is locally signed and installed in `~/Applications`. Actual
  native smoke verification passed editor/worker/WASM startup and an iteration
  save using an ephemeral workspace; the regular app was then launched for owner
  inspection. Browser tests pass project/history exports through the desktop
  bridge on Chromium and WebKit. Native dialog acceptance remains manual.
- Added macOS build instructions, contribution guidance and a macOS CI build
  artifact job. Native local signing is not a notarized distribution release.

## Optional named parameters

- Added bounded, unit-aware expressions and transactional primitive/transform
  bindings, including retained boolean operands. Version 2 preserves the design
  graph and evaluated geometry; version 1 direct models remain supported.
- Added a scoped Parameters panel and an editable mounting-plate example. Driven
  numeric fields are marked, invalid expressions leave the prior model intact,
  and revisions/archives retain formulas and both branches after restoring.
- 103 headless tests, 28 Chromium/WebKit workflows, all 48 default rigid solids
  plus the excluded ruler, and native macOS parameter/reload/history smoke checks
  pass. A changed parameter requires fresh Jolt collision qualification.
- Added a native quit hook that commits the focused inspector field and flushes
  saved iterations. Smoke checks use ephemeral storage on their own loopback port.

## Compact workbench and native project library

- Replaced three stacked chrome rows with one application row. Removed redundant
  primitive shortcuts and the embedding-demo link from the product. File contains
  one Export dialog with a format choice; About includes version, author, project
  links, Brickwright-lite provenance and bundled license notices.
- Construction operands are collapsed by default. Object rows, checkboxes and
  cyan scene bounds clearly mark selection. Select is the default; V / Escape
  returns from Move/Rotate/Scale. Objects drag directly in the workplane or the
  corresponding side-view plane. Transform values remain numerically editable,
  with the active mode's fields placed first in Properties.
- Screws, threads and nuts expose pitch, diameter, length, depth, starts and hand;
  screws additionally expose head/slot dimensions, and nuts expose clearance.
  Hearts expose size, thickness, lobes, cleft and bend. Regeneration is preflighted
  and committed once, preserving root identity, placement, material, undo and
  revision history. Other specialized presets still need generator controls.
- Bent hearts retain convex sections as their actual CAD source. Both rendering
  and Jolt qualification use those sections; the earlier coarse warped-cap path
  failed the geometric collision gate and was replaced rather than relaxing it.
- Replaced the full-screen revision list with a paged iteration selector. Projects
  opens the searchable library. Normal .bcad saves include the complete history;
  legacy snapshot and .bcadhistory files remain readable. Mac Settings selects a
  library folder; existing journals migrate to full project files and subsequent
  edits update them automatically. Quit flushes pending writes. Native writes
  refuse damaged files and any update that removes or changes an old revision.
- Validation: 109 headless tests, 32 Chromium/iPad WebKit workflows, 48 default
  rigid-solid qualifications plus the excluded ruler, edited screw/bent-heart
  real-Jolt checks, and the native app/file/anti-pruning smoke check pass.
- Signed and installed macOS 0.1.0 build 3 and relaunched it. Its filesystem
  library was verified to contain the existing project's 66 saved iterations.
- Fresh-runner SDK packaging now supplies exact local runtime tarballs and tests
  an empty-cache offline install. Unused upstream Manifold GLTF/esbuild peers are
  excluded; geometry and real SI Jolt stepping are exercised in the packed host.

## Native menus and body selection follow-up

- Added native macOS File, Edit, View and Object menus with New/Open/Save,
  Import/Export, Cut/Copy/Paste, Duplicate/Delete, selection, principal views,
  projection, transform modes, workplane controls and model parameters. Native
  file commands use AppKit Open panels; Import adds STL geometry to the model.
- The editor exposes a typed command/state API shared by menus and workbench
  actions. Native Edit commands preserve ordinary text editing in focused fields.
  CAD clipboard transfers retain recipes, materials, joints and formula bindings;
  paste remaps identities and resolves parameter-name collisions without baking.
- Objects now contains actual top-level bodies only. Generic boolean sources are
  edited separately in Properties. New objects/copies receive distinct names;
  duplicate legacy names get a visible ordinal. Row selection explicitly focuses
  the canvas, fixing Delete immediately after an Objects click.
- Native runtime verification exercises actual menu handlers and a private Cocoa
  pasteboard for Copy/Paste, Duplicate/Delete/Undo/Redo, while leaving the user's
  system clipboard untouched. Parameter/reload and anti-pruning file checks pass.
- macOS 0.1.0 build 4 was installed and reopened with the current workspace and
  its complete saved iteration journal retained.
- Final follow-up checks: 114 headless tests, 36 Chromium/iPad WebKit workflows,
  empty-cache SDK package installation and real geometry/Jolt stepping pass.


## Parametric definition foundation — 2026-11-13

- Saved document version 3: independently identified rectangle/circle sketches,
  reusable by several versioned extrusion features. Formulas use the existing
  bounded, unit-aware parser and named parameters. Retained booleans recompute
  from definitions rather than replacing them with meshes.
- Exported headless sketch/edit/extrusion APIs, semantic profile/output references,
  deterministic topological graph and transitive invalidation queries. Structured
  sketch/feature diagnostics survive the worker boundary. Future arbitrary
  topology references, a general constraint solver and B-rep remain explicit work.
- A Sketch dialog includes a 2D profile preview, numeric/formula inputs, plane and
  symmetry. Whole-model geometry preflight precedes one atomic undoable commit.
  Invalid drafts stay open. Native Object menu also exposes the action.
- Duplicate/paste retain and remap definitions and expression namespaces. History
  archives keep sketches and formulas; v1/v2 documents remain supported. Includes
  a two-bore mounting plate example sharing one circle sketch.
- The existing Jolt qualification path handles these evaluated solids. Regression
  coverage checks changed mass, rejection of stale collision data and a real
  floor drop after parameter changes.
- See [PARAMETRIC-MODEL.md](PARAMETRIC-MODEL.md) for schema, boundaries and next
  implementation sequence. No additional dependencies or reference-app source.


### Rotated-body scaling correction

Mac build 6 aligns the scale gizmo with the selected body's local axes (also
shared by a selection whose bodies have the same orientation). Scaling preserves
the stored rotation and unchanged numeric inputs exactly. Uniform scaling also
works across differently oriented selections; nonuniform scaling that would
actually require shear is still rejected without changing the document.
Regression coverage drags the real local X handle on a rotated, already
nonuniformly scaled screw in Chromium and iPad WebKit, then verifies Undo.
The native smoke test also creates a formula-driven sketch extrusion through
Object → Sketch and Extrude and verifies filesystem history retention.


Final verification for this update: 132 headless tests, 42 Chromium/iPad WebKit
workflows, native macOS menu/clipboard/sketch/library smoke checks, and independent
empty-cache offline installation of all six packed SDKs with real parametric
geometry and SI Jolt physics. Mac build 6 was installed and launched with the
existing project library retained.
