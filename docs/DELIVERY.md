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


## Practical modeling palette and live transform inputs — 2026-11-13

- The default palette is curated by task: Start a part, Build solids, Holes &
  hollow parts, Supports & connections, Motion parts, Labels & outlines. Thirty
  essentials include new retained parametric L bracket, mounting plate and spacer
  definitions; 22 additional presets (including SBC and QR) remain optional and
  searchable. Factory IDs and existing saved models remain valid.
- Properties exposes the selected feature's upstream named design inputs. Changes
  use the existing expression validation, recompute and history path.
- Optional XYZ inputs beside the selection show live position/rotation/scale
  values. The inspector also updates during drags. Numeric edits remain available;
  driven fields are identified and protected. Preview poses do not change model
  storage or add iterations. Release commits once; Escape restores the model.
- The host stores the display preference separately from models. XYZ below the
  workplane, Settings and native View commands control the same option. Embedders
  receive explicit initial/preference callbacks and setters rather than implicit
  shared storage.
- Full catalog qualification: 52 pass/excluded, no blocked entries; this is rigid
  preview qualification, not validation of elastic/mechanism behavior or print fit.
- [PARAMETRIC-CAD-STRATEGY.md](PARAMETRIC-CAD-STRATEGY.md) records a concrete path
  through sketch constraints, scoped parts/features, semantic references and
  exact-backend qualification, plus pinned FluidCAD/Solidcraft reviews. No code,
  assets or dependencies from those projects were incorporated.


Private-repository CI policy: GitHub Actions was disabled in repository settings,
no active runs remained, and the former workflow was archived outside the workflow
directory. Future verification runs locally; see [CI.md](CI.md). Visibility remains
private. The Macad3D architecture review is also recorded in the CAD strategy.


Local verification for build 7: 136 headless tests, all 48 Chromium/iPad WebKit
workflows, all 52 catalog qualification outcomes (51 rigid-preview passes and
one reference helper excluded), native Mac menu/clipboard/sketch/library checks,
independent offline SDK installation, and a separate Settings/reload check that
leaves the model untouched. The existing expensive edited-thread/bent-heart
physics fixture now has a dedicated 30-second test budget instead of the default
5 seconds; its geometric and physical acceptance checks are unchanged.

## Retained coded objects, headless MCP and compact browser — 2026-11-13

The original bounded CAD Script compiler retains source and local input overrides
in document v4. Nested transforms, CSG, named shapes and bounded linear repeats
produce the same evaluated solids in the GUI and headless server. Preview never
adds an iteration; acceptance preflights the full model and creates one edit.
Definition edits preserve object identity/placement and invalidate collision proof.
A new Jolt fixture verifies actual coded CSG, mass, stale-collider rejection,
requalification and floor contact after a local parameter change.

The stdio MCP server provides code help/read/preview/create/update, revision paging,
branch restore and complete project/STL exports. It uses a dedicated headless
session, not a live editor connection. File writes preserve all prior history,
refuse a competing writer/external change, and use atomic replacement. The official
MCP SDK client was tested against the real process. No runtime dependency was added.

The missing Sketch icon is fixed. Compact browser rows distinguish bodies from
expandable authored construction inputs, code-local parameter readouts and sketch
references. Existing model parameters/sketches get real sections. Generated preset
internals remain hidden. [Model browser](MODEL-BROWSER.md) specifies the progression
to constraints, feature editing, datums and assemblies without empty placeholder UI.

[Code mode](CODE-MODE.md) records the OpenSCAD/JSCAD/ImplicitCAD ideas-only review,
current grammar, budget/compatibility limits and optional future implicit-backend
path. No OpenSCAD/ImplicitCAD implementation or Solidcraft interface design was
incorporated. Document versions 1–3 remain readable; older builds refuse v4.

Local verification for build 8: all 149 headless tests, all 56 Chromium/iPad
WebKit workflows plus two final browser/icon checks, native Mac menu/clipboard/
sketch/code/library checks, official MCP SDK stdio interoperability and independent
empty-cache installation of all six SDK packages. The expensive knurl collision
fixture has an explicit 30-second budget after a timeout under concurrent browser
load; its contact and tampered-collider checks are unchanged. The same app build
was installed and launched with existing projects/history retained.

