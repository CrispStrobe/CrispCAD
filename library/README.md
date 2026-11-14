# Reviewed editable source seed

This small collection preserves three unmodified parametric source assets. Content
rights are separate from Brickwright's BSD-3-Clause implementation licence. The
catalogue preserves archival input; the standalone library now additionally
admits the supported gear as an offline evaluated snapshot (see below). It does
not register built-in shapes or install an upstream renderer. These files are not Brickwright CAD Script and must not be passed to its
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

During the archival capture, no files were executed and no meshes were produced. `derivatives` is empty and
`quality` is absent: syntax, manifoldness, triangle count, physical suitability,
and collision behaviour have not been qualified. The SCAD file includes its
upstream `Demo()` call and uses built-in language features without `include` or
`use` dependencies. It is a modelling library/demo, not an OpenSCAD compiler
implementation.

Both JSCAD sources require `@jscad/modeling`. This collection does not install that
package or audit its runtime dependency closure. Running an upstream renderer would first require
a pinned, audited runtime dependency closure and isolated, resource-limited
conversion service. The independently implemented bounded AST translator does
not load or execute that package. The gear's parameter defaults are declared by upstream's
`getParameterDefinitions`; invoking `main` requires those values. No arbitrary JavaScript execution, package download, or OpenSCAD renderer is
enabled here.

The JSCAD models do not explicitly declare physical units. The catalogue records
an explicit curator assumption of millimetres and Z up; the archival seed has no
pre-rendered derivative. The SCAD file explicitly annotates millimetres. Identity transforms
record the intended interpretation for conversion, not measured mesh results. Future derivatives must record renderer/version, parameters, unit
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


## Supported offline gear snapshot

The standalone Model library admits only `jscad-involute-gear` from this seed.
Its `original` keeps the immutable upstream download URL; `editableSource` records
an exact hash/size-matched local copy at `sources/jscad/gear.js`. The exact original remains in the repository and build bundle. No source or evidence
archive is rewritten. The panel links to upstream; no source-download action is offered.

Insertion uses Brickwright's bounded, independent AST interpreter, with no upstream
JSCAD runtime execution or new runtime dependency. The default parameters are
recorded in incorporation notes. The inserted code is editable CAD Script geometry
with evaluated numeric values: the original JavaScript parameter definitions are
not editable project parameters. The panel explains this limitation. The original
remains archived separately for subsequent source edits; it is not embedded in the
project document.

Complete applicable original JSCAD MIT copyright, permission and warranty wording
is retained in the projected catalogue attribution, saved provenance, and exported
attribution sidecars; line breaks are explicitly normalized to spaces to satisfy
the existing single-line metadata contract. This notice identifies the original
JSCAD work; it does not claim those authors made subsequent Brickwright changes.
Conversion notes and caller-supplied later export notes remain separate. The exact
original notice and file header remain archived without normalization.

Existing differential tests compare the pinned gear's volume and bounds with the
reference package for defaults and an alternative parameter set. Insertion performs
a trial kernel evaluation before one atomic edit and rejects unsupported source
features without changing the model or redo stack. Nuts and Bolts (slice extrusion)
and Metric Threads Demo remain archival and are deliberately absent from the
bundled insertion catalogue. No simplified substitutes or partial conversions are
admitted. No mesh screen, printability or physics qualification is claimed for the
inserted gear; a passing positive-volume trial is separate from those checks.

## Browser previews

All 117 host-bundled items have static PNG previews generated from their actual
bounded source conversion and evaluated solids. Previews are keyed by original
source SHA-256; the standalone host refuses a bundled item without its thumbnail.
They are presentation assets, not geometry/printability/physics qualification.
The original catalogue attribution and licences apply to model-derived previews.

Regenerate locally after building packages (requires the pinned Playwright Chromium
browser; set `PLAYWRIGHT_BROWSERS_PATH` when using an external browser cache):

```sh
npm run library:previews:generate
```

The reusable editor accepts host-provided `previews` and `licenceTexts` maps.
Thumbnail browsing performs no model downloads or project/history writes. Imported
external catalogues without a host-supplied preview show an explicit unavailable
placeholder; the editor does not invent an image or fetch their STL automatically.

## External corpus models available in the editor

The source archive contains **1,406** files. A reviewed subset of **78** is
independently dependency-complete (no external includes/assets) and **78** are
bundled for selection and insertion in File → Model library. These are separate
counts: the other 1,328 archived files have not been admitted for editor insertion.
422 archive records lack a recorded dependency blocker; that is not proof of
dependency completeness or renderability. The 984 recorded blockers remain.

The first twelve MIT selections from Angelo Nicoli's Asset Collection are
Beam Angular, Beam H,
Key Simple, Roll Holder, Angle Shelf, Sign 01, Sign 02, Washer, Transistor,
Stairs 01, Bookshelf 01 and Chalkboard 01. The byte-identical OpenSCAD originals
are in `sources/corpus-selection/`; exact upstream paths, commit, source hashes
and retained licence evidence are in `editor-corpus-manifest.json`. Full MIT
notice text travels with project provenance and attribution export.

The second batch adds Arrow 01, Base cabinet 01, Beam C, Bookshelf 02,
Box Wood 01, Chair 01, Door 01, Flange 01, Ladder 01, Sofa, Table 01 and
Vent Grid, using the same importer, loader, original-byte and notice checks.

The third batch adds Base cabinet 02, Bed 01, Bed 02, Bench 01, Bench 02,
Chair 02, Chair 03, Fireplace 01, Table 02, Table 03, Table Small 01 and
Window 01. These also use the existing runtime without source adaptations.

