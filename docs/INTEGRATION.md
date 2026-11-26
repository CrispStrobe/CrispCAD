# Integration contract, version 1

The editor package is the single UI implementation used by both hosts. Do not
copy its source into a Scratch overlay or fork it for the standalone app.
Package version 0.1.0 is an MVP; the document and adapter carry explicit schema
versions and tests. Public API changes require updating this contract and its
embedding/round-trip tests before consumers upgrade.

## Mounting

```ts
import { mountCadEditor } from '@brickwright/cad-editor';
import wasmURL from 'manifold-3d/manifold.wasm?url'; // example Vite asset handling

const editor = mountCadEditor(container, {
  document: hostDocument, // optional; a validated empty design is the default
  wasmURL,
  onDocumentChange(document, revision) {
    host.replaceCadDocument(document, revision);
    host.markProjectDirty();
  },
  onSelectionChange(ids) { host.selectionChanged(ids); },
  onExport(file) { return host.saveFile(file.name, file.bytes, file.mime); },
  requestOpen() { return host.pickCadOrSTLFile(); }, // {name,bytes} or null
  requestNew() { return host.confirmNewDesign(); },
  onError(error) { host.reportError(error); },
});
await editor.whenIdle();
// Before the host unmounts or replaces this pane:
editor.dispose();
```

Give `container` a definite height. The editor uses a ShadowRoot so its CSS
cannot leak into Scratch or inherit its button/layout rules. WebGL 2 and module
workers are required. It creates no page-wide keyboard, storage, Scratch VM or
Tauri listeners. Shortcuts are scoped to focus within this editor. Text inputs
retain normal text editing shortcuts. Pointer gestures and ResizeObserver live
only as long as the mount. `dispose()` terminates the worker, removes listeners,
disconnects observation and frees the GPU resources/context.

A host can supply its own session via `session` to keep history when its pane
unmounts. In that case the host owns and eventually disposes the session. Without
a supplied session, the editor owns it. Multiple mounts should use different
sessions for independent histories; deliberate shared-session mounts share
document and selection by design.

### Host-created sessions and kernels

A session lists the kernels its host runs (`session.kernels`). Recorded commands
whose `context.kernel` names another kernel or version are refused on replay, and
an edit that commits kernel output (exact fillet, chamfer, shell and their
recompute) is accepted only by a session that declares that kernel. The editor's
geometry worker bundles the pinned exact kernel (lazily), so create the sessions
you pass to `mountCadEditor` with the editor's kernels:

```ts
import {createEditorSession, editorKernels, exactKernelIdentity, mountCadEditor} from '@brickwright/cad-editor';
// Browser SDK (sdk.js): the same exports; its createCadSession is createEditorSession.

const session = createEditorSession(hostDocument);        // declares editorKernels
mountCadEditor(container, {session, wasmURL});
// session.kernels -> [{id:'smlib', package:'@crispcad/exact-kernel', version:'0.1.0'}]

createEditorSession(doc, {kernels: [...editorKernels, myKernel]}); // add a host kernel
createEditorSession(doc, {kernels: []});                           // declare none
createCadSession(doc, {kernels: [exactKernelIdentity]});           // core, explicit
```

| Export | Meaning |
| --- | --- |
| `exactKernelIdentity` | Pinned exact kernel `{id:'smlib', package:'@crispcad/exact-kernel', version}`; importing it loads no WebAssembly. Same object as `@brickwright/cad-exact/identity`. |
| `editorKernels` | Frozen list of kernels the editor's default worker runs (currently the exact kernel). |
| `createEditorSession(document?, {kernels?})` | `createCadSession` with `kernels` defaulting to `editorKernels`. |
| `providesKernel(kernels, kernel)` | True when `kernels` declares exactly that id, package and version. |

