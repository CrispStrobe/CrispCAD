# Project instructions

- Keep this CAD implementation independent and BSD-3-Clause. New runtime dependencies
  must meet the owner's MIT/Apache/BSD-like license requirement, including their
  transitive/native/WASM dependency closure.
- Reference applications are learning sources. Do not copy Layerling implementation
  or assets. Solidcraft's UI kit, look, theme, branding and interface design are
  excluded; see docs/PARAMETRIC-CAD-STRATEGY.md for the reviewed boundaries.
- OpenSCAD and ImplicitCAD are ideas-only references: consult documentation,
  not their GPL/AGPL implementations. Keep our CAD Script compiler original;
  see docs/CODE-MODE.md for the implemented language and reference boundary.
- The repository remains private. On 2026-11-13 the owner requested no GitHub Actions
  while private to conserve Free-tier CI allowance. Actions is disabled, and the
  old workflow is archived outside .github/workflows. Run checks/builds locally;
  do not enable cloud workflows or change visibility unless the owner directs it.
- Preserve saved project definitions and every existing history revision. UI/view
  preferences and transient drag previews do not belong in model history.
