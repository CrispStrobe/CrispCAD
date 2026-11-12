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

A host can supply a `createCadSession()` instance via `session` to keep history
when its pane unmounts. In that case the host owns and eventually disposes the
session. Without a supplied session, the editor owns it. Multiple mounts should
use different sessions for independent histories; deliberate shared-session
mounts share document and selection by design.

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

`.bcad` is UTF-8 JSON, `format: brickwright-cad`, `version: 1`, `units: mm`.
The coordinates are right-handed and Z-up. Primitives are centred at their local
origin. Each node applies positive scale, fixed-axis X/Y/Z rotations in degrees,
then translation. Boolean nodes retain ordered input IDs and apply their own
transform to the evaluated result. Child transforms are relative to that result's
parent operation. The standalone adds a new primitive with Z at half its height.

Future schema versions, dangling references, cycles, non-finite numbers,
invalid dimensions and oversized inputs are refused. No automatic downgrade or
mesh conversion silently discards editable data. Documents have at most 2000
nodes and 100 levels, with a 16 MiB JSON limit. History retains up to 100 document
snapshots per session. Meshes are capped separately to bound evaluation input.

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
round-trip; it is not a claim that the active Brickwright application is wired.

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