Defaults, decided for replay safety: declaring a kernel claims the host really
runs that version. `@brickwright/cad-core`'s `createCadSession` (and the
`createCadSession` re-exported by `@brickwright/cad-editor`) declares nothing,
since a headless host may not ship the kernel. The browser SDK always ships the
exact kernel's chunks and WebAssembly under `assets/exact/`, so its
`createCadSession` is `createEditorSession`: existing hosts that call
`sdk.createCadSession(doc)` declare it without code changes; pass `kernels` to
choose otherwise. `mountCadEditor` never adds kernels to a session the host
passes (a session's kernels are fixed at creation and the host may replay its
records elsewhere, or supply a `createWorker` without the exact kernel). With a
host session that does not declare it, the editor refuses Fillet, chamfer, shell
and Recompute exact up front ("This editor session does not declare the exact
kernel…") instead of running the kernel first; STEP export and `measure exact`
commit nothing and still work.

The exact kernel runs in its own lazily created worker (a second instance of the geometry
worker script), so a slow fillet never blocks the editor; cancelling, the 60 s budget and
disposal terminate only that worker. `exactFallback` (a `mountCadEditor` option, an
`ExactCommandHost`) is for hosts where that worker cannot start: no `Worker`, a constructor
that throws, or a worker script that fails before it ever answered. Requests then run through
it, typically
`{run: (r, s) => import('@brickwright/cad-exact').then(m => m.createInThreadExactHost().run(r, s))}`,
which runs the kernel on the page's thread and blocks the UI while it works (see the
measurements in [experiments/exact-kernel](../experiments/exact-kernel/README.md)); a
running in-thread request cannot be interrupted, so an abort only discards its result. Without
the option such requests fail with the worker's error. The browser SDK does not set it: its
host-loaded chunks must not reference the kernel (see below).

### Limits for heavy exact jobs (2026-11-26)

`mountCadEditor` takes `exactLimits` (`Partial<ExactLimits>`; the SDK and
`@brickwright/cad-editor` export `EXACT_LIMITS_TABLET`, `EXACT_LIMITS_DESKTOP` and
`resolveExactLimits`; importing them loads nothing under `assets/exact/`). Missing fields come
from `EXACT_LIMITS_TABLET`, which is meant to be safe on an iPad, so a host that passes nothing
gets those. Fields:

| Field | Tablet | Desktop | What it does |
| --- | ---: | ---: | --- |
| `maxFeatureEdges` | 400 (≈ 100 curved) | 1000 | Fillet/chamfer: refused before the kernel runs when the selected edges, counted with each curved edge as `CURVED_EDGE_WEIGHT` (4) straight ones, exceed it. |
| `maxShellFaces` | 160 | 500 | Shell: refused when the body has more faces. |
| `maxMemoryBytes` | 512 MiB | 2 GiB | Ceiling for the exact worker's WebAssembly memory (written into the module's memory maximum when it loads). A job that needs more fails with "ran out of memory". |
| `recycleAboveBytes` | 192 MiB | 512 MiB | After a job that left the kernel's memory above this, the worker is ended (its memory returns to the page) and the next job starts a new one. |
| `requestTimeoutMs` | 60 s | 120 s | The whole request, first load included; then the worker is ended. |

