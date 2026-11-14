# Offline source corpus tooling

`scripts/source-corpus.py` imports an explicitly reviewed list of existing staged
files. It uses Python's standard library, performs no network requests, and never
executes, imports, compiles, or renders the archived CAD sources. No runtime
dependency, package installation, build integration, or cloud workflow is added.

Run from the repository root:

```sh
python3 scripts/source-corpus.py ingest
python3 scripts/source-corpus.py validate
python3 scripts/source-corpus.py report
python3 -m unittest discover -s scripts/tests -p 'test_source_corpus.py' -v
```

Defaults are `--config library/corpus-reviewed-sources.json`,
`--destination library/corpus`, and `--staging /mnt/storage`. The staging root is
resolved once because `/mnt/storage` is an environment-provided mount alias.
Symlinks inside the staged source paths and output paths are refused. Limits
default to `--max-file-bytes 2000000` and `--max-total-bytes 25000000`.

## Reviewed configuration, version 1

The top level has `schema_version: 1` and a `repositories` array. Every repository
requires these fields:

| Field | Meaning |
| --- | --- |
| `id` | Unique safe directory identifier; letters, digits, periods, hyphens, underscores |
| `url` | HTTPS GitHub or Codeberg repository URL |
| `commit` | Full lowercase 40-character commit identifier |
| `license` | Reviewed SPDX identifier or restricted `AND`/`OR` expression |
| `reviewed_by`, `reviewed_at` | Reviewer description and review date |
| `captured_at` | Original source capture date, separate from later review |
| `usage_notes` | Archival and qualification limitations, including incomplete dependencies |
| `license_evidence` | Objects containing retained `path`, `spdx`, `scope`, and review `note` |
| `files` | Explicit retained file list; no recursive source selection |
| `skipped_files` | Optional objects with exact excluded `path` and `reason` |

Each file requires `path` (the original repository-relative path), `kind`
(`source`, `license`, or `readme`), `spdx`, `author_attribution`,
`license_evidence`, `sha256`, `size_bytes`, and `staged_path` relative to the
staging root. Source files must have `.scad` or `.js` extensions. Every repository
must contain a source unless its `role` is `license-evidence`, allowing a pinned
auxiliary upstream license notice to be retained without copying its code.

Each license reference names an evidence path within its repository, or a
cross-repository reference such as `scad-utils-mit-notice:LICENSE`. Every evidence
file must itself be explicitly retained. Allowed identifiers are MIT,
Apache-2.0, BSD-2-Clause, BSD-3-Clause, 0BSD, CC0-1.0, CC-BY-3.0, and CC-BY-4.0.
Expressions may combine these identifiers using ` AND ` or ` OR `; arbitrary
LicenseRef, copyleft, noncommercial, and share-alike grants are rejected.
Passing this structural check does not replace substantive license review.

Additional reviewed metadata, such as inline attribution notes and
`dependency_blockers`, is preserved. Dependency blockers describe absent or
withheld dependencies; retaining a caller does not grant permission to copy the
excluded dependency or assert that the caller can render independently.

## Retained output and verification

Files are copied byte-for-byte into `library/corpus/repos/<id>/<original-path>`.
Git attributes disable line-ending conversion and whitespace checks only for
these archived originals; upstream whitespace is retained to preserve hashes.
The deterministic `manifest.json` records the configuration SHA-256, repository
commit and dates, per-file original source URL, exact byte size and SHA-256,
attribution, license evidence, and additional review notes. Local `staged_path`
values are omitted from the manifest. Every source receives
`render_status: "unqualified"`; archival inclusion asserts no successful render,
geometry validity, manufacturing suitability, quality, or physics result.
Each retained file also records its repository URL, commit, capture date, and
resolved evidence URLs directly; source entries record `openscad` or `jscad`
format. `report` validates first and emits JSON with per-library source/evidence
counts and byte sizes, totals, dependency-blocker counts, and precise skips.

Import first reads and verifies all reviewed staged bytes in a temporary staging
directory. A new corpus is published from a sibling temporary directory. An
additive update verifies the existing corpus and refuses to change or remove any
retained file bytes. New files use exclusive creation; the manifest is replaced
only after those copies succeed. A sibling `.corpus.ingest.lock` serializes
writers. An interrupted process can leave this lock; check that no importer is
running before removing a stale lock. A hard interruption during an additive
copy can also leave unmanifested files, which validation rejects for inspection.

`validate` needs only the reviewed configuration and retained corpus. It checks
every byte hash and size, regenerated metadata, evidence references, exact file
inventory, and symlink boundaries. It does not fetch upstream content. Any
modified bytes, missing evidence, or extra unreviewed file fails validation.
