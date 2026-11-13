# Attribution sidecars

The core `createModelAttributionSidecar(document, output)` function builds a
version 1 `brickwright-model-attribution` JSON manifest from validated v5 project
provenance and caller-supplied STL bytes. It does not change the document, saved
iterations or plain STL import/export behavior. No new dependency is required.

Pass `filename`, `format: 'stl'`, `bytes` and explicit `modificationNotes` describing
changes since insertion, including when unchanged. Optional `rootIds` selects
distinct printable document roots; the default includes all printable roots.
The caller must export exactly those roots from the same document, in millimetres.
Write `JSON.stringify(sidecar, null, 2)` alongside the STL, conventionally as
`part.stl.attribution.json`, and distribute both files together.

The manifest records the exact export byte count and SHA-256, project identity
and SHA-256 of UTF-8 `serializeDocument(document)`, selected roots, reachable node
source references, and full retained source records. Boolean operands contribute
their sources, including subtraction tools. Reference roots and unselected roots
are excluded. Asset attribution, exact content licence, evidence, pinned source
revision, file hashes, unit conversion and insertion changes remain in the source
records. Export changes are recorded separately.

`scope: 'recorded-library-provenance'` covers the sources actually recorded in the
project. An export with no reachable source record or malformed/incomplete
metadata is refused. The function cannot discover an unrecorded external source.

`geometryBinding: 'caller-supplied-export'` explicitly identifies the integration
boundary. Hashes identify bytes; they do not establish that supplied bytes were
generated from the stated document or roots. This helper does not parse STL,
evaluate geometry, verify legal grants or qualify physics. It accepts supplied
bytes without inspecting their file format. A host export command must
generate the STL and sidecar from the same evaluated snapshot before presenting
an attributed export action. The MCP host and editor now provide this binding (below). Catalogue insertion
remains a separate pending workflow.

The stored metadata preserves curation evidence; it is not a substitute for
shipping licence texts or notices required by a particular content grant.

## Automatic MCP export

`cad_export_stl` snapshots the validated current document before geometry worker
IO. It exports all printable roots and automatically detects their recorded
sources, including boolean operands. Reference-only sources and legacy opaque
fields do not trigger attribution. Plain exports retain the existing single-file
`{name, mime, base64}` response.

For recorded sources, supply an accurate `modificationNotes` argument describing
changes since insertion, explicitly stating when unchanged. Missing or blank
notes are refused; the host does not invent a change narrative. The tool returns
one `{format: 'brickwright-attributed-stl', version: 1, files: [...]}` response
containing `coded-project.stl` and `coded-project.stl.attribution.json`, both as
base64 files with names and MIME types. The sidecar hashes the exact returned STL
bytes and the same document snapshot evaluated by the worker. Concurrent edits
can advance the live project without changing this captured export.

Distribute both files together and retain separately required licence texts and
notices. The pair has a combined 3 MiB payload limit before base64 encoding; an
oversized pair or failed sidecar returns an error without partial files. MCP
returns both files together but cannot control whether a downstream client saves
or distributes both. It performs no project or history edits.

## Browser and native editor export

For printable geometry with recorded sources, File → Export requires accurate
**Changes since insertion** notes, explicitly stating when unchanged. STL export
produces one `design.stl.zip` containing `design.stl` and
`design.stl.attribution.json`. Extract and distribute both files together; retain
any licence texts or notices required separately by the content grant. The ZIP
keeps the pair in one browser download, macOS save, or iOS share action. A host
cannot control whether recipients later discard a member or separately required
notices. The uncompressed pair and final ZIP each have a 64 MiB limit.

The editor captures a validated document and its revision before waiting for
geometry. It refuses delivery if the model changes, the editor is disposed, or
the export dialog is canceled before delivery. Geometry and sidecar use the same
captured snapshot and exact STL bytes. Canceling the native save/share remains
host-owned; a canceled macOS save reports cancellation and leaves the notes
dialog open. The model and history are unchanged by exporting or cancellation.

Attributed 3MF remains refused. Plain STL/3MF, reference-only sources, and project
backups retain their existing behavior. The reusable editor's existing
`onExport(CadFile)` receives a single `application/zip` file for attributed STL;
programmatic `editor.export('stl', modificationNotes)` also requires explicit
notes. `prepareMeshExport` is an internal editor helper; geometry SDK callers of
`exportAttributedSTL(document, bodies, filename, modificationNotes)` must supply
all printable bodies evaluated from that same document. The low-level helper
cannot independently establish that binding.
