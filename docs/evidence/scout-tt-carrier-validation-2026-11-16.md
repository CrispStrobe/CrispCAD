# Scout TT carrier continuation — local validation

## Source and history

This continuation starts from requested CAD PR #60 at `629682c13d8cbc55b70cdbc283b3b1e6c60ae841` and Lite PR #1792 at `e10b5a586da28e5a68176c7989a0a17a3d278828`.
CAD main through merged PRs #61 and #62 (`1371532344e546f9b26b76b3f9ad25c90ede725d`) is retained as a merge parent of `c0ed44c70f58879c0b078535980293eb69593b6d`.
The 81-file main delta had no overlap against the common base. A fresh final main-head check found the same CAD main and Lite main `6e8f065c6798cc4bfa1261f5c9413e69c4cbf367`.

The complete 47-head CAD audit is retained in `scout-tt-history-reconciliation-2026-11-16.json`. Forty heads already belonged to Scout ancestry. New reviewed library work was integrated; Trident, Kestrel, Atlas and circuit co-simulation remain intact on their respective branches. The mechanical review records why the three other robot concepts are not offered as qualified print kits. Unrelated active Lite importer and Robot Lab lanes were inventoried rather than merged wholesale.

Remote checkpoints include CAD `c0ed44c` (history), `270900f` (explicit work in progress), and Lite `0f978c8` / `7b9e191` (control and compiled-project verification). All saves are non-forced branch updates. GitHub Actions was neither dispatched nor awaited.

## Manufactured model

The default Scout now has 12 PLA robot pieces, using seven unique structural designs plus one separate fit-gauge design: eight screened STL files. The new independent BSD-3-Clause electronics carrier supplies six through-bolt PCB bosses and four accessible, countersunk deck mounts. Its footprint is 61 × 56 mm and default height is 9 mm. The board underside has 6 mm nominal clearance above the carrier plate.

Adafruit motor derivatives retain their MIT notices. Feather RP2040 Rev B and DRV8833 board mounting dimensions were read from exact pinned fabrication sources; no PCB artwork or third-party mounting design was redistributed. Exact coordinates, fastener envelopes, source identities and failed development attempts are in `scout-tt-carrier-mechanics-2026-11-16.json` and the canonical build guide.

The exact mounting rows are X 25/39 and Y ±12.5 mm. Geometric probes cover bolt bores, countersinks, the real deck slots, nearby post washers, deck-post head envelopes, board-boss material and vertical tool access beside the PCB envelopes. The retained 15 mm boss-height edit verifies that bores stay open. Invalid parameter ranges fail without accepting a solid.

## Local checks

| Check | Result |
| --- | --- |
| `npm run build:packages` | Pass |
| `npm run build` | Pass; 40-file offline bundle; existing large-chunk advisory retained |
| Eight focused robot, carrier, clearance, physics, fixed-assembly, port, base and history test files | 45 passed |
| Two newly merged expanded LDraw library test files | 26 passed |
| `node scripts/check-i18n.mjs` | Pass: 1,744 messages and 1,355 literal/template references |
| Collision candidate generation and `--check` | Byte-identical reproduction; unchanged 2% / 0.2 mm / 4,096-piece gates |
| `node scripts/generate-tt-rover.mjs --write` then `--check` | 12 pieces / 8 unique STLs; exact reproduction |
| All eight exported manufacturing meshes | Parse, closed positive volume, size and triangle screens pass |
| Actual final source / serialized BCAD / release physics identity | Exact agreement: `67441b5ca2443dcffb825e7fe67a7e0c1f3298fb8e617aefe07e87bca2d09f5c` |

The generator and standalone carrier export retain editable CAD Script and separate purchased-component geometry from manufacturing exports. The inventory layout is wider than one printer bed; print the individual STL files in their listed quantities and orientations.

## Exact shipped-model Jolt run

The final compiled candidate JSON was compared structurally with its source before the release run. The generated BCAD and the model evaluated by the physics qualifier have the exact matching identity above. Earlier iterations and a stale emitted-candidate artifact were superseded before release; their performance values are not the final results below.

| Measurement | Final result |
| --- | ---: |
| Editable evaluated bodies | 23 |
| Rigid assemblies | 3 |
| Collision hulls | 4017 / 4,096 |
| Maximum live relative collision discrepancy | 1.077757% / 2% |
| Maximum live bounds error | 0.049516 mm / 0.2 mm |
| Forward displacement | 179.069770 mm |
| Reverse displacement | -184.996217 mm |
| Differential turn | 131.111217° |
| Peak moving-hinge anchor error | 0.059759 mm / 0.25 mm |
| Peak conservative moving-hinge drift bound | 0.130156 mm / 0.25 mm |
| Native steps | 1520 at 200 Hz |
| Simulated duration | 7.6 seconds |
| Drive torque setting | 0.02 Nm |
| Measured simulation wall time | 15.173 seconds |

The full numerical report is `evidence/tt-rover-physics.json`. Timing is host-dependent and is not a real-time guarantee. The source model is unchanged by simulation.

## Lite and practical limits

Lite checkpoint `7b9e191691081e9b1b608a18674eb86c7f5d9e87` passes 17 focused controls. Its checks require a free base, independent unrestricted A/B wheel hinges, aligned signed world axes and coincident world anchors. The saved SB3 verifier traverses the actual executable block graph and refuses changed commands, detached/extra blocks and executable monitors even when an attacker or editor refreshes the file hash. The final SDK pin and saved-project verification are recorded in the companion delivery receipt after the clean-source SDK build.

Chromium could not launch in this executor: its process-singleton socket was refused with `Operation not permitted`. The optional browser download also returned an invalid archive. No fresh browser or full Lite GUI-build pass is claimed. The new preview is an original depth-buffered CPU rendering of the actual evaluated solids, not a browser screenshot or photograph. Reproduce it with `node scripts/render-tt-rover-preview.mjs | python scripts/rasterize-tt-rover-preview.py`; NumPy and Pillow are developer preview tools only.

The hardware remains unprinted and unassembled. PCB and battery blocks are conservative clearance envelopes. Solder tails, real fasteners, print tolerance and tool/cable access require the guide's fit checks. A/B commands control simulated CAD joints; physical transport, firmware and encoders are not added by this continuation. No deployment, native installation, visibility change or workflow change is included.
