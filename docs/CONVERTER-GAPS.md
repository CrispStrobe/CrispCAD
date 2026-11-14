# Converter gap register

[The machine-readable register](evidence/converter-gaps.json) records every
current conversion notice, its cause, tests, state and acceptance work. Imports
now expose stable notice IDs through `getCodeImportNotices(program)` and the
JSCAD result's `notices` field. Translated warning prose remains available for
older hosts. New notice metadata survives source/project save and reload.

A positive solid is an execution result. It does not establish faithful font
outlines, materials, random sequences, parameter behavior or upstream meshes.
Notice-free conversion is not independent certification either. A notice is
removed only when its underlying behavior is implemented and tested; verified
source diagnostics can remain visible after a compatibility rule is implemented.

The first two notice gaps addressed here are numeric lettering and assertion
messages. Numeric text now uses an original IEEE-754 rational formatter checked
against official OpenSCAD 2021.01 executable vectors. Assertions retain literal
and computed messages in both solid and profile contexts. Neither requires
copying an upstream implementation. Saved older programs keep their old behavior.

The next sequence is seeded randomness and default tessellation, followed by
supplied fonts/shaping, retained colour/materials, typed string parameters and
retained JSCAD parameter features. External source/assets resolution and larger
constructions also remain explicit work. Each step needs an original reproducer,
parameter-edit coverage, an independent oracle where available, history/source
round trips and an updated corpus/notice census.

Only published documentation and binary behavior are used for OpenSCAD itself.
The downloaded oracle is external tooling under `/tmp`, never an application
runtime dependency or bundled asset. Mathematical/permissive references are
reviewed separately. Research files and their generated geometry stay external.

## Retained evaluation checkpoint

The [frozen-sample evidence](evidence/import-engine-expansion-2026-11-14.json)
records **163/256 positive solids**, up from 137, at the same 15-second limit.
All 137 previous successes remain positive and their volumes agree at the stated
1e-6 relative/absolute tolerance. This is a coverage gain, not a fidelity claim:
**71 positive files carry notices**. The remaining outcomes are 37 unsupported,
33 limited, 22 failed and one timeout. Keep these separate when choosing the next
engine change; never erase notices to raise the success count.

This checkpoint retains comprehensions and scalar declarations, bounded dynamic
polygon generation and list indexing, affine/profile transforms, signed
revolutions, selective resize and exact numeric-text formatting. The checked
limits still bound construction work, lists, scalar evaluation and mesh size.
No research model was added to the shipped library.

## Reconciled parser checkpoint

The [next frozen replay](evidence/import-engine-reconciled-2026-11-14.json)
records **165/256 positive solids**, up from 163. All previous 163 remain positive;
volumes and bounds agree at the stated 1e-6 tolerance. There are 37 unsupported,
33 limited, 20 failed and one timeout. **72 positive files carry notices**.

This pass combines verified include/use bundles and captured functions with
retained comprehensions, fixes scalar/shape caches across loop scopes, retains
expression assertion messages and default/ignored argument checks, and honors
mixed argument order. JSCAD signed scales export through reflections. The
[executable probes](evidence/retained-evaluation-oracle-2026-11-14.json) cover
original argument-order, numeric diagnostic and list/text cases; the full corpus
has no independent geometry oracle. All 143 gallery items retain their archived
source and mesh bytes; conversion notes were refreshed where needed.

Dependency support is partial: explicitly supplied, hash-checked source bundles
work; implicit assets, external meshes and heightmaps still need a bounded asset
model. Default tessellation, fonts, colours, strings and random sequences remain
in the register rather than being hidden by the success count.