Refusals, the memory ceiling, the timeout and Cancel all end in a translated message, and none of
them changes the model or its history: exact output is committed only after the kernel answered.
A worker whose kernel reported memory exhaustion or a WebAssembly trap is ended and queued
requests rerun in a new one. While an exact job runs, the status bar shows what it is, for how
long, and a Cancel button (`client.exactActivity`/`onExactActivity` in the geometry client); the
Fillet, chamfer, shell dialog has its own Cancel. The standalone app uses the desktop limits in the
macOS app and on computers without touch, and the tablet limits elsewhere (`?exact-limits=` overrides
it). `createInThreadExactHost({limits})` applies the same pre-flight to the in-thread fallback (no
memory ceiling there: the kernel shares the page's thread and process).


File export is deliberately host-owned; if `onExport` is absent the export
buttons are disabled. The default Open button uses a scoped HTML file input;
`requestOpen` replaces it with the host's native picker. `openFile(name, bytes)`
validates and builds the imported document before replacing live state.
`editor.session.load(doc)` is the synchronous API for already trusted/validated
host documents; the subsequent worker may still report a geometric error.

`onDocumentChange` receives an immutable snapshot after document edits, undo,
redo and load. Selection changes do not mark the project dirty. The host must
serialize/queue asynchronous writes by revision and retain errors, rather than
letting an old write replace a newer project. Session/document changes are
immediately observable; `whenIdle()` additionally waits for current geometry.
Persist `editor.session.serialize()` or `serializeDocument(document)`, never
renderer objects, worker state, or a displayed mesh as the editable project.

## Document and units

The core snapshot is UTF-8 JSON, `format: brickwright-cad`, `units: mm`.
Standalone Save project wraps it in a `brickwright-cad-history` archive, using the
same `.bcad` extension, with all saved iterations and shared assets. Legacy bare
snapshots and `.bcadhistory` archives remain readable. Hosts can supply
`saveProject` and `decodeProject` adapters; `session.serialize()` remains a snapshot. Version 1 is the
direct document; version 2 adds optional named parameters and formula bindings.
Both are supported. Old version-1-only hosts reject version 2 rather than silently
discarding design intent. See [PARAMETERS.md](PARAMETERS.md) for schema/API behavior.
The coordinates are right-handed and Z-up. Primitives are centred at their local
origin. Each node applies positive scale, fixed-axis X/Y/Z rotations in degrees,
then translation. Boolean nodes retain ordered input IDs and apply their own
transform to the evaluated result. Child transforms are relative to that result's
parent operation. The standalone adds a new primitive with Z at half its height.

Future schema versions, dangling references, cycles, non-finite numbers,
invalid dimensions and oversized inputs are refused. No automatic downgrade or
mesh conversion silently discards editable data. Documents have at most 2000
nodes and 100 levels, with a 16 MiB snapshot JSON limit. Editing undo retains up
to 100 snapshots per session; the separate saved revision journal has no automatic
retention count or expiry. Portable full-history archives have a 64 MiB limit. Meshes are capped separately to bound evaluation input.

## Brickwright project lifecycle

Use `@brickwright/cad-brickwright` after the existing bundle writer, and before
the existing loader replaces project state:

```ts
import { attachCadProject, extractCadProject } from '@brickwright/cad-brickwright';

// Save: the existing Brickwright writer produces the complete SB3 first.
const complete = new Uint8Array(await existingProjectBlob.arrayBuffer());
const output = attachCadProject(complete, editor.session.state.document);

// Load: validate this before committing either host or editor state.
const cadDocument = extractCadProject(incomingBytes); // null for legacy projects
// Commit only after the host has validated its other sections as well.
editor.session.load(cadDocument ?? createDocument());
```

The attachment is `brickwright/cad.json`. It leaves project.json,
brickwright/state.json (including simLab), costumes, sounds and unknown entries
unchanged as uncompressed bytes. It does not increment or reinterpret the
existing `brickwright-state` schema. Passing null removes only the CAD sidecar.
The adapter limits compressed input to 64 MiB and expanded data to 128 MiB.

**A future Brickwright integration patch is still required.** Its project writer
must attach the sidecar on every save/autosave; its loader must extract it and
clear stale CAD state on a legacy project load. Older unmodified Scratch or
Brickwright hosts may drop the sidecar when they regenerate an archive. The
embedding demo is a real consumer of the same package/API and exercises an SB3
round-trip. Brickwright's optional CAD workspace consumes the packaged SDK;
its availability depends on the host build flag and user workspace setting.

A React consumer should mount once in useEffect, keep the instance in a ref,
and call dispose in cleanup. Load host project replacements explicitly; do not
unmount/remount on every document-change callback. During early adoption, use
npm workspace/file dependencies. For independent releases, publish/pack these
four packages in dependency order and pin matching compatible versions.

## LEGO part handoff

LDraw uses 0.4 mm per LDU, with Y down. The adapter maps a LDraw position
`[x,y,z]` to CAD `[0.4*x,0.4*z,-0.4*y]`; rotation matrices use the matching
proper basis change. The inverse is tested. This is separate from Brickwright's
metre/Y-up render frame, so never feed CAD millimetres directly to its renderer.

`toBrickwrightPart(bodyMesh)` returns a centred, self-authored LDraw triangle
part, its original placement, mesh arrays and `requiresPhysicsMetadata: true`.
It provides no invented connectors, mass model, colliders or device behavior.
A future host integration registers this as owned geometry, retains the CAD
source, and separately authors those fields before treating it as a simulated
mechanism. The curated official-LDraw pipeline and its CC BY credits stay intact.
The generated part does not assign a new license to user geometry. The host must
retain the owner’s license/attribution for imported models and user assets.

## Optional history and simulation providers

The standalone host now uses `@brickwright/cad-history` for immutable model
iterations. Hosts can implement its structural API over their project/native
storage. The editor still owns neither autosave nor a global model library.
`editor.frame()` fits restored/imported work without changing its history.

`@brickwright/cad-physics` provides source-verified convex compounds, SI mass and
inertia, and headless Jolt worlds. The shared editor exposes the Simulate panel
and `editor.simulation`; see PHYSICS.md for the boundary. Rigid-preview
qualification does not supply gear/belt/spring/thread mates or
material deformation. Keep simulation state separate from design revisions.

Core IDs and hashes also support native/custom-scheme hosts without randomUUID
or WebCrypto, using getRandomValues for RFC 4122 v4 IDs and MIT @noble/hashes for
the identical SHA-256 fallback. WebCrypto remains the preferred hash provider.

Offline package verification packs the exact installed runtime dependency closure,
including the pinned GitHub Jolt release, and installs the SDKs into an independent
host with an **empty npm cache** using only local tarballs. Unused Manifold GLTF /
esbuild tooling peers are excluded with --legacy-peer-deps. Geometry and real Jolt
stepping are exercised; the public physics package still pins the qualified URL.

The standalone macOS host mirrors full project histories to a user-selected folder
and flushes before quitting. File updates must retain every existing revision ID
and snapshot hash; divergent or damaged files are refused, never silently replaced.
The reusable history provider can recover a missing native journal with
`importArchive(bytes, {preserveIdentity:true})`; this refuses an existing project.
Ordinary portable imports continue to create a separate model.

## Shared commands and clipboard

Hosts can call `editor.executeCommand(command)` using the exported `CadCommand`
type and observe `editor.commandState` / `onCommandStateChange`. This is the
same operation path used by native menus, so a host never needs to discover
private shadow-DOM buttons or send synthetic shortcuts. App-specific actions
such as Projects, About and Settings remain host responsibilities.

Supply `requestOpen`, `requestImport`, `readClipboard` and `writeClipboard` for
native panels/clipboard access. The browser fallback uses its file chooser and
Clipboard API. `editor.importFile(name, bytes)` adds a validated STL fragment;
`editor.openFile` replaces the workspace only after import preflight succeeds.

`session.fragment(ids)` returns a complete selected-body document with only
required formula dependencies and joints whose two bodies are both copied.
`session.insert(fragment, offset, {mergeParameters:true, label:'Paste objects'})`
remaps identities and merges namespaces in one undoable transaction. Duplicate
keeps links to existing model parameters; paste captures its own parameter values
and renames collisions. Both retain generator recipes. Native document Edit
commands defer to the system text responder when editing a field.

## Retained parametric features

Document version 3 adds analytic sketches and versioned extrusion definitions.
All hosts must retain the complete document (including `sketches`) in editable
sidecars and revision storage. Never replace these definitions with the evaluated
mesh when saving. Hosts on an older core must reject version 3 explicitly.

The exported core session APIs, derived dependency graph, semantic reference
contract, expression rules and simulation invalidation boundary are specified in
[PARAMETRIC-MODEL.md](PARAMETRIC-MODEL.md). The editor command `sketch` opens the
same definition UI as the Sketch button; native hosts route it like `parameters`.


## Live transform view state

`showTransformReadout` sets the initial on-canvas parameter preference;
`onTransformReadoutChange(visible)` lets the host persist it. The editor also
exposes `setTransformReadoutVisible`, `transformReadoutVisible` and the `readout`
command. The standalone host keeps the preference outside model/history storage;
the native View menu routes the same command. Pointer preview poses update the
inspector and optional readout without changing the session. A successful drag
commits on release, while cancellation restores the committed values.

`createDesignTemplate` in the headless core creates retained L-bracket, mounting
plate and spacer definitions. Insert these with parameter namespace merging,
using the same rules as clipboard paste. UI category changes do not remove
factory IDs or change imported models.

## Retained code features and headless transport

`defaultCodeProgram()` creates a language-v1 `CodeProgram`; `compileCode(program)`
returns typed construction IR plus local parameter definitions/values. Use
`session.addCode(program, name)` and `session.updateCode(id, program)` to retain
source in document v4. Preflight a trial document with the geometry kernel before
committing an application edit. Geometry/collision keys include source/overrides;
never reuse collision qualification after changing them. Scope stays local to the
coded body; global bindings can still drive its node transforms.

The history package exports `readPortableHistory(bytes)` and
`appendPortableRevision(previousBytes, document, label, parentId?)` for hosts without
IndexedDB. They validate full archive integrity and retain prior revisions/content.
They do not acquire filesystem locks; each host must provide its own safe writer.
The MCP host is an example of a separate headless file writer, not a connection to
a mounted editor. See [MCP setup and limitations](MCP.md).

For recorded printable library sources, editor STL export requires explicit
modification notes and invokes `onExport` once with `application/zip`, containing
the STL and its attribution JSON. Programmatic callers use
`editor.export('stl', modificationNotes)`. Attributed 3MF is refused. Hosts must
save/share this ZIP intact; plain mesh and project export contracts are unchanged.
See [attribution export](MODEL-ATTRIBUTION.md) for snapshot and cancellation behavior.

`ModelLibrarySourceBundle` version 1 also accepts `brickwright-ldraw-bundle` for
archival DAT roots and dependencies; `ModelLibraryAsset.conversion.sourceUnits`
accepts `ldu`. These are retained provenance metadata, not an executable DAT
import API. Hosts must preserve the complete source bundle, per-file identities,
licence grants and nominal conversion when saving, restoring or exporting
attribution. Unknown bundle formats remain invalid. Existing file-count, aggregate
byte, path, hash and licence guards apply to both supported bundle formats.

The model-library panel can insert an STL from its supplied `localFiles` map.
It snapshots the bytes and uses the same `insertModelLibrarySTL` checks as a
downloaded STL: exact size/SHA-256, curated quality policy, fresh mesh topology
and atomic provenance/history insertion. A mismatched local file must leave the
project and history unchanged. `tests/model-library-ldraw.test.ts` covers saved
document restoration and attribution round trips; the Chromium/iPad-WebKit
embedding tests in `tests/browser/model-library-ldraw.spec.ts` cover offline
insertion, retained provenance, undo/redo and mismatched-byte refusal.

## Recoverable project removal

The history store adds optional `ModelProject.trashedAt` metadata; documents and
revision contents remain unchanged. `listProjects()` returns active projects;
`listProjects({trashedOnly:true})` returns Trash and `includeTrashed:true` includes
both. `setProjectTrashed(id, true/false)` is serialized with journal writes and
changes no revision IDs, heads or snapshot hashes. Appending to a trashed project
is refused, including late autosaves. Hosts should flush and switch away from an
active design before moving it to Trash.

History-inclusive exports carry the marker. Native folder recovery imports with
`preserveIdentity:true` and retains it. Ordinary backup import creates a new active
project with remapped IDs and the full original revision history. No IndexedDB
schema migration, history pruning or permanent removal was introduced.

Native recovery prefers the canonical `<project-id>.bcad` autosave over exported
copies with the same identity. Import/rename/duplicate/trash mirrors share the
serialized file queue and are included in the host's close-time flush.


## Keeping standalone and Brickwright synchronized

The shared editor, geometry worker and simulation worker live in this repository.
Brickwright hosts the built SDK; do not copy simulation/editor implementations
into its host adapter. Its robot-specific mechanics retain their own coordinates
and devices. Shared interaction arithmetic is pinned in the reverse direction.

After committing CAD changes, build and pin the exact source checkpoint:

```sh
npm run build:brickwright-sdk
# In the Brickwright worktree:
node scripts/sync-cad-sdk.mjs /path/to/brickwright-cad
# Back in CAD, verify both directions and the common Jolt release/integrity:
npm run verify:brickwright-sync -- /path/to/brickwright
```

The check refuses a stale SDK, mismatched file hashes, changed shared interaction
arithmetic, or different Jolt producer/lock pins. Updating a pin is explicit;
verification never overwrites either checkout. Run Brickwright's SDK/VM checks
after pinning, and commit its SDK files with the host changes. A CAD release is
not automatically installed in an already built Brickwright app.

**Exact kernel in the SDK (2026-11-25).** The editor now depends on
`@brickwright/cad-exact`, which pins the kernel lab's `@crispcad/exact-kernel` release
tarball. The SDK build (`vite.brickwright.config.ts`) emits the exact chunks and the
`smlibwasm-<hash>.wasm` file (9,430,902 bytes) under `assets/exact/` as lazy worker assets; the
chunk fetches it by a URL relative to itself, so an SDK served from a sub-path works. Nothing under
`assets/exact/` is requested until a host user runs an exact command (`export step`,
`measure exact`, the export dialog's STEP option, Fillet/chamfer/shell or Recompute exact).
Measured on the build of 2026-11-25: `assets/exact/` holds 11.0 MB in seven files (the 9.4 MB
WebAssembly, 1.42 MB and 0.11 MB kernel chunks, four small files); nothing of it at load time.
Vite's library mode inlines `new URL('*.wasm', import.meta.url)` assets as base64 whatever
`assetsInlineLimit` says, and SDK builds up to 912d6f4 carried the WebAssembly twice as base64
(26.7 MB under `assets/exact/`, no `.wasm` file). The worker build now marks those references
`?no-inline` (`emitWasmFiles` in `scripts/exact-kernel-assets.js`), which also emits Manifold's
and the STEP tessellator's WebAssembly as files instead of base64 in the geometry, simulation
and STEP-import workers: the SDK without previews went from 64.0 MB to 47.2 MB.
`scripts/package-brickwright-sdk.mjs` fails if any SDK chunk contains a `data:application/wasm`
URL or a base64 WebAssembly run of 64 KiB or more, if `assets/exact/` lacks exactly one
`smlibwasm-*.wasm` referenced by an exact chunk, or if a host-loaded top-level chunk names it. A host that ships the SDK must also ship the
kernel's notices (they are part of the SDK's `NOTICE.txt`). Recorded commands with
`context.kernel` replay only where the same kernel version is provided: sessions the editor
creates declare the pinned exact kernel; a host that passes its own `session` creates it with
`createEditorSession` (or the SDK's `createCadSession`, which declares the bundled kernel), see
[Host-created sessions and kernels](#host-created-sessions-and-kernels), or such records are
refused with a clear message.

**Document version 43: smooth lofts (2026-11-26).** CAD Script's new `smoothLoft` builds the
smooth surface through three or more sections that kernelCAD's default loft and the exact
kernel build ([CODE-MODE.md](CODE-MODE.md#smooth-lofts)). Only documents that hold a program
calling it are version 43; it is the same in both program revisions and changes no saved
geometry. BrickWright needs no code change: syncing the SDK is enough, and until then its
vendored SDK refuses version 43 documents ("unsupported format, version or units") instead of
failing on the unknown function. The SB3 bundle keeps `brickwright/cad.json` byte for byte.

**Document version 42: ruled lofts (CAD Script revision 2, 2026-11-26).** A code program's
`version` may now be 2, which builds `loft` side quads between turned sections as ruled
surfaces ([CODE-MODE.md](CODE-MODE.md#language-revisions)). Only documents that hold such a
program are version 42: programs without a `loft` call are stored as revision 1, and saved
revision-1 lofts keep their triangulated geometry until the user chooses **Upgrade lofts to
ruled surfaces**. BrickWright needs no code change: syncing the SDK is enough, and until then its
vendored SDK (which accepts versions up to 40) refuses version 42 documents instead of building
their lofts along the old diagonal. The SB3 bundle keeps `brickwright/cad.json` byte for byte
whatever its version. Hosts that create code programs themselves can keep writing
`version: 1`; new lofts are then triangulated only if the host adds a new code object with a
loft at revision 1 (use `CAD_SCRIPT_REVISION` for new content).

**Document version 41: exact fillet, chamfer and shell (2026-11-25).** The SDK built from this
repository reads and writes version 41, which adds the `exact-feature` node
([PARAMETRIC-MODEL.md](PARAMETRIC-MODEL.md#document-versions)). A document reaches version 41
only when a user adds an exact feature; every other document keeps its version. The node stores
the exact kernel's display mesh, so a host evaluates, simulates, prints and drafts it with
Manifold alone: no exact kernel is loaded until a user creates or recomputes one. An
out-of-date mesh is the evaluation error `stale-exact`; the embedded editor recomputes it after
the user's own edit, as one step labelled "Recompute exact features" recorded with
`context.kernel`.

**BrickWright must sync this SDK before CrispCAD-saved version 41 files reach it.** The SB3
bundle keeps `brickwright/cad.json` byte for byte whatever its version (checked by
`npm run verify:brickwright`, which now also round-trips a version 41 document through the real
BrickWright writer and loader), but an editor built on an older SDK refuses to open it
("unsupported format, version or units"). Projects without exact features are unaffected.
`npm run verify:brickwright-sync` reports the BrickWright SDK as stale ("Vendored SDK differs")
until BrickWright runs `scripts/sync-cad-sdk.mjs` against this build; that is the expected state
between the two releases. On a scratch clone of brickwright-lite synced to this build it passes
(Jolt pins, shared interaction sources and the pinned SDK). `npm run build:brickwright-sdk` had
been failing since the exact kernel entered the geometry worker (SMLib's top-level await under
the SDK's ES2020 target); worker chunks may now use it, and packaging checks that `sdk.js` and
every host-parsed chunk still parse as ES2020. A host that passes its own `session` must declare the exact kernel
(`createEditorSession(document)`, the SDK's `createCadSession(document)`, or
`kernels:[exactKernelIdentity]`), or creating and recomputing exact features is refused with
"This editor session does not declare the exact kernel". SDK builds up to 912d6f4 did not export
the identity, so BrickWright's own CAD tab session could not declare it ("This session does not
provide the smlib kernel"); syncing a later SDK fixes it without host changes.

Full SDK preview/control behavior: [motor programs](CAD-MOTOR-PROGRAMS.md) and
[simulation coverage](SIMLAB-PARITY.md). The standalone owns its project library;
Brickwright owns its SB3 persistence and VM controls. Both retain the full versioned
CAD document, including motors, joints, world settings and trace attachments.

The browser SDK supplies the reviewed offline model catalogue by default. Its
sources, thumbnails and licence texts load lazily when Model library first opens;
standalone uses the same `apps/shared` catalogue builder. A host can override
`modelLibrary`, including a `load()` provider, without forking the browser panel.
The Adafruit original archive remains separate from reviewed editable sources.
STL insertion is an in-app action; downloading an original is an optional source
export and does not insert unsupported STEP/Fusion files.

Pass `colorMode: 'light' | 'dark'` to `mountCadEditor`, and call
`editor.setColorMode(mode)` when the host preference changes. This updates UI
surfaces without remounting the editor or changing document history. Explicit
viewport background/baseplate colours are preserved. Simulation has a persistent
header close control and `editor.simulation.close()` for host-controlled dismissal.
