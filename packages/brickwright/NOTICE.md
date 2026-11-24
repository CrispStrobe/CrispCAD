# Third-party notices

Original CrispCAD code: BSD-3-Clause, see LICENSE.

Reused independent arithmetic: Brickwright contributors, BSD-3-Clause.
`packages/editor/src/vendor/touch-gestures.js` and `transform-math.js` are copied
unmodified from CrispStrobe/brickwright-lite; exact source revision, paths and
hashes are in docs/brickwright-provenance.json. Their SPDX/copyright headers are
retained. These files have no imports from Scratch or the LEGO simulation.
The new solid model, worker, integration adapter and UI are independent code.
No Layerling code/assets/translations are included.

Runtime dependencies:
- Three.js 0.184.0, MIT, copyright Three.js authors. OrbitControls and
  TransformControls are from the same distribution/license.
- Manifold 3.5.4, Apache-2.0, copyright Manifold contributors. Its compiled WASM
  is used directly; OpenCascade, brepjs and LGPL CAD kernels are not dependencies.
  Manifold's upstream distribution includes third-party components such as
  Clipper2 (Boost Software License 1.0) and generated Emscripten runtime support
  (MIT / University of Illinois-NCSA). Preserve their upstream notices when
  redistributing a runtime build.
- fflate 0.8.3, MIT, copyright Arjun Barrett.
- Capacitor core/iOS 8.6.0, Filesystem 8.1.5 and Share 8.0.3, MIT, copyright
  Ionic/Capacitor contributors. These are dependencies of the standalone native
  host only, not of the reusable CAD packages.

Development/build dependencies retain their upstream licenses, including
TypeScript (Apache-2.0), Vite/Vitest (MIT), Playwright (Apache-2.0) and type
packages (MIT). package-lock.json pins the complete installed dependency graph.
The LEGO LDraw library and Brickwright example models are NOT bundled here.
