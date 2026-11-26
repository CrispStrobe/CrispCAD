# Scout TT collision candidates

`tt-rover-collisions.json` contains convex candidate geometry for the Scout TT assembly. The source CodePrograms, printed STLs and vendor motor render meshes keep their full resolution. This file does not make its serialized certificates trusted: `prepareDocumentCollisions` compares each assembled compound with the current source mesh at every preparation, using the existing 2% combined volume and 0.2 mm bounds limits. An edited code program drops its supplied candidates and must prepare fresh geometry.

The original PLA parts and rubber-tire envelope candidates are BSD-3-Clause. The motor casing and shaft candidates derive from the same pinned MIT Adafruit 3777 motor source retained in the project provenance and `packages/editor/src/motor-assets/`; Adafruit's copyright and MIT notice remain in the assembled project and distributable kit.

Run from the repository root after building the packages:

```sh
node scripts/generate-tt-rover-collisions.mjs --write
npm run build:packages
node scripts/generate-tt-rover-collisions.mjs --check
```

`--check` compares solids, not bytes: every hull must keep exactly the same vertices and enclose the same volume (within 1e-6) with a closed triangulation, and each certificate must agree to 1e-6 (relative, or absolute in mm³). The same generator and sources once reproduced the file byte for byte (2026-11-16), but by 2026-11-26 Manifold triangulated the coplanar faces of 13 wheel and 2 tire hulls differently on the same points (another quad diagonal, the vertices unchanged, the hull volumes within 1e-7), and the certificates' difference volumes moved with them (by under 1e-6 mm³); the byte comparison then failed although nothing in the sources or the generator had changed. The file was regenerated then.

The generator preserves the clamp socket, slit, bolt bores and other manufacturing cuts. It uses fewer angular facets only for candidate collision geometry, decomposes the wheel into radial sectors and a cut hub, and simplifies the motor mesh by at most 0.05 mm (0.02 mm for its shaft) before decomposition. Every candidate set must pass independent current-source CSG comparison before this file is written. The total assembled scene must remain below the unchanged 4096-convex-piece budget. These checks establish simulation geometry suitability; they do not establish physical printing tolerance, material strength or a completed hardware prototype.
