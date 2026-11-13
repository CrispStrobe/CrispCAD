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
an attributed export action. The current editor has no such action or catalogue
insertion workflow.

The stored metadata preserves curation evidence; it is not a substitute for
shipping licence texts or notices required by a particular content grant.
