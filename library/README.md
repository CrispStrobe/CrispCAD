# Reviewed editable source seed

This small collection preserves three unmodified parametric source assets. Content
rights are separate from Brickwright's BSD-3-Clause implementation licence. The
catalogue is archival input; it does not register built-in shapes or install a
renderer. These files are not Brickwright CAD Script and must not be passed to its
compiler. No upstream application implementation, UI, or assets were copied.

`seed-catalogue.json` uses the core model library metadata schema. Each original
URL pins a full commit, and each byte count and SHA-256 identifies the exact file.
`seed-files.json` maps those URLs and the associated licence evidence to local
copies, including independent hashes and sizes for licence/package evidence.
Capture and per-file review date: 2026-11-13. The reviewer field identifies the
automated Codex audit, not an owner or human legal approval. External access was read-only;
individual downloads were staged under `/mnt/storage/brickwright-seed-stage`.

| Asset | Author | Content grant | Local original |
| --- | --- | --- | --- |
| Nuts and Bolts | platypii | MIT, explicit file header | `sources/jscad/nutsAndBolts.js` |
| Parametric Involute Gear | Joost Nieuwenhuijse; Simon Clark | MIT, explicit file header | `sources/jscad/gear.js` |
| Metric Threads Demo | Ryan A. Colyer | CC0-1.0, explicit file header | `sources/threads-scad/threads.scad` |

The JSCAD file headers identify both the authors and MIT grant. The pinned
`packages/examples/package.json` also explicitly licenses the examples package
MIT. The full upstream MIT notice is retained in `evidence/jscad-LICENSE.txt`:
copyright (c) 2017-2024 JSCAD Organization. Retain that notice and the original file
headers with redistributed copies. Its version and spelling are unmodified.
The SCAD source explicitly dedicates the work to the public domain under CC0;
the complete upstream legal code is retained in
`evidence/threads-scad-LICENSE.txt`. Credit is preserved even though CC0 does not
require attribution.

Evidence and source links, all pinned to the audited revision:

- [JSCAD MIT notice](https://github.com/jscad/OpenJSCAD.org/blob/720f3688312ed3bad1702fe83906be153b8ab8fc/LICENSE)
- [JSCAD examples package grant](https://github.com/jscad/OpenJSCAD.org/blob/720f3688312ed3bad1702fe83906be153b8ab8fc/packages/examples/package.json)
- [Nuts and Bolts file grant](https://github.com/jscad/OpenJSCAD.org/blob/720f3688312ed3bad1702fe83906be153b8ab8fc/packages/examples/core/extrusions/nutsAndBolts.js)
- [Gear file grant](https://github.com/jscad/OpenJSCAD.org/blob/720f3688312ed3bad1702fe83906be153b8ab8fc/packages/examples/parameters/gear.js)
- [Threads source grant](https://github.com/rcolyer/threads-scad/blob/4ae9aeb3b136f9858200f77a304b909a000ce3b4/threads.scad)
- [Threads CC0 legal code](https://github.com/rcolyer/threads-scad/blob/4ae9aeb3b136f9858200f77a304b909a000ce3b4/LICENSE.txt)

No files were executed and no meshes were produced. `derivatives` is empty and
`quality` is absent: syntax, manifoldness, triangle count, physical suitability,
and collision behaviour have not been qualified. The SCAD file includes its
upstream `Demo()` call and uses built-in language features without `include` or
`use` dependencies. It is a modelling library/demo, not an OpenSCAD compiler
implementation.

Both JSCAD sources require `@jscad/modeling`. This collection does not install that
package or audit its runtime dependency closure. Any future rendering must first
pin and audit that complete closure and run in an isolated, resource-limited
conversion service. The gear's parameter defaults are declared by upstream's
`getParameterDefinitions`; invoking `main` requires those values. No evaluator,
JavaScript execution, package download, or OpenSCAD renderer is enabled here.

The JSCAD models do not explicitly declare physical units. The catalogue records
an explicit curator assumption of millimetres and Z up; no conversion has been
performed. The SCAD file explicitly annotates millimetres. Identity transforms
record the intended interpretation for a future conversion, not measured mesh
results. Future derivatives must record renderer/version, parameters, unit
choices, output bytes/hashes, modification notes, and independent geometry checks.

The initial audit also inspected dotSCAD's root licence at revision
`bb33edfd75cba0edbb7971606a077b9c69d0b7d2`: it is
[LGPL-3.0](https://github.com/JustinSDK/dotSCAD/blob/bb33edfd75cba0edbb7971606a077b9c69d0b7d2/LICENSE),
so no dotSCAD source assets were admitted. No broad repository licence was used
to override a conflicting per-file licence. MCAD, NopSCADlib and BOSL2 assets
remain uncollected; this seed does not claim their dependency closures are audited.

A separate [reviewed CC0 geometric fixture](FIXTURES.md) retains a pinned editable
cube and independently screened local derivative. It is a slicer fixture; the
external calibration collection remains pending.
