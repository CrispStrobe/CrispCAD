# Brickwright CAD

A standalone 3D solid editor and the same editor as an embeddable BSD-3-Clause
package. It uses Manifold for mesh-solid operations and Three.js for rendering.
It does not depend on Layerling, Scratch, a backend, or a desktop wrapper.

```sh
npm ci
npm run build
npm run preview
```

Open http://127.0.0.1:4317/ for the standalone workbench, or
http://127.0.0.1:4317/embedded.html for the host integration demo. `npm run dev`
builds the library packages before starting Vite; after changing a package,
rerun `npm run build:packages` (or `npx tsc -b --watch` in another terminal).

For the native iPad host and Brickwright-keychain signing, see [docs/IPAD.md](docs/IPAD.md).

The delivered scope and exclusions are in [docs/SCOPE.md](docs/SCOPE.md).
Host APIs, package boundaries and the later Brickwright wiring are documented
in [docs/INTEGRATION.md](docs/INTEGRATION.md). The roadmap, including the possible
CrispMesh scan-to-CAD path, is in [docs/ROADMAP.md](docs/ROADMAP.md).

- Add boxes, cylinders and spheres; edit dimensions and transforms in millimetres.
- Retain and edit the operands of union, subtract and intersection operations.
- Multi-select with object checkboxes, Shift-click or long press. Subtraction
  uses the first selected body as its base and later bodies as cutters.
- Navigate with a camera-synchronized view cube, six principal views, Home/Fit,
  zoom controls and perspective/orthographic projection.
- Model on a numbered 400 × 400 mm workplane with 1 mm minor / 10 mm major lines.
  Snap spacing is independent of the displayed ruler grid.
- Move/rotate/scale with handles or numeric properties; nudge with arrow keys.
  Drop selected top-level bodies onto the workplane, including rotated bodies.
- Grouped tool ribbon, collapsible Objects/Properties panels and a persistent
  touch multi-select mode; navigation does not change document history.
- Undo/redo and independent histories for each embedded instance.
- Save editable `.bcad` projects; reopen them or closed STL meshes.
- Export binary STL or 3MF for printing. These exports contain meshes, not the
  editable project graph; 3MF currently exports geometry without materials.
- The standalone app autosaves on this device and can run offline after the
  production bundle's service worker has installed. Keep portable project files
  as backups. Corrupted autosaves are offered for recovery before replacement.

Geometry evaluation runs in a worker. Export is disabled while the displayed
geometry is stale or failed. The previous geometry stays visible with an error
if an edit fails. Imported geometry is built before replacing the current design.

## Packages

| Package | Responsibility |
| --- | --- |
| `@brickwright/cad-core` | Versioned documents, validation, commands, selection and undo |
| `@brickwright/cad-geometry` | Headless Manifold evaluation, STL/3MF |
| `@brickwright/cad-editor` | Framework-independent DOM/Three editor, isolated worker |
| `@brickwright/cad-brickwright` | SB3 sidecar, LDraw coordinate conversions and part-mesh handoff |

The standalone app is one host. File access and persistence are injected rather
than implemented inside the reusable core/editor. Each editor owns only its
mount target and must be disposed when its host unmounts it.

```sh
npm test
npx playwright install chromium webkit
npm run test:e2e
```

The source provenance for reused Brickwright BSD arithmetic is recorded with
commit and SHA-256 hashes in `docs/brickwright-provenance.json`. Third-party
notices are in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
