# kernelCAD review and first adoption — 2026-11-24

Reviewed source: [w1ne/kernelCAD-web](https://github.com/w1ne/kernelCAD-web) at
`964fa6cfe94ecf16c2c44b94770846ae23665d82`. kernelCAD is MIT; its trademark
policy requires forks to be renamed. Its default modeling path is replicad +
OpenCASCADE (LGPL-2.1 with exception), which remains outside our dependency policy
(see [PARAMETRIC-CAD-STRATEGY.md](PARAMETRIC-CAD-STRATEGY.md)).

## Implemented

| Adopted | Where | Notes |
| --- | --- | --- |
| Involute spur gears (`spurGear.ts`, `spurGearPairMath.ts`) | `packages/core/src/gears/` | Exposed as CAD Script `spurGear2d` and `internalSpurGear2d`; see [CODE-MODE.md](CODE-MODE.md). Tests prove an aligned 12/20 pair with 0.1 mm backlash has no overlap at `m(z1+z2)/2`, and that the same pair turned by half a tooth collides. |
| Mesh DFM (`meshBvh.ts`, `meshClosestPoint.ts`, `minWall.ts`, `fdmOrientation.ts`) | `packages/geometry/src/analysis/` | Wrapped by our own `checkPrintability` (welding, edge-manifold topology, settings, report) and the read-only MCP tool `cad_check_printability`; see [MCP.md](MCP.md). |
| Two OCCT-free upstream BVH tests | `tests/kernelcad-mesh-bvh*.test.ts` | Most upstream DFM tests build fixtures through OCCT and were not reusable; equivalent fixtures are generated with Manifold in `tests/printability.test.ts`. |

Headers and the MIT licence text are retained (THIRD-PARTY-NOTICES.md and the
package NOTICE files). No runtime dependency was added.

## Plan claims checked

Confirmed: the MIT licence and NOTICE; the four DFM modules and the gear modules
are plain TypeScript without OCCT imports; the SMLib lowerer imports the OCCT
backend, uses it as reference/fallback and round-trips results through STEP;
`@classcad/smlibwasm` 0.6.2 declares `MIT AND Apache-2.0 AND OFL-1.1`; 2,402
`.kcad.ts` catalog sources (2,177 declare `license: 'CC0-1.0'`), 80 authored part
scripts, and the cited docs exist.

Corrections:

- `mechanicalTransmission.ts` is **not** kernel-independent: it depends on
  kernelCAD's assembly capture, mate solver, pose envelopes and runtime meshes.
  `fastenerIsoDims.ts` depends on their thread tables. Treat these as design
  references, not ports.
- `fdmOrientation` needs face-tagged meshes; our adapter tags each triangle as its
  own face, so face references are absent from the report.
- The 27 reference parts are analytic volume/area/bbox expectations with
  kernelCAD-API sources at 1e-6 relative tolerance. Only three use fillet, chamfer
  or shell; the rest (boxes, holes, patterns, revolve, loft, sweep, booleans) can be
  rebuilt in CAD Script, but every source needs translation, and curved parts need
  a faceting tolerance (about 1e-3 relative) with Manifold. The SolidCraft case
  files are separate Apache-2.0 data; Solidcraft's UI and look remain excluded.
- The WASMLib/DadCAD timings are third-party claims, not reproduced here.
- Images and charts in the original plan were illustrative, not measurements.

## Fork recommendation: defer

The proposal to fork kernelCAD into a separate OCCT-free engine is not adopted
now. OCCT is woven through the kernel layer (153 files in the OCCT backend alone),
face/edge naming, export and validation; the only alternative backend is four
files that themselves rely on OCCT. A fork would also import an application
architecture this project deliberately keeps independent. It cannot be created
from this repository's tooling and needs an owner decision.

Recommended order instead:

1. Translate the 24 Manifold-reachable reference parts into CAD Script tests now;
   keep the three fillet/chamfer/shell parts for the exact backend.
2. Qualify an exact B-rep candidate (SMLib WASM, WASMLib, Solidcore) **standalone**
   behind a narrow interface in `experiments/`: primitives, booleans, fillet,
   tessellation, STEP out; licence audit of every shipped WASM binary.
3. Use the full scorecard as the acceptance gate for that backend.
4. Revisit a fork only if the candidate passes and kernelCAD's agent/DFM layers
   are still worth inheriting wholesale.

## Remaining backlog from the plan

- Editor "Check printability" action and overlay (uses `checkPrintability`).
- Gear presets and pair/planetary helpers in the generator UI; Jolt qualification
  of a gear train (the planetary showcase is a reasonable fixture).
- Bounded `.kcad.ts` → CAD Script conversion for CC0 catalog parts, with per-file
  licence and provenance records.
- `cad_inspect` / `cad_render` / interference review tools.
- Sketch solver benchmark against the `dart_csp` integration in
  [CONSTRAINTS.md](CONSTRAINTS.md).
