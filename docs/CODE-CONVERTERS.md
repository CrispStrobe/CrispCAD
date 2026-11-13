# Code converter checkpoint — 2026-11-13

This checkpoint is work in progress, pushed at the owner's request. Continue the
converter milestone here; it is not a completed compatibility release.

- Original bounded OpenSCAD translator covers primitives, centering, named
  arguments, global scalar parameters, transforms and Booleans. Includes/modules
  are diagnosed, not loaded. OpenSCAD export emits an evaluated CSG snapshot.
- Original bounded JSCAD AST interpreter uses Acorn 8.17.0 (MIT, no runtime
  dependencies). It does not execute submitted JavaScript. Supported modeling
  APIs, helper functions, destructuring, arithmetic, Math, parameters, bounded
  loops/arrays and multiple output metadata are being brought up against fixtures.
- JSCAD export is checked against @jscad/modeling 2.13.0 (MIT; test dependency only).
- Nine small pinned fixtures from MIT JSCAD and BSD-2-Clause BOSL2 are in
  tests/fixtures/code-corpus, with upstream paths, revisions, hashes and licences.
  No GPL/AGPL implementation or fixtures have been incorporated.
- scripts/convert-code.mjs offers a headless JSON-reporting conversion interface;
  native/SCAD/JSCAD output and history-inclusive .bcad output are being exercised.
  JSCAD imports are evaluated snapshots; separate outputs and whole-output colours
  are available as metadata. Native code-editor imports combine them into one body.
- GUI source import/export and read-only MCP conversion are wired, with final
  regression/localization validation pending. Mac navigation and example formatting
  work from the earlier request is also captured here; no new native release yet.

Last verified before polygon extrusion work: 80 converter/MCP tests passed,
including all 34 OpenSCAD/JSCAD snapshot round trips and the upstream Basic
Booleans JSCAD file. The latest extrusion/vec2 additions compile but require tests
and completion of the OpenSCAD profile syntax. Existing unsupported-fixture tests
must be updated as capabilities become available, without hiding new failures.

Next: complete planar-profile extrusion conversion, qualify the upstream gear,
retain explicit slice-extrusion/BOSL library gaps, finish the machine-readable
corpus report and handoff contract for the VPS library agent, then run the local
checks. GitHub Actions remains disabled on the private repository.
