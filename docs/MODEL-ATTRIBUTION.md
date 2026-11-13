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
bytes without inspecting their file format. A future host export command must
generate the STL and sidecar from the same evaluated snapshot before presenting
an attributed export action. The MCP host now provides this binding (below).
The editor still has no attributed export action or catalogue insertion workflow.

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

The editor's existing single-file callback cannot guarantee paired delivery.
It therefore refuses both STL and 3MF export when printable geometry has recorded
library sources, including sources attached while geometry was pending. Save the
complete project and use the MCP STL action with explicit notes. Attributed 3MF
and paired browser/native download support remain pending. Plain STL/3MF and
project backup export retain their existing behavior.
