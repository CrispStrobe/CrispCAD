# Third-party notices

Original CrispCAD code: BSD-3-Clause, see LICENSE. `src/lower-cad-script.ts` and
`src/lower-document.ts` are original CrispCAD code (the CAD Script lowering moved here
from `experiments/exact-kernel` on 2026-11-25).

Runtime dependencies:
- `@brickwright/cad-core` 0.1.0 (this repository, BSD-3-Clause).
- `@crispcad/exact-kernel` 0.1.9 from the CrispCAD kernel lab
  (https://github.com/CrispStrobe/crispcad-kernel-lab, release `exact-kernel-v0.1.9`,
  tarball `crispcad-exact-kernel-0.1.9.tgz`, SHA-256
  ad1e6064eca59694d27b86770a1a92c850f269753627b4a629ce0ecf06faf710), declared
  `MIT AND Apache-2.0`, copyright CrispCAD contributors. It has no runtime dependencies.
  Its `dist/` prebundles:
  - smlibwasm 0.6.2 (`@classcad/smlibwasm`), MIT, copyright 2026 AWV Informatik AG,
    built from source by the kernel lab (smlibpy v0.6.2 with USD BRep, Emscripten
    6.0.12; the package's `BUILD-PROVENANCE.json` records the sources and the sha256 of
    every file, each identical to the npm release), not installed from npm, and without
    its default text font (the OFL Lato font module is replaced by an empty one);
  - `dist/smlibwasm.wasm`: SMLib and its SM_API wrapper from USD BRep, Apache-2.0,
    copyright 2020-2026 NVIDIA CORPORATION & AFFILIATES, with AWV's bindings (MIT). A few
    USD BRep files are compiled from copies modified by AWV Informatik AG to fix defects
    (listed in the smlibpy repository's third_party/patches/README.md);
  - the Emscripten runtime (MIT) and the Brotli static dictionary (MIT).

  No OpenCASCADE code is included; the "Open CASCADE Topology" strings inside the
  WebAssembly belong to smlibwasm's `.brep` file-format reader and writer. The package's
  `NOTICE`, `LICENSE` and `licenses/` (smlibwasm, Emscripten: MIT; USD BRep: Apache-2.0)
  must ship with any redistribution; the standalone app includes them in
  `cad-assets/notices.txt`.
