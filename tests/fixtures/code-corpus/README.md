# Small converter bring-up corpus

Nine pinned upstream fixtures, not a model library. The VPS agent owns larger
collection work. Each manifest record identifies the exact source revision/path,
SHA-256 and content licence; full licence texts are adjacent. Original author
headers are retained. Sources are MIT JSCAD and BSD-2-Clause BOSL2 only. No
OpenSCAD GPL or ImplicitCAD AGPL implementation or examples have been included.

Run `node scripts/check-code-corpus.mjs`. Six fixtures currently convert and pass
Manifold evaluation; three stop at known features (slice extrusion or includes).
The runner reports these separately and fails unexpected changes/hash mismatches.
See ../../../docs/CODE-CONVERTERS.md from the repository root for the CLI, SDK and
MCP handoff contract (direct path: docs/CODE-CONVERTERS.md).
