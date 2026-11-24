# Third-party notices

Original Brickwright CAD code: BSD-3-Clause, see LICENSE.

Reused independent arithmetic: Brickwright contributors, BSD-3-Clause.
`packages/editor/src/vendor/touch-gestures.js` and `transform-math.js` are copied
unmodified from CrispStrobe/brickwright-lite; exact source revision, paths and
hashes are in docs/brickwright-provenance.json. Their SPDX/copyright headers are
retained. These files have no imports from Scratch or the LEGO simulation.
The new solid model, worker, integration adapter and UI are independent code.
No Layerling code/assets/translations are included.

Adapted kernelCAD source (MIT):
- packages/core/src/gears/spurGear.ts and spurGearPairMath.ts
- packages/geometry/src/analysis/meshBvh.ts, meshClosestPoint.ts, minWall.ts and
  fdmOrientation.ts
- tests/kernelcad-mesh-bvh.test.ts and kernelcad-mesh-bvh-closest.test.ts
- experiments/constraints/sketch-compare/kcad/solver.ts and types.ts (benchmark only,
  unmodified, not part of any package or app bundle)
- tests/fixtures/kcad/*.kcad.ts are catalog models whose meta() declares CC0-1.0
  (see tests/fixtures/kcad/PROVENANCE.md)
are copied from w1ne/kernelCAD-web commit 964fa6cfe94ecf16c2c44b94770846ae23665d82
with their SPDX/copyright headers retained; each file states what was modified
(import paths, local types and, for spurGear.ts, a local error renderer). They do
not depend on OpenCASCADE, replicad or any kernelCAD runtime. The kernelCAD name is
not used for any Brickwright product (see upstream TRADEMARKS.md). Licence text:

MIT License

Copyright (c) 2026 Andrii Shylenko and kernelCAD contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

Runtime dependencies:

- dart_csp 2.4.0 (MIT) and the compiled Dart SDK runtime (BSD-3-Clause)
  run in the outline constraint worker. Complete notices are in the CAD
  editor package notice.

- oxideav-step 0.0.1 and oxideav-ifc 0.0.4, MIT, bundled in the lazy STEP
  tessellation WebAssembly module. Complete licenses are in the CAD editor notice.

- acad-ts 3.9.0, MIT, copyright Jochen Kühner and Albert Domenech. The
  JavaScript DWG codec runs on demand in a browser worker and declares no
  runtime package dependencies. See https://github.com/node-projects/acad-ts.
- Three.js 0.184.0, MIT, copyright Three.js authors. OrbitControls and
  TransformControls are from the same distribution/license.
- Manifold 3.5.4, Apache-2.0, copyright Manifold contributors. Its compiled WASM
  is used directly; OpenCascade, brepjs and LGPL CAD kernels are not dependencies.
  Manifold's upstream distribution includes third-party components such as
  Clipper2 (Boost Software License 1.0) and generated Emscripten runtime support
  (MIT / University of Illinois-NCSA). Preserve their upstream notices when
  redistributing a runtime build.
- fflate 0.8.3, MIT, copyright Arjun Barrett.
- qrcode-generator 2.0.4, MIT, copyright 2009 Kazuhiko Arase.
- Shared simulation physics package: Brickwright JoltPhysics.js 1.1.0-bw.10
  and Jolt Physics, MIT, copyright Jorrit Rouwe and contributors. The qualified
  fork release URL and integrity are pinned in package-lock.json. It is not
  currently bundled into the standalone editor UI.
- Persistent revision storage adds no runtime third-party dependencies.
  fake-indexeddb 6.2.8 (Apache-2.0) is a development test dependency only.
- Capacitor core/iOS 8.6.0, Filesystem 8.1.5 and Share 8.0.3, MIT, copyright
  Ionic/Capacitor contributors. These are dependencies of the standalone native
  host only, not of the reusable CAD packages.

Development/build dependencies retain their upstream licenses, including
TypeScript (Apache-2.0), Vite/Vitest (MIT), Playwright (Apache-2.0) and type
packages (MIT). package-lock.json pins the complete installed dependency graph.
Selected LDraw source content is bundled separately under CC-BY-4.0, not as a
runtime dependency: selected authored parts and their complete dependency closures.
The first Tile 3 x 6 is by Tore Eriksson, with the box5 primitive by
James Jessiman and the retained per-file history contributors. Exact originals,
attribution, source revision, full licence and conversion notes are retained in
library/ldraw-editor-manifest.json, library/ldraw-reviewed-batch-manifest.json and
library/evidence/ldraw-*.txt. Each batch dependency retains its own author/grant. No LDraw
renderer implementation or full parts library is bundled.

## QR generator license

Copyright (c) 2009 Kazuhiko Arase

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

## Jolt license

MIT License

Copyright (c) 2022-2024 Jorrit Rouwe

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.


## SHA-256 fallback

@noble/hashes 2.4.0 (MIT). Used when a native/custom-scheme host lacks WebCrypto.

The MIT License (MIT)

Copyright (c) 2022 Paul Miller (https://paulmillr.com)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the “Software”), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

## Selected Asset Collection models

Ninety-three OpenSCAD models and their derived meshes/previews are from Angelo Nicoli's
MIT-licensed OpenSCAD-Snippet at commit
`4f9e3d4d16b5e427186c1f89e10c2181c437dee6`. Original source paths and per-file
identities are retained in `library/editor-corpus-manifest.json`; the complete
copyright and permission notice is retained in
`library/evidence/corpus-selection-MIT-LICENSE.txt` and in exported model
attribution. The wider archived source corpus retains its individual notices
under `library/corpus/repos/` and per-file grants in `library/corpus/manifest.json`.

## Acorn JavaScript syntax parser

Acorn 8.17.0, MIT; https://github.com/acornjs/acorn. Used by the original bounded JSCAD converter. No submitted JavaScript is executed.

MIT License

Copyright (C) 2012-2022 by various contributors (see AUTHORS)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.


### A2D sample roots and shared source dependency — MIT

The two authored A2D sample roots and shared A2D.scad source are by Michal Altair
Valášek and contributors, pinned at `4ad48205fefd841a468b7916521596f09383add9`
from https://github.com/ridercz/A2D. Original headers and full MIT grant are
retained under `library/sources/a2d/` and
`library/evidence/a2d-MIT-LICENSE.txt`. Exact source/dependency identities and
reviewed grants are recorded in `library/a2d-editor-manifest.json` and carried
into insertion provenance and attribution exports. Their default-root geometry
qualification does not certify the remaining A2D helpers or samples.


### SCON model sources (MIT)

Five unchanged authored example roots and their shared `scon.scad` dependency
are retained from Warren MacEvoy's openscad-scon revision
`c954e07bf0faf571d8eccc259d47e61938666cef`. The exact full copyright, permission
and warranty notice is in `library/evidence/scon-MIT-LICENSE.txt`. Model sources
and derivatives carry the independently reviewed MIT grant and complete notice
in catalogue/project attribution. This is model content, not an added runtime
dependency. Source details and qualifications: `library/scon-editor-manifest.json`.