Constraint investigation: pinned dart_csp 13f2b049 and CAD-modeling-app 2a561555;
standalone Dart and dart2js/Node probes verify geometric residuals and demonstrate
nearest-pose/status gaps. Dart analysis passes. This development-only experiment
adds no production dependency. See [CONSTRAINTS.md](CONSTRAINTS.md) for the concrete
entity schema, solver extension and acceptance path. Private Actions remains off.

## Axis annotations, lettering, localization and device delivery — 2026-11-13

- Floating XYZ panel replaced by small numeric-only annotations attached to actual
  projected handles/rings, or visible axis guides in Select. Narrow layouts can
  use the opposite guide end; values preserve numeric editing, live previews,
  driven-field protection and Escape cancellation. Properties shows transformed
  X/Y/Z mesh dimensions in millimetres beside the editable scale factors.
- New name tags have rounded corners and retained text/font/dimensional recipes.
  Droid Sans, Serif and Mono are bundled under Apache-2.0 alongside the original
  block font. Text preserves case/German characters; missing glyphs are refused.
  Text/font changes preserve identity, placement, appearance and history. Older
  labels offer an explicit text-entry/Apply path, preserving their existing solid
  until acceptance. Raised-text depth includes overlap compensation so the measured
  relief height equals the requested value.
- English/German localization covers editor/host/native/MCP UI and diagnostics,
  with 869 catalog messages and 557 checked literal/template references. Language
  changes flush history before reload; user names, code and canonical values stay
  unchanged. System history labels translate for display without rewriting archives.
- Settings stores background/baseplate colours independently of model/history,
  with a reset action and corresponding embedding APIs.
- iPad web-content zoom/scroll bounce is locked while model pinch stays available.
  System Accessibility Zoom remains an OS setting; see WORKBENCH-PREFERENCES.md.
- The Dart constraint experiment now compiles/runs JS and Wasm in browser workers.
  Results expose nonlinear search-budget/recursion limits despite quick linear
  solves. Prioritize a warm-started geometric module, decomposition and bounded
  execution over a language port; see CONSTRAINT-PERFORMANCE.md. No solver dependency
  was added to the production app.

Verification: 152 headless tests; full 66-workflow Chromium/iPad WebKit suite, then
10 focused localization/preferences/legacy-label workflows; one actual CDP pinch/
three-touch workflow passed (WebKit skips that CDP-only case); six Jolt lettering
qualifications across all three bundled fonts; catalog/placeholder audit; native
Mac menu/clipboard/sketch/code/library checks; independent offline SDK installation
including a font-generated name tag. Final exact relief height is covered by a
kernel assertion and repeated font physics qualification.

Device delivery: CAD build 5 was installed/launched over WLAN, followed by build 6
with localization and the new workbench features. Build 7 adds the legacy-label
editing path and exact relief height; its installation succeeded. macOS build 10
is installed/running with existing projects/history retained. The separate latest
Layerling checkout (upstream 42a50d18f, version 1.161.0) was built with the existing
iPad wrapper as build 2 and installed/launched over WLAN. The original modified
Layerling checkout was preserved; its implementation/assets were not incorporated
into this CAD. All builds/checks remain local and private-repository Actions stays off.

## Workspace usability delivery — 2026-11-13

Source commit 893ad7b: independent Objects/canvas columns, outside pointer/focus
menu dismissal, icon-only Shapes/Combine/Edit controls and adaptive selection
shortcuts. Projects moves to File; history moves into the browser footer. New
code/sketch objects start on the workplane. Shift/Fine provides incremental
one-tenth-speed pointer travel and fine snapping/nudging/number steppers.

34 original code examples ship through the core, GUI and MCP help. Every example
passes compile, positive-volume kernel, STL round-trip and floor placement checks.
About follows the owner's Brickwright-lite content structure: version/build/git
receipt, imprint/privacy, local app cards, grouped component credits and full
bundled legal texts, including fonts and native IONFilesystemLib MIT notice.
German additions pass the 933-message catalogue/placeholder audit.

