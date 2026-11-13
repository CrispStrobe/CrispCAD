# Reviewed CC0 geometric fixture

One selected [10-unit cube](https://github.com/Ghostkeeper/SlicerTestModels/blob/e1bbc8eec047c2fb604b71f7e4793c3e0189fd6d/basic/cube.scad)
from Ghostkeeper's SlicerTestModels is retained as an editable geometric/slicer
fixture. The exact nine-byte OpenSCAD source is `cube(10);`. The pinned
[README model grant](https://github.com/Ghostkeeper/SlicerTestModels/blob/e1bbc8eec047c2fb604b71f7e4793c3e0189fd6d/README.md)
explicitly applies CC0 to all models; the complete README and CC0 legal code are
archived under `evidence/`. These are content rights, separate from Brickwright's
BSD implementation licence. Upstream explicitly excludes calibration from its
scope, so this fixture does not fulfil or claim a calibrated printer collection.

The [file-creation commit](https://api.github.com/repos/Ghostkeeper/SlicerTestModels/commits/b888c0a1da437803f6af7be17d584d3d27c1eaab)
identifies Ghostkeeper as the adding author on 2018-06-11. Selected factual commit
metadata is retained in `evidence/slicer-test-models-cube-author.json`; the complete
source and model-grant documents are pinned to revision
`e1bbc8eec047c2fb604b71f7e4793c3e0189fd6d`. Automated Codex review and capture:
2026-11-13. This is a curator assessment, not human legal approval. All requests
were read-only selected files staged in `/mnt/storage/brickwright-calibration-stage`.
No upstream application, UI, renderer implementation, external writes or bulk
mirror was used.

`fixtures-manifest.json` is a local collection manifest, format
`brickwright-local-fixture-library` version 1. It retains the exact original,
derivative and evidence hashes and sizes, upstream commit/file/evidence URLs,
author/date, renderer/toolchain identities and separate mesh screening. Local paths
are relative to `library/`. It is not a network catalogue and cannot be passed to
`fetchModelLibraryFile`; no immutable HTTPS URL has been published for the locally
generated derivative. No online availability, browser CORS, catalogue insertion,
physics qualification or history change is claimed.

Reproduction uses Brickwright's existing independent `importOpenSCAD` translator,
CAD Script compiler and locked Manifold geometry kernel. It never executes upstream
OpenSCAD or other GPL/AGPL implementations. The retained editable source remains
unchanged. No new runtime dependency is introduced. Source units are unspecified;
we explicitly assume millimetres and Z up. The uncentred `cube(10)` origin is
preserved: bounds [0,0,0] to [10,10,10], volume 1,000 cubic millimetres. No repair,
simplification or placement is applied. The generated STL contains 12 triangles.

Run locally:

```sh
npm run library:fixtures:generate  # intentionally write derivative and manifest
npm run library:fixtures:check    # regenerate in memory; compare exact outputs
npx vitest run tests/model-library-fixtures.test.ts
```

The generator checks pinned source/grant/author evidence before rendering and
records generator, lockfile and WASM hashes. Check mode performs no network IO and
writes no library files. It compares the derivative and manifest byte for byte.
A toolchain change requires deliberate regeneration and review. Focused tests
verify original bytes and grants, then independently check the expected corner
origin, 10 mm spans and 1,000 mm³ volume. Separate versioned screening passes all
four existing checks under explicit 100-triangle/10 mm limits; hard analysis budgets
are unchanged. This does not establish self-intersection freedom, printability,
printer calibration accuracy, mechanical fitness or collision qualification.

The desired external CC0 calibration collection remains pending. Two candidates
were not admitted during this review. Official 3DBenchy's current grant is CC0,
but the complete GitHub STL is 11,285,384 bytes / 225,706 triangles, exceeding our
83,333-triangle analysis budget, and its advertised editable CAD endpoint was
inaccessible. Innerscene's 20 mm XYZ cube passed geometry screening and its STL
header explicitly grants CC0, but its provider metadata `fileHash` disagreed with
the actual downloaded SHA-256. The meaning of that discrepancy could not be
verified from primary documentation. No conflicted cube bytes or catalogue record
are retained here. These exclusions do not change the quality checker or admit a
partial model as a complete calibration object.