The fourth batch adds Building 01, Chalkboard 02, Cone 01, Crystal, Key,
Lamp 01, Lever Handle, Soda Cup 01, Stairs 02, Stairs 03, Traffic Light and
Tootbrush (the upstream spelling). Original bytes and notices are unchanged.

The fifth batch adds Electric Wire Plug, Flange 03, Resistor, Street 02,
Street 03, Street 06, Sword 01, Crossed cubes (upstream `x`), Banner 01,
Raccordo, Street 01 and Street 05. Scoped transform `$fn` and literal colour
defaults preserve child geometry; `#` highlighting preserves the rendered solid
and records omitted preview appearance. Original files remain unchanged.
These counts are source entries: Street 03 and Street 06 have identical derived
geometry and remain separate records for their distinct original files. The
78 selected source entries currently have 77 distinct derived STL hashes.

The sixth batch adds Street 04, Eyebolt, Ladder 02, Wall 04, Fence 01,
Fence 02, Building 02 and Walking Stick. Bounded local module declarations
retain lexical bindings and isolated module registries while caller `$fn`
remains dynamic. This batch qualifies eight sources, rather than assuming twelve.

The seventh batch adds Ingot 01, Coin 01, LED 01 and Sauce Bottle. Tagged
literal colour palettes support bounded nested palettes and literal integer
selection inside module scopes. Palettes can reach only validated `color()`;
numeric arrays, numeric geometry, functions and loops retain their separate
rules. Alias evaluation has a cumulative budget to bound branching expansion.
Original colour is omitted as before; original source bytes remain intact.

The eighth batch adds Pipe 00 and Flange 02 in an explicit full-render context
with readonly `$preview=false`. Numeric vector selection accepts literal-proven
module arguments/local aliases; computed/global/loop/function-derived indices
remain rejected. Pipe uses its authored 30-facet render branch; Flange uses its
64-facet outer branch and authored default `Size=0`, with a measured 200 mm
extent under the unchanged policy. No preview-dependent source text was edited.

The ninth batch adds Cup 01, Ring, Pipe 90 and Key Old 01. Brickwright interprets
their two-component built-in 3D translations as XY with zero Z; the authored
short vectors are all `[0,0]`. Conversion notes record that interpretation and
the existing full-render context, without claiming native-version parity.
Only the authored top-level/default models are qualified: Ring and Pipe 90
retain unused helpers with undefined calls, which are not certified helper APIs.
Original source bytes and notices remain intact.

Of the 1,328 archive sources outside this editor selection, 984 have recorded
dependency blockers and 344 have no recorded blocker but are not admitted for
editor use. Nine licence-quarantined staged sources remain outside the archive.
`Shaft_01.scad` and `Shaft_02_With_Keyway.scad` remain deferred because their
signed radial profiles are unsupported; these remain archival originals,
not additional licence quarantines.
`Wood_Crate.scad`, `Wall_01.scad`, `Wall_02.scad`, `Sign_03.scad`,
`Wall_03.scad`, `Flag_France.scad`, `Flag_Italy.scad` and `Floor_01.scad`
also remain outside the
editor selection: their converted meshes failed closed-solid topology checks.
These are geometry screening failures, separate from dependency or licence
exclusions; no repairs or source substitutions were applied.
`Notebook.scad` produced 16,406 triangles, exceeding this selection's unchanged
10,000-triangle policy. Abacus and Arc 01/02 still exceed the existing native
node budget. These recorded limits are preserved; helper-module support does
not qualify every source that can now parse.

Each selected model passes the existing bounded importer, Manifold evaluation,
and hash-bound STL screening for a closed positive-volume solid, at most 10,000
triangles and 200 mm extent. Coordinates are unchanged; millimetres and Z up are
explicit curator assumptions. Some upstream models are very small scene props;
insertion does not certify real-world dimensions or manufacturability. Constant
colour wrappers preserve geometry while appearance colours are omitted. Jolt
collision, printing and dimensional equivalence to the upstream renderer are
not qualified by these checks. The original editable source stays archived;
the editor inserts the independent translator's editable CAD Script conversion.

Reproduce just this subset using installed local runtimes:

```sh
npm run library:corpus:check
node scripts/generate-library-previews.mjs --corpus-only
```

The second command updates only the 78 selected thumbnails. Neither command
downloads assets or executes the upstream OpenSCAD application.

## Supported CC0 additions — 2026-11-14

The offline gallery now contains 117 editable-source models. The new
`supported-models-manifest.json` admits **Quarter cylinder**, **Square pyramid** and
**Nested open frames** from Ghostkeeper/SlicerTestModels at pinned revision
`e1bbc8eec047c2fb604b71f7e4793c3e0189fd6d`. Sources are unmodified, including
original byte identity. The repository's explicit CC0 model grant and complete
licence are retained alongside per-file author/commit evidence. Millimetres and
Z up are curator assumptions. These are geometric fixtures, not calibrated parts.

`node scripts/generate-supported-library.mjs --check` reproduces the manifests and
STLs offline, checks pinned source/licence hashes, screens closed positive-volume
meshes, and compares volumes with independent polygon geometry or rectangle-cell
integration. `--write` regenerates the same outputs. New source or grant identities
require a new review. `npm run library:previews:generate` renders actual evaluated
geometry for all 117 gallery entries. Browsing and insertion use bundled bytes;
research-only datasets and unsupported seeds are not gallery entries.

STL screening is separate from Jolt qualification. These models do not carry a
reusable physics certificate; simulation must qualify their actual regenerated
geometry through the existing collision pipeline.