Local validation: 188 headless tests, six-package offline install/geometry/Jolt
smoke, native macOS command/clipboard/project/history smoke and desktop/iPad
browser workflows. An interim broad browser run had 75 passes, one intentional
WebKit/CDP skip and two stale-bundle missing-Copy-icon assertions; the icon was
fixed and the final bundle rechecked with the complete usability/localization
subset, including real fine drag/rotation on both browsers. No cloud CI used.

Mac build 11 is installed and running. iPad build 8 uses the same source and
existing Brickwright keychain/profile. Wireless installation status is recorded
in the delivery follow-up below. No Layerling implementation/assets were used.
Third-party model-library ingestion remains a documented follow-up; see
MODEL-LIBRARY.md for content licence filtering, provenance and hosting boundaries.

WLAN follow-up: signing/archive/export of iPad build 8 succeeded and its receipt
matches clean source 893ad7b. Device pairing/transport is `localNetwork`. iPadOS
rejected installation with IXUserPresentableErrorDomain 11: 5,076,356 bytes needed,
775,808 bytes available, 4,300,548 additional bytes required. No app/data was
removed to force installation. The owner was asked to free storage; installation
is pending that external condition. The signed IPA is apps/ipad/build/adhoc/App.ipa.
Mac build 11 native smoke passed and installation/launch succeeded. The final
16-workflow desktop/iPad usability and localization subset passed completely,
including the previously stale Copy icon assertions and actual fine gestures.

## Mac build 12 and source-converter checkpoint — 2026-11-13

Build 12 is installed and running from clean source 44eb631. Build 11 predates
the native trackpad changes. An AppKit local magnification monitor now intercepts
pinch before WebKit internal views, and routes it to the canvas camera. Native
smoke verifies that this route changes camera distance, keeps page scale at 1,
and leaves project data unchanged; existing native menu/library/history smoke
also passes. Physical user trackpad inspection remains the hardware check.

The VPS library was merged without replacing its immutable source/evidence or
provenance policies. All 384 then-current integrated unit tests passed; reviewed
source checks convert 36/38 sources and keep the slice-extrusion and SCAD-function
gaps explicit. Both archived source/example reproduction checks pass. Optional
research tooling builds a pinned permissive Rust syntax oracle and probes a
research-only dataset outside the repo; see SOURCE-RESEARCH.md. Locale catalogue
conflicts introduced by the concurrent work were consolidated afterward.

## Symbolic source conversion and product README — 2026-11-13

README now describes this editor's modeling workflow, source interchange, projects,
library, navigation, native hosts, SDK packages and limits. Competitor-review
references were removed from the product introduction.

OpenSCAD file-scope modules now expand symbolically with positional/named/default
arguments, lexical globals and propagated special `$fn` arguments. Named vectors,
literal indexing, boolean flags and degree math retain scalar dependencies.
Recursive expansion is bounded before strings can exhaust memory. Native parameter
formulas share the safe math whitelist, including unit/domain validation.
JSCAD adds rectangle/circle/ellipse profiles and planar transforms before extrusion;
independent JSCAD-library geometry checks compare volumes and bounds.

Local validation: production build, 400 unit tests (including the optional external
syntax oracle), 10 desktop/iPad WebKit source-import and camera workflows, and the
1,078-message German catalogue audit pass. The reviewed library remains 36/38
converted; the two known feature gaps stay explicit. The isolated 256-file research
sample improves from 5 to 8 positive-solid conversions without losing previous
successes. No GitHub Actions or protected application implementation was used.
These source changes follow installed Mac build 12; see its separate receipt above.

## Mac build 13; symbolic functions and lexical bindings — 2026-11-13

Mac build 13 was installed and launched from clean checkpoint 5c17d15. Native
magnification/camera isolation and menu/clipboard/library/history smoke passed.
The README rewrite and the first module/profile converter extensions are included.

