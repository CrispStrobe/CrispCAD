# First delivery — 2026-11-12

The scope in SCOPE.md is implemented as a standalone application plus four
reusable BSD-3-Clause packages. This is a mesh-solid MVP, not feature parity
with Layerling. No application integration changes were made in the active
Brickwright checkout.

## Verified

- TypeScript package/application build and production asset generation pass.
- 27 headless tests pass: document validation, future/cyclic/oversized rejection,
  transactional commands, independent histories, retained operands, graph-depth
  bounds, immutable mesh sharing, real Manifold volumes/transforms, STL round-trip,
  3MF structure, worker cancellation/recovery, SB3 preservation and frame conversion.
- 14 browser workflows pass in Chromium and iPad WebKit: create/dimension/edit,
  retained booleans, download/reimport, autosave/reload, invalid-file protection,
  multiple embedded editors, unmount/remount, narrow panel layout, scoped keyboard
  commands, actual touch tap selection and offline editing.
- Offline acceptance stops the actual HTTP origin server after precaching,
  proves Node can no longer fetch it, then reloads the saved design and adds a
  solid in each browser. Static responses vary by Origin to exercise module
  request/precache header differences. The worker ignores Vary for its own static
  program cache. WebKit's network-offline emulator produced an internal navigation
  error; the stopped-server test avoids attributing that tooling failure to the app.
- All four npm tarballs install offline into an independent temporary host. That
  host imports the public APIs and evaluates a real 10×20×30 mm solid, volume 6000.
- A read-only fixture using the real Brickwright SB3 writer and loader preserves
  the driving-base LEGO model and every original archive entry through CAD attach/
  extract. This verifies the adapter, not the future application's UI wiring.
- The iPad host archives and exports with the existing shared Brickwright
  Distribution certificate. No new Distribution certificate was created.
- Brickwright CAD 0.1.0 build 2 was installed over the paired iPad’s local-network
  tunnel and launched successfully. Physical Files/AirDrop/Pencil acceptance is
  still separate from installation/launch.

The local test browser cache was provisioned on the internal temporary volume
because this Mac's default cache points to an external disk. For a normal build:

```sh
npm ci
npm run build
npm test
npx playwright install chromium webkit
npm run test:e2e
npm run verify:packages
npm run verify:brickwright -- /path/to/brickwright-lite
```

GitHub Actions is configured to build and run package/headless/browser checks;
no remote repository or CI run is claimed. The optional real-Brickwright fixture
is an extra local integration check and is not needed to build this standalone repo.

## Product limits

- Primitives, booleans and imported closed STL meshes; no B-rep/STEP, sketch
  solver, fillet/chamfer or LEGO mechanism editing in this UI.
- LDraw mesh handoff deliberately requires separately authored connector and
  physics metadata. It must not be represented as an already-qualified robot part.
- The standalone app has one local autosaved workspace; portable .bcad files
  keep independent projects. Browser storage quotas can reject large autosaves;
  the host reports the failure and file export remains available.
- STL and 3MF exports are meshes; 3MF currently has geometry without materials.
- Positive non-shearing transforms are supported. Group transforms that would
  introduce shear are refused. Separating a transformed boolean requires reset.
- Browser tests use emulated iPad/touch environments. Native installation/launch
  does not establish physical Apple Pencil, keyboard, large-file or Files/AirDrop
  round-trip acceptance; these remain device acceptance checks.

Integration steps and lifecycle responsibilities are in INTEGRATION.md. Signing
and direct-device installation are in IPAD.md.
