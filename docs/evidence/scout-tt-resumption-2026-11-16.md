# Scout TT rover — continuation verification

Checked on 2026-11-16 with Node 24.22.1 and npm 11.9.0.

The interrupted conversation was recovered from the existing remote checkpoints.
The saved work was ahead of the visible transcript: the complete drive qualification,
print kit, private Lite project and clean SDK pin were already committed.
This continuation re-ran the relevant checks, clarified the electronics carrier
instructions, regenerated the print package, and prepared the changes for review.

## Source identities and scope

- CAD runtime and robot geometry tested: `0ee57d91be6f4f910f8b8d6106ba894b9b1a8d1d`.
- CAD working branch: `feat/printable-robot-20261115`.
- Documentation/package clarification: `ffcc8ae308329b41c1d01967923e27da56c585b5`.
- Lite runtime tested: `3ae00ea69a307d1eb8647bd514037c53da692901`.
- Lite continuation receipt: `e10b5a586da28e5a68176c7989a0a17a3d278828`.
- Lite integration: [draft PR 1792](https://github.com/CrispStrobe/brickwright-lite/pull/1792).
- The SDK remains pinned to clean CAD runtime `0ee57d91`; the subsequent CAD
  commits change documentation and evidence only.

The guide now distinguishes insulating board-carrier spacers from the four
printed deck posts. Raising the whole deck does not increase the clearance
between a board and that deck. The source guide, kit guide, file manifest and
ZIP were updated together. All CAD geometry, seven STL files, CAD Script
sources, assembled BCAD and saved Lite demo remain byte-identical to the
recovered checkpoint.

## Fresh local checks

| Check | Result |
| --- | --- |
| TypeScript package build | PASS |
| Focused CAD regressions | PASS: 43 tests in 8 files |
| Reproduction of the original print package | PASS: exact bytes |
| Reproduction after the guide clarification | PASS: exact bytes |
| STL generation and screening | PASS: all 7 unique parts; 11 manufactured robot pieces plus the calibration gauge |
| Complete release Jolt drive sequence | PASS |
| Standalone production build | PASS: Vite 9.50 s; 40-file offline bundle |
| Lite focused control/project checks | PASS: 13 tests in 5 files |
| Saved private Lite demo | PASS: exact BCAD, A/B joints, program, notices and 5 artifact identities |
| Lite source and emitted SDK | PASS: all 10 runtime/notice SHA-256 hashes |
| Lite production GUI build | PASS with serial minification; see the Lite receipt |

The focused CAD command was:

```sh
npx vitest run tests/tt-rover.test.ts tests/tt-rover-clearance.test.ts \
  tests/tt-rover-physics.test.ts tests/physics-fixed-assemblies.test.ts \
  tests/hinge-clearance.test.ts tests/simulation-base.test.ts \
  tests/history.test.ts tests/motor-ports.test.ts --maxWorkers=1
```

The other CAD checks were:

```sh
npm run build:packages
node scripts/generate-tt-rover.mjs --check
node scripts/qualify-tt-rover-physics.mjs --check
npm run build
```

The first print reproduction ran before any guide edit. After editing the source
guide, `node scripts/generate-tt-rover.mjs --write` regenerated the distribution,
and the second `--check` passed. The production build retained its normal
large-chunk warnings. This local verification build was not deployed.

The updated print kit is `examples/scout-tt-rover/scout-tt-rover-kit.zip`,
1,035,796 bytes, SHA-256
`f47fd6ec2b595bfe9ec017357f6c927e7fd6b74fcf99f1368d55c62d4d581d1a`.

## Fresh drive result

The release engine was `Jolt 1.1.0-bw.10 wasm-compat`, with 200 Hz stepping, a 0.02 Nm motor
torque limit and 180 degrees/second commands. The test settles the assembly,
drives forward, brakes, reverses, brakes again and turns.

| Measurement | Result |
| --- | ---: |
| Editable model bodies | 22 |
| Rigid assemblies in the solver | 3 |
| Collision hulls | 3738 / 4,096 budget |
| Forward travel | 179.510071 mm |
| Reverse travel | -186.870419 mm |
| Turn | 130.420225 degrees |
| Peak moving hinge anchor error | 0.060744829 mm |
| Native physics steps | 1520 |
| Simulated duration | 7.6 s |
| Geometry preparation | 8.927 s |
| World creation | 0.581 s |
| Simulation calculation | 14.903 s |

The motion measurements exactly reproduce the existing
[full qualification evidence](../../evidence/tt-rover-physics.json).
Execution times vary with host load; this is a correctness check, not a
real-time performance guarantee. The existing full report contains the
geometry certificates, conservative hinge drift bound and phase samples.
The fresh clearance regressions use the actual manufactured geometry, while
the separate [mechanical report](scout-tt-mechanical-clearance.json) preserves
the full 360-degree sampling and all-angle clearance reasoning.

## History reconciliation and the later steering experiment

A fresh comparison of all 42 CAD branch heads against recovered Scout head
`0ee57d91` found 40 ancestor branches, the Scout branch itself, and one
later divergent steering branch. The original integrations of
`codex/reviewed-bundle-namespace` and `codex/sync-brickwright-simlab`
remain in Scout history; no original branch or history revision was rewritten.

The later `feat/steerable-3d-robot-20261115` experiment is preserved separately:

- CAD: `c043b3fdfe65b61abdb2809718010d17289ae862`.
- Lite: `272d913eaf86d2b3e176363aa3097566e6523927`.

Its servo/fork torque-transfer and retention interface, tire groove placement,
and running clearances need further mechanical work and full motion qualification.
It also predates the later Scout cradle and physics fixes. It was not merged
into the qualified Scout deliverable.

## Limits and next physical step

- Browser smoke remains unverified. Chromium could not start because this
  executor denies its process-singleton socket; no browser pass is claimed.
- The fresh Lite default-worker build was killed at minification with exit 137.
  The successful retry preserved production webpack configuration and the same
  two-pass Terser options, with serial minification and a 4 GiB heap. Both
  outcomes are in the
  [Lite receipt](https://github.com/CrispStrobe/brickwright-lite/blob/e10b5a586da28e5a68176c7989a0a17a3d278828/docs/evidence/2026-11-16-scout-tt-cad-resumption.md).
- The hardware remains unprinted and untested. Mesh screening, nominal
  clearances and simulation do not establish actual shaft fit, printed
  strength, clamp retention or service life.
- The minimum nominal wheel-to-cradle gap is 0.5 mm. Fasteners, straps and
  wiring must remain inside the guide's stated envelopes and be checked through
  a full manual wheel revolution.
- Electronics and battery blocks are clearance envelopes. Measure the actual
  boards, headers, USB cable and insulated carrier.
- Lite controls the simulated A/B joints. Physical motor transport, firmware
  and encoders remain separate work.

The next physical step is the five-size double-D fit gauge, followed by one
cradle and wheel/hub check with the actual motors before printing the full kit.

GitHub Actions were not used or awaited. Repository visibility and native
installations were not changed.