The next source checkpoint adds original bounded OpenSCAD scalar/vector function
expansion, named/default arguments, generated polygon profiles, implicit `$fn`
arguments, and lazy module/operator-local bindings. Final local assignments apply
throughout their lexical scope; captured bindings retain their defining scope.
Cycles, recursive expansion and deep binding chains are bounded. Anonymous-block
assignment scopes, loops/conditionals, nested definitions and other unsupported
features remain explicit gaps. The importer lives in openscad-import.ts; public
SDK, GUI, CLI and MCP APIs are unchanged.

Validation: production build, 406 unit tests with optional syntax oracle, 10
Chromium/iPad WebKit source-import/camera workflows, 1,079-message German audit,
and all six SDK packages installed offline with an empty npm cache, including
actual geometry/physics checks. The research sample improves to 10/256 positive
solids without losing prior successes. Full language compatibility is not claimed.

Mac build 14 follow-up: built, verified, installed and launched from clean source
ff362ef5595fe59be03ef3ce19863bcafb2d8095. The running app's asset receipt reports
that revision with dirty=false, and its native bundle reports build 14. Native
magnification isolation and the complete native menu/clipboard/library/history
smoke passed. Existing projects and their histories were retained.

## Retained control flow, engine extension and current constraint review

Native CAD Script adds parametric range/value loops, lazy shape choice, empty
geometry, typed boolean/conditional expressions, tapered cylinders and 3D hulls.
OpenSCAD range/list loops and if/else retain their source scalar dependencies;
JSCAD gains circular tapers, 3D hull and empty-geometry interchange. Tessellation
uses the global mesh budget with distinct resource-limit diagnostics. Real Jolt
mass/collision/drop checks cover a regenerated imported hull/taper/loop object.

Local verification: production build, 418 unit tests, 16 desktop/iPad WebKit
code-import/camera/localization workflows, 1,091-message German audit and six
SDK packages installed offline with an empty cache. The fixed research sample
improves 10 -> 38 positive solids without losing previous successes. Reviewed
library coverage remains 36/38, with two explicit feature gaps.

The updated MIT dart_csp 2.4.0 was pinned at 894a11d74dae312ca99578532b27cca0b51fd34f.
Its actual geometry/transaction/linkage examples passed; a new original probe ran
native and in JS/Wasm workers with independent residual/freedom checks. Fresh
results and qualified recommendations supersede the old interval-only assessment.
The solver remains an isolated development experiment pending our sketch/worker
integration; see CONSTRAINTS.md and CONSTRAINT-PERFORMANCE.md.

## Shared GUI/source workflow — 2026-11-14

File → Model source adds a nonmodal source dock on the retained document graph.
GUI edits minimally patch source values/calls; accepted source edits preflight the
whole model and commit once into undo and archived history. Code an object links
directly into this view. Generated parts use compact editable recipes, rebuilding
through the same factory as Properties. Dirty drafts survive GUI changes and can
merge independent edits; conflicts preserve the saved model and draft. Stable-ID
selection follows in both directions. Schema 6 stores source with the graph;
versions 1–5 remain readable, including their complete existing revisions.

Local checks: production build; 433 unit tests passed (one optional external-oracle
test skipped); 42 Chromium/iPad WebKit workflows passed, including source/GUI
round trips, dirty-draft merging, rejected drafts, converter imports, provenance,
parameters and German UI. The 1,155-message German audit passed, and all six SDK
packages installed and ran offline from an empty cache. Unit coverage also checks
source-preserving portable archives, identity remapping, clipboard fragments,
generator guards, template escapes, attribution and reference helpers. MCP gets
read/preview/apply source tools with one saved iteration per accepted edit, using
its existing separate headless project session.

Mac build **15** was built from clean source
`9d000b24f529cc6cd751ff8f8500c1efb787790b`, locally signed, installed in
`~/Applications/Brickwright CAD.app` and launched. The running asset receipt
reports that revision with dirty=false, and the installed bundle reports build
15. Native smoke checks passed for camera magnification at fixed page scale,
menus/clipboard, sketch/code creation, the new Model Source menu/dock without
a model edit, complete library files and refusal to prune existing history.
Four additional desktop-host browser checks passed in Chromium/WebKit, including
registration of the native Model Source command. Existing user projects were
retained during graceful replacement of the previous app.

