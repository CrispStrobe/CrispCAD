# Contributing

Brickwright CAD is an independent BSD-3-Clause project. New implementation code
must be original or use dependencies compatible with the project's permissive
license requirement. Do not copy Layerling, FreeCAD or other copyleft source,
icons, fonts or translations into these packages. Public product behavior and
screenshots may inform independently specified requirements.

Use Node 22.18+ (CI uses Node 24):

```sh
npm ci
npm run build
npm test
npx playwright install chromium webkit
npm run test:e2e
npm run verify:physics
npm run verify:packages
```

Package verification installs the six packed SDKs into an independent temporary
host. Its offline install uses an empty npm cache and local tarballs of the exact
installed runtime dependency closure. Unused Manifold GLTF/esbuild tooling peers
are excluded with --legacy-peer-deps; the exercised CAD APIs do not use them.

Keep document validation, commands, geometry and physics headless. File pickers,
host storage, UI frameworks and native bridges belong in host adapters. Preserve
existing documents and every archived revision when evolving schemas. Add tests
for substantive modeling and persistence behavior, including failed edits leaving
the prior model intact. Geometry changes invalidate physics qualification.

See [the roadmap](docs/ROADMAP.md), [host contracts](docs/INTEGRATION.md),
[physics qualification](docs/PHYSICS.md) and [UX/parametric requirements](docs/UX-AND-PARAMETRIC.md).
