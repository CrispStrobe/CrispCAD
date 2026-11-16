# Scout TT interrupted-turn completion

## Recovered work and latest history

The interrupted turn had already saved the complete electronics-carrier kit at
`ce3150ec592e70cb8f6b23ae7c3b6b16b42b8012`, beyond the last checkpoint quoted by the
user. Lite's final control-verifier corrections were also saved, at
`7b9e191691081e9b1b608a18674eb86c7f5d9e87`.

This continuation merges current CAD main
`850bfb93f21c6244028e0ba1b4174d1281859649` into the saved Scout work at
`124280ad7f30628bb4b0c642a4b21f52fd41cd7a`. Both parents are preserved. PR #63 adds
53 paths relative to the shared base, with no overlapping Scout changes. The
49-head CAD audit and current Lite/PR inventory are recorded in
[`scout-tt-continuation-history-2026-11-16.json`](scout-tt-continuation-history-2026-11-16.json).
Lite main `6e8f065c6798cc4bfa1261f5c9413e69c4cbf367` was already an ancestor of
the recovered Lite branch.

The circuit co-simulation PR #64 is a divergent development branch, not a
replacement for this carrier kit. Trident, Kestrel and Atlas experiments remain
intact on their own branches. No unqualified experiment was silently substituted
for Scout, and no source branch or saved project history was deleted.

## Corrected fabrication reference

Independent inspection of the pinned Adafruit PCB sources confirmed the carrier
coordinates and found one documentation error: Feather RP2040 Rev B uses two
2.50 mm plated USB-end drills and two 2.54 mm unplated far-end holes. Both DRV8833
mounting drills are 2.50 mm plated. The canonical guide and mechanical-reference
JSON now distinguish those values and require checking actual M2.5 screw fit.
The original historical test hashes remain explicitly historical in that JSON.

The printed geometry is unchanged. Its separate 2.8 mm through-bores, boss
positions, countersinks and mounting/tool clearances retain the qualified design.
The packaged build guide, manifest and deterministic ZIP were regenerated from
the corrected canonical guide. All assembly BCAD and STL bytes remain unchanged.

## Fresh local validation

The exact remote tree was recovered with all 2,771 paths and 2,590 unique blobs
checked against their Git identities. The actual remote Git commit and tree were
reconstructed and checked; no substitute commit or fabricated clean-status
receipt was used. `npm ci` installed the locked dependencies without changing the
lockfile. Node is v24.22.1.

| Check | Fresh result |
| --- | --- |
| `npm run build:packages` | Pass |
| `npm run build` | Pass; 40-file offline bundle; existing large-chunk advisory remains |
| Eleven focused CAD test files | 93 passed |
| `node scripts/check-i18n.mjs` | Pass; 1,744 German messages and 1,355 literal/template references |
| `node scripts/generate-tt-rover.mjs --write` then `--check` | 12 PLA robot pieces and eight unique screened STL designs, including the separate gauge; exact reproduction |
| `node scripts/generate-tt-rover-collisions.mjs --check` | Exact reproduction; unchanged 2% volume, 0.2 mm bounds and 4,096-hull gates |
| Full release-Jolt sequence using the actual shipped BCAD | Pass; source document remains unchanged |
| `git diff --check` | Pass |

The focused test files are `tt-rover`, `tt-rover-electronics`,
`tt-rover-clearance`, `tt-rover-physics`, `physics-fixed-assemblies`, `motor-ports`,
`simulation-base`, `history`, `model-library-expanded-ldraw`,
`model-library-expanded-batch001` and `model-library-expanded-batch002`, all under
`tests/` with the `.test.ts` suffix. Run them with `npx vitest run` and those exact
paths. The last three files cover the recently integrated library additions.

These checks ran on `124280a` with only the documented guide/reference correction,
its regenerated copies and new evidence files in the working tree. The clean
source commit containing those changes is the subsequent SDK build input; the
SDK's own manifest records its exact source SHA and clean status.

## Exact shipped-model result

The fresh detailed report is
[`scout-tt-final-physics-2026-11-16.json`](scout-tt-final-physics-2026-11-16.json).
It retains the actual BCAD file hash as well as the normalized document identity
`67441b5ca2443dcffb825e7fe67a7e0c1f3298fb8e617aefe07e87bca2d09f5c`.

| Measurement | Fresh result |
| --- | ---: |
| Editable bodies / rigid assemblies | 23 / 3 |
| Collision hulls | 4,017 / 4,096 |
| Forward displacement | 179.069770 mm |
| Reverse displacement | -184.996217 mm |
| Differential turn | 131.111217 degrees |
| Peak moving-hinge anchor error | 0.059759 mm / 0.25 mm |
| Peak conservative hinge drift bound | 0.130156 mm / 0.25 mm |
| Native simulation steps | 1,520 at 200 Hz |
| Simulated duration | 7.6 seconds |
| Drive torque setting | 0.02 Nm |

These geometric and motion results reproduce the saved carrier qualification.
Wall time is host/load dependent and is not a real-time guarantee.

## Lite handoff and limits

The clean CAD SDK is built using `npm run build:brickwright-sdk` and synced by
Lite's `scripts/sync-cad-sdk.mjs`. The companion Lite completion receipt records
the exact new pin, all runtime/notice hashes, generated static-copy checks,
focused host tests and verification of this kit's actual saved SB3.

Fresh Chromium startup again failed before page startup because the executor
denies its process-singleton socket. No browser pass is claimed. The standalone
production build above is fresh; the earlier full Lite GUI production build
remains historical. GitHub Actions were neither dispatched nor awaited, and the
new checkpoint commits use `[skip ci]`.

The seven structural designs and gauge remain original BSD-3-Clause PLA geometry;
the purchased-motor derivatives retain their MIT provenance. Hardware has not
been printed or assembled. PCB and battery bodies are clearance envelopes;
fasteners, wires, printer tolerances and the nominal 0.5 mm minimum mechanical
gaps still require the guide's physical fit checks. Lite A/B controls operate the
simulated joints. Physical motor transport, firmware and encoders remain separate
work. This continuation changes neither deployment nor repository visibility.