## Image-led model library and one desktop File menu — 2026-11-14

The library now uses preview cards, compact licence tags, search/type filtering
and a selection/insert panel. All 36 bundled sources have cached PNG thumbnails
rendered from their evaluated geometry, keyed by original source SHA-256. Optional
notes no longer gate insertion; accurate default incorporation/conversion notes
are recorded automatically. Licence text scrolls below Insert; complete technical
and collision records remain available in a collapsed section. Close is an
accessible × control. The macOS native File menu gains Model Library and replaces
the in-window File menu; browser/iPad and ordinary embedded hosts retain theirs.

Verification: production build, 433 unit tests (one optional external oracle
skipped), 1,165-message German audit and 22 Chromium/iPad WebKit workflows. The
20 gallery/desktop cases passed; two collision-report cases were updated to open
the newly collapsed technical section after changing catalogue selections and
passed on rerun. Visual inspection caught and fixed card compression and filter
width before delivery; geometry checks now protect card height/label placement.
Actual image decoding, insertion without notes, cancellation, offline reuse, undo,
attributed exports and native menu command routing are covered.

Mac build **16**, from clean source
`54fef9890fc1501bf58da488c38f05bdbda76217`, passed native smoke checks for the
sole native File menu and gallery thumbnails, model source, clipboard, camera,
geometry creation and preservation of complete library history. It was locally
signed, installed at `~/Applications/Brickwright CAD.app` and launched. The running
asset receipt reports that revision with dirty=false; the installed bundle reports
16. Graceful replacement retained existing user projects and histories.

## Visible New/Open/Save actions — 2026-11-14

All hosts now expose three compact project-action icons using the same underlying
New/Open/Save handlers as menus and shortcuts. On Mac the native File menu remains;
touch/browser hosts retain their in-window File menu. The three icons stay outside
the scrolling modeling toolbar, use 44 px touch targets, and keep Shapes prominent
on narrow screens. Save is labelled as a portable project file including history;
working-project autosave remains unchanged. A host-provided save callback also
enables Save without requiring a second export callback.

Checks: production build and 1,169-message German audit pass. Twelve desktop/file
workflows passed in Chromium and iPad WebKit. After the final Shapes-order change,
all six file-action workflows passed again, covering save/new/reopen, reachable
390 px phone controls during toolbar scrolling, initial Shapes visibility, and
native Open routing with visible file buttons. Desktop and phone screenshots were
inspected before delivery.

Mac build **17** was built from clean source
`dbc3a9a01d4e566ca0024153682cdcf61cf79292`, passed native smoke checks including
the three visible project controls, was locally signed, installed and launched.
The running receipt reports that revision with dirty=false and the installed
bundle reports 17. Existing user projects/history were retained.

## Project import/export and recoverable removal — 2026-11-14

Projects now offers multi-file Import and a per-project ⋯ menu for Export,
Duplicate, Rename and Move to Trash. Export targets that project's entire journal
without opening it; import adds a separate project without changing the editor.
Rename supports current and inactive projects. Trash can restore/export and keeps
every revision, head and snapshot hash. Late appends to trashed projects reject.
Opening an existing project reuses its saved head without appending a restoration
iteration. Close is ×; phone menus are bounded and dismiss on outside click.

Trash is project metadata, mirrored to the native history-inclusive archive.
Recovery retains it and prefers the canonical autosave over stale exported copies
of the same project. Mirrors share the close-time flush queue. Moving the current
project first switches to a new workspace. No permanent purge or expiry exists.

Verification: production build, 435 unit tests (one optional external oracle
skipped), 1,196-message German audit and all six SDKs installed/executed offline.
Sixteen Chromium/iPad WebKit code/parameter/project workflows passed, plus six
file-action workflows. The final eight project workflows were rerun after sync and
Open semantics changes: all pass. They cover complete history on duplicate/export,
active/inactive rename, partial multi-file import failures, current-model retention,
Trash/reload/restore with identical revisions, native folder recovery after IndexedDB
rebuild with a stale duplicate backup, and phone menu bounds/rename cancellation.
