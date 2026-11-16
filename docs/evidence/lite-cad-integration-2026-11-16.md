# CAD source integration for Lite — 2026-11-16

## Saved source checkpoint

The integration branch `feat/lite-cad-integration-20261116` combines:

- Current CAD main `57d63940175a3585c691d58f9db2c30a2dd25a5d`, including merged PRs #67 and #68.
- Helios branch `abb65b419ec8f03443a476584393d2023c861d18`, which already contains Cyclone `c5469f610d019a52fe2a5a1408fb680b90dd4a18` and the Mantis clearance correction `939460091e8968a081c6eeb5f133461d535e43d9`.

Source merge commit: `adac88f945d654bbf0af62ffee049d5380782362`.
Its tree is `d43ea2935e45b8023ab5796842aadf83cecf487f`. Both source histories are parents of that commit.

This is an integration checkpoint awaiting local combined qualification. It does not advance Lite's installed SDK pin.

## Preservation verification

GitHub Git tree objects were compared directly, without changing archived evidence.

| Check | Result |
| --- | --- |
| Main tracked files | 2943 |
| Merged tracked files | 2949 |
| Main paths removed | 0 |
| Existing file contents changed | 1: `packages/editor/src/shapes.ts` |
| Added files | 6: three model implementations and their three tests |
| Preserved library files | 2245 of 2245, exact Git blob and mode identity |
| Other main source and evidence | Exact Git blob and mode identity |

The main `shapes.ts` file equals the common ancestor `5a560c23c47c4bd3d7dd9c7c6aa67b3c3d09337d` byte for byte. Taking the incoming registration file therefore preserves all current registrations and adds the Mantis, Cyclone and Helios models without a textual conflict. The six added paths retain their exact incoming object IDs. The machine-readable companion receipt records the changed and added object IDs.

The latest library cohorts, saved designs and historical qualification evidence are retained. The existing Kestrel deferral is retained: this merge does not add it back to the catalogue.

## Qualification boundary

The new models bring their existing structural, print-geometry, undo/redo and Jolt tests with them. Merely retaining those tests is not a new passing result.

Fresh local execution was blocked before a CAD dependency install or build could start: the shared executor ran out of disk space during the separate Lite dependency installation, and its sandbox bootstrap then refused new processes, including bounded cleanup. No new CAD test, browser pass or SDK build is claimed for this merge. The branch was saved through the authorized GitHub connector; no GitHub Actions run was requested or awaited.

The Mantis physical test exercises simultaneous hip/roll motor actuation. It does not by itself qualify the sequential program emitted by Lite's project packager. Cyclone's test exercises both sliders and a sweeper; Helios's test exercises aiming, gate motion and payload displacement. The generated Lite programs need their own end-to-end validation before they are described as physically qualified.

## Local continuation commands

On a checkout of the exact branch with available disk space:

```sh
npm ci
npm run build:packages
npx vitest run tests/mantis-walker.test.ts tests/cyclone-sorter.test.ts tests/helios-catapult.test.ts tests/atlas-forklift.test.ts tests/tt-rover-physics.test.ts tests/actuator-impulse.test.ts tests/simulation-telemetry-controller.test.ts tests/simulation-telemetry-worker.test.ts --maxWorkers=1
npm run build:brickwright-sdk
```

Before advancing Lite, inspect `dist/brickwright-sdk/manifest.json`: it must name the exact committed CAD source, report a clean tree, and retain matching digests for every packaged file. Use Lite's established integration/pin command and verify its SDK digests after production processing. Do not reuse one of the older model-branch SDK bundles: those bundles precede the current library cohorts.
