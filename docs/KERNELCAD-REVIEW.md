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
| 27-part reference scorecard | `tests/reference-parts.test.ts` | All 27 parts rebuilt in CAD Script against the analytic volume, surface area and bbox. Planar parts match to 1e-6 (most exactly). Curved parts use 1024 segments and match within the inscribed-polygon error, 6.3e-6 relative; sphere, torus and the hull-of-spheres all-edge fillet are within 1.5e-4. The open-top shell (box minus box) and the top chamfer (hull of two boxes) are exact. |
| Editor "Check printability…" | File menu, macOS menu, `printability` host command | Runs in the geometry worker; settings are transient and add no history. Each body is screened as a separate part. |
| Gear meshes in Jolt and the Gear pair shape | `CadJoint.gearMesh`, `packages/physics/src/world.ts`, `packages/editor/src/gear-pair.ts` | Uses the fork's `GearMeshConstraint`; tooth contact alone was measured to be unreliable (see [PHYSICS.md](PHYSICS.md#gear-meshes)). The library Gear now uses the ported involute profile. |
| `.kcad.ts` → CAD Script converter | `packages/core/src/kcad-import.ts`, `scripts/convert-kcad.mjs` | Original bounded interpreter with a CC0/MIT licence gate; 93.6 % of the 2,402 catalog models convert (see [CODE-CONVERTERS.md](CODE-CONVERTERS.md#kernelcad-kcadts-models-2026-11-24)). Illustrative catalog geometry is not dimensionally verified hardware. |
| MCP review tools | `cad_inspect`, `cad_check_interference`, `cad_render` | Ideas from kernelCAD's inspection channels; implementation is original (Manifold intersections, software renderer). |
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
  or shell, and all three have exact or faceted CSG equivalents, so all 27 now run
  against Manifold (curved parts with a faceting tolerance). The SolidCraft case
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

1. Done: the reference parts run as CAD Script tests (see above). An exact
   backend should meet upstream's 1e-6 on the curved parts too.
2. Qualify an exact B-rep candidate (SMLib WASM, WASMLib, Solidcore) **standalone**
   behind a narrow interface in `experiments/`: primitives, booleans, fillet,
   tessellation, STEP out; licence audit of every shipped WASM binary.
3. Use the full scorecard as the acceptance gate for that backend.
4. Revisit a fork only if the candidate passes and kernelCAD's agent/DFM layers
   are still worth inheriting wholesale.

## Remaining backlog from the plan

- Planetary/ring-gear mechanism preset (the planetary showcase is a reasonable fixture).
- Sketch solver benchmark against the `dart_csp` integration in
  [CONSTRAINTS.md](CONSTRAINTS.md).
