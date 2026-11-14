# Source converter research and syntax oracle

Research-only tooling is under scripts/research; source datasets and generated
reports stay outside this repository. Nothing here adds a Rust parser, upstream
renderer, research dataset or NC model to the shipped app.

## openscad-rs assessment

Reviewed fork: [timschmidt/openscad-rs](https://github.com/timschmidt/openscad-rs),
commit 7a4c0759174dd0bff9bb3b9002c409ff3044bd3a. MIT OR Apache-2.0. It parses a
broad OpenSCAD AST, including modules, functions, comprehensions and include/use
syntax, but does not evaluate expressions, resolve files or generate geometry.
It is useful as a separate syntax oracle, not as proof of correct conversion or
mesh evaluation. Its README reports 518/524 upstream corpus files parsing; that
full upstream corpus has not been vendored or run in this project.

Local evidence: its 40 library unit tests passed. Our independent development
harness builds and accepts the reviewed 19,631-byte CC0 threads demo, with an
initial warm mean around 0.56 ms over ten parses on this Mac. The 9-byte cube also
parses. These are native syntax timings, not WASM or geometry benchmarks.

The fork's Cargo.toml has a sibling path dependency on hyperreal in csgrs. The
bootstrap pins both repositories; the hyperreal pin is
1671894b4a896b091416503910e3720ecf233c82. A committed Cargo.lock pins the harness
closure. Metadata for the 88-package local tool graph reports permissive licence
expressions; GMP/rug is not in this build graph. This is a development build, not
a completed app/WASM dependency adoption audit. Rust 1.95+ is needed by hyperreal.

Do not use the upstream shell benchmark's headline throughput as proof: it joins
the upstream fixtures (including invalid files), while bench_file discards parse
errors and the comparison CLI does not check its return status. Our harness first
requires a successful parse and measures only successful repeated parses. Syntax,
conversion, process startup and geometry timings are distinct phases. Oracle
source spans use UTF-8 byte offsets; our JavaScript diagnostics use UTF-16 offsets.

```sh
node scripts/research/build-openscad-oracle.mjs --cache /tmp/brickwright-scad-oracle
```

The bootstrap does not initialize the upstream OpenSCAD submodule. Its binary
reads one JSON request on stdin: {"source":"cube(10);","repeat":10}. It reports
acceptance/errors and timing, with byte/numeric preflight guards. The caller uses
process timeouts. External source/binaries remain in the selected cache.

## Research-only Thingiverse sample

Source: [redcathode/thingiverse-openscad](https://huggingface.co/datasets/redcathode/thingiverse-openscad),
revision 2b4206aae3af7740100a2f0e979dd9cb66cd77f0. The card declares
CC-BY-NC-SA-4.0; individual rows retain their own licence labels. This use follows
the owner's explicit noncommercial research scope. No content rights are inferred
for the app or curated redistribution catalogue.

The pinned 26,460,876-byte Parquet contains 7,378 rows. Strict named-fence
extraction produced 7,929 files / 7,864 unique source hashes. One row had an
unrecognized/partial wrapper and was excluded. Multi-file rows are not
concatenated, and fakeprompt is ignored. Original row/file boundaries, author,
licence, dataset revision, raw-cell hash and extracted-source hash are retained.
Among unique files, the lexical census finds module definitions in 6,070,
conditionals in 4,387, loops in 4,335, and hull calls in 2,009. This makes
module/function scopes, value types and control flow higher priorities than more
primitive tiles. The one conversion failure is a missing scalar sin evaluator.
Five oracle rejections occur around empty/missing comma-separated elements or
arguments; the sixth is in comment syntax. These remain triage cases, not proof
that the original upstream models are invalid.

Parquet SHA-256: 5815a78f668abcb8ec1373e2bd49a468521ef732eee8e53104132f71373f8ef7.

Initial deterministic sample: 256 evenly-spaced unique extracted files, not a
random/model-weighted sample. openscad-rs accepted 250 and rejected six. The
converter produced five positive-volume solids; 248 files reached unsupported
features, two exceeded current limits and one conversion failed. Syntax acceptance
does not establish valid runtime geometry. The six oracle rejections have not
been declared invalid without a further independent check.

Successful native syntax parses in this sample had a warm median of ~84 µs and
p95 ~367 µs. These exploratory local timings are not an apples-to-apples speed
comparison with our translator or geometry engine.

```sh
python3 scripts/research/extract-thingiverse.py --parquet /external/train.parquet --revision DATASET_COMMIT --out /external/extracted.jsonl
node scripts/research/probe-corpus.mjs --input /external/extracted.jsonl --report /external/probe.json --oracle /tmp/brickwright-scad-oracle/target/release/brickwright-scad-syntax-oracle --limit 256 --geometry
```

Python/pyarrow is an external research prerequisite, not an app dependency. The
scripts refuse research-source/report outputs inside the application repository.
Reports retain provenance, syntax/conversion outcomes, lexical feature-presence
census, timing and geometry summaries, never generated models for app insertion.

## Existing reviewed library

The converter runner accepts the VPS library manifests directly:

```sh
node scripts/check-code-corpus.mjs --library library --report /tmp/reviewed-library.json
```

Current result: 36 conversions and two explicit gaps among 38 reviewed sources.
Those are 34 archived native examples, the CC0 cube, and the JSCAD gear; remaining
gaps are JSCAD extrudeFromSlices and OpenSCAD function/module semantics needed by
the CC0 threads demo. The runner only reads local archived files and verifies
hashes. This complements, rather than replaces, library provenance, mesh screening
and collision qualification. It makes no network fetches or source-requested IO.

### Symbolic-module converter follow-up

Replaying the same 256 deduplicated files after adding file-scope module expansion,
named vectors and degree math yields 8 positive-solid conversions (previously 5),
245 unsupported, 2 limited and 1 construction-validation failure. Every previously
converted file still converts. The remaining validation failure exceeds the native
cylinder tessellation range; a syntax oracle accepting it does not establish our
geometry support. Module child operators and short vectors are reported as explicit
unsupported features. Reports remain outside the repo at
`/tmp/brickwright-cad-research/thingiverse-openscad/probe-256-modules-final.json`.
The report records built converter artifact hashes, git state and oracle binary
hash. These figures are a bring-up sample, not a general compatibility score.
No dataset source has been copied into runtime assets or application fixtures.

### Function and local-binding follow-up

The same 256-file replay now yields 10 positive-solid conversions, 242 unsupported,
2 limited and 2 non-conversions reported as validation failures. All previous
successes remain successful. One validation case exceeds native tessellation
limits; the other is a declarations-only library with no solid to instantiate.
The final report is external:
`/tmp/brickwright-cad-research/thingiverse-openscad/probe-256-functions-final.json`.
It fingerprints the separate OpenSCAD importer as well as the core compiler,
interchange layer, JSCAD interpreter and parameter engine. These sources remain
research-only; the regression fixtures added to the application tests are original
small examples of the documented language behavior.

### Engine/control-flow follow-up

The same 256-file replay now yields **38 positive-solid conversions**, 210
unsupported, 5 limited and 3 failures. All ten earlier successes still convert.
Native loops/conditional branches retain scalar dependencies; tapered cylinders,
3D convex hulls and finer tessellation remove common engine gaps. Native budgets
now carry resource-limit codes rather than generic malformed-source errors.
One failure has a malformed vector also rejected by the syntax oracle; another
is declarations-only; the remaining case produces no printable solid.
The report and raw sources remain outside the repo at
`/tmp/brickwright-cad-research/thingiverse-openscad/probe-256-control-final.json`.
Positive geometry is not an independent OpenSCAD semantic-equivalence oracle.
Analytic volumes/bounds and the MIT JSCAD implementation independently check the
new taper/hull/empty export cases; a parameterized imported hull/taper/loop object
passes actual Jolt collision qualification and rejects stale certificates.

### Typed language and geometry expansion — 2026-11-14

The same 256 source hashes now produce 137 positive solids (previously 42),
74 unsupported, 29 limited, 15 failures and one process timeout. All previous
42 still convert. One prior volume changes because extrusion-scoped `$fn` now
correctly reaches its child circle; the other 41 agree within the recorded tolerance.
This does not establish independent upstream geometry equivalence.

The clean-source release probe uses a 15-second deadline and 256 MiB Node heap.
The historical baseline used five seconds and had no timeouts. A separate
five-second pre-merge replay produced 134 solids/four timeouts; intermediate runs
varied from 134 to 137. Timing variability and the changed deadline prevent a
speed comparison. The final report fingerprints core, geometry, font assets and
Manifold at source `143a3da98e8a0a0a7e65d9654c6b40a86e0eb092`.

Reproduce with `node scripts/research/probe-corpus.mjs --input /external/extracted.jsonl
--report /external/probe.json --limit 256 --geometry --timeout-ms 15000` (one line).
The full report remains external at
`/tmp/brickwright-cad-research/thingiverse-openscad/probe-256-release-2026-11-14.json`;
only aggregate evidence is committed in
`docs/evidence/import-engine-coverage-2026-11-14.json`. Research-only source and
geometry stay outside the shipped application. Independently reviewed MIT gallery
sources follow the separate provenance and reproducible-mesh admission process.
