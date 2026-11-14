# Brickwright CAD

A local 3D solid editor for designing parts, editing dimensions and building
models with code. Run it in a browser or as a native macOS/iPad app, or embed the
same editor and document model in another application.

**Status:** an early working CAD workbench. Geometry uses a mesh-solid kernel;
full constrained sketches and an exact surface/solid backend remain roadmap work.

![Brickwright CAD workbench](docs/images/workbench.png)

## Modeling

- Searchable shapes, practical part templates and editable generators for screws,
  threads, lettering and other parts. Name tags support rounded corners and bundled
  fonts; their text remains editable in Properties.
- Retained union, subtraction and intersection inputs. Edit source dimensions after
  combining parts, and drive dimensions or transforms with named, unit-aware formulas.
- Rectangle/circle sketches and retained extrusions on principal planes.
- Move, rotate and resize through handles or numbers. Optional on-canvas values
  update during dragging. Shift and the touch-friendly Fine option provide finer steps.
- A numbered workplane, snapping, selection outlines, model browser, view cube and
  perspective/orthographic views. New shapes start on the workplane.
- English and German interfaces, view colours, desktop menus, clipboard operations,
  project search and an About dialog with build details and offline licence texts.

See [parameters](docs/PARAMETERS.md), [code mode](docs/CODE-MODE.md) and the
[roadmap](docs/ROADMAP.md) for examples and current boundaries.

## Code and source interchange

**Code an object** provides editable source, parameter fields, geometry preview
and 34 original examples. Preview does not change the project or its history.
**File → Model source** links coding and manual modeling: GUI edits patch retained
source, and an accepted source edit becomes one undo/history step. The dock stays
open beside the canvas, preserves comments and can merge independent GUI changes
into a pending draft. Generated parts expose their recipes instead of construction
clutter. See [the shared source workflow](docs/UNIFIED-DESIGN-SOURCE.md).

The same modeling compiler is available through the core SDK and a headless MCP server.

The offline model library includes 132 source models with previews and retained
licence/provenance information, including CC0 geometric fixtures.

Bounded converters import supported OpenSCAD/JSCAD source, including lexical
modules, child geometry, profile text/offsets and bounded Minkowski operations and export native CAD
Script or evaluated OpenSCAD/JSCAD snapshots. Unsupported constructs produce
explicit diagnostics. Supported OpenSCAD modules, functions and local formulas
retain their scalar parameter dependencies. Importing source is not a promise of complete language
compatibility or preserved foreign parametric behavior.

```sh
npm run convert:code -- part.scad --to jscad --out part.jscad
npm run convert:code -- gear.js --to bcad --parameters '{"numTeeth":20}' --out gear.bcad
```

The `.bcad` converter output preserves separate outputs and flat colours where
available. File conversions also retain original source and conversion details in
a sidecar. See [coverage and converter APIs](docs/CODE-CONVERTERS.md) and
[MCP setup](docs/MCP.md).

## Projects and model library

Projects autosave locally. Editable `.bcad` files contain the model and its complete
saved iteration history. Restoring an older iteration preserves later work.
Projects supports multi-file import and per-project export, duplication, rename
and recoverable removal through Trash. Importing a backup creates a separate
project; exporting includes every saved iteration.
On macOS, Settings selects the project-library folder. Stored iterations are
separate from the bounded editing undo stack; portable history archives currently
have a 64 MiB limit.

Import STL meshes and export STL or 3MF for printing. Mesh exports do not contain
the editable feature graph. 3MF currently exports geometry without materials.
Model-derived exports retain the applicable attribution/provenance sidecars.

The reviewed model library keeps original sources, hashes, licence evidence,
unit assumptions and qualification records. Browsing does not qualify a model;
source conversion, mesh screening and collision qualification are separate steps.
Research datasets are handled outside the application catalogue.

```sh
npm run verify:code-corpus
node scripts/check-code-corpus.mjs --library library --report /tmp/library-conversions.json
```

See [library documentation](library/README.md), [provenance](docs/MODEL-ATTRIBUTION.md)
and [source-research tools](docs/SOURCE-RESEARCH.md).

## Navigation

Default controls over the modeling canvas:

| Action | Control |
| --- | --- |
| Zoom | Trackpad pinch, wheel/two-finger scroll, or `+` / `−` |
| Pan | `Shift`-scroll, middle drag, `Shift`-right drag, or `Space`-left drag |
| Orbit | Right drag, empty-space drag, or `Alt`-scroll |
| Frame selection | `F` |
| Frame all | `Shift`-`F` or `Home` |
| Select / move / rotate / scale | `V` / `W` / `E` / `R` |
| Return to selection | `Esc` |

Settings offers alternate camera mappings. Use the view cube for principal views.
Touch uses two fingers to zoom and pan. View changes do not create model iterations.

## Run locally

Requires Node **22.18+** and npm.

```sh
npm ci
npm run build
npm run preview
```

Open http://127.0.0.1:4317/. For development, run `npm run dev`; after changing a
workspace package, rebuild it with `npm run build:packages`, or run `npx tsc -b --watch`.
The production browser app can work offline after its service worker installs.

### Native hosts

macOS requires Xcode command-line tools:

```sh
npm run mac:build
npm run mac:run
```

The installer gracefully refreshes `~/Applications/Brickwright CAD.app` and retains
project data. See [macOS](docs/MACOS.md) and [iPad](docs/IPAD.md) for native build,
verification, pairing and signing instructions.

## Reusable packages

| Package | Responsibility |
| --- | --- |
| `@brickwright/cad-core` | Versioned documents, parameters, source conversion, commands and undo |
| `@brickwright/cad-geometry` | Headless solid evaluation, mesh import/export and library insertion |
| `@brickwright/cad-editor` | Embeddable editor, renderer and geometry worker |
| `@brickwright/cad-history` | Append-only revisions, ancestry and portable archives |
| `@brickwright/cad-physics` | Qualified collision shapes, mass/inertia and headless Jolt simulation |
| `@brickwright/cad-brickwright` | Host project sidecar, coordinates and part-mesh integration |

Hosts inject file access and persistence. Editor instances own their mount targets
and dispose their resources independently. The physics SDK is available separately;
the standalone workbench does not yet have a simulation tab. See
[integration](docs/INTEGRATION.md), [physics](docs/PHYSICS.md) and
[contributing](CONTRIBUTING.md).

## Verification

```sh
npm run check
npm run verify:packages
```

Browser tests use Playwright Chromium and WebKit (`npx playwright install chromium webkit`).
Verification runs locally. GitHub Actions remains disabled while this repository
is private; see [local checks](docs/CI.md).

## Licensing and data

Original code is [BSD-3-Clause](LICENSE). Runtime components include Three.js (MIT),
Manifold (Apache-2.0), Acorn (MIT) and the optional Brickwright Jolt fork (MIT).
[Third-party notices](THIRD-PARTY-NOTICES.md) identify the bundled components.
Model content has its own per-asset grants and attribution requirements.

Models stay on your device unless you export or share them. Keep portable backups:
local autosave is not an off-device backup.
