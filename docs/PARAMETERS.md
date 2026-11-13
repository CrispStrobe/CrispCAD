# Optional parameter-driven modeling

The **Parameters** button adds an optional design-intent layer to the existing
direct modeler. It currently drives box width/depth/height, cylinder radius/height,
sphere radius, and node position, rotation and scale. Bindings can also target
retained boolean operands, so a formula can change an existing cut.

Try [the mounting plate](../examples/parametric-mounting-plate.bcad): use **Open**,
then **Parameters**, change `thickness` or `holeDiameter`, and choose **Apply
parameters**. The bore stays through the plate and follows its dimensions.

1. Add a named parameter such as `width`, expression `40`, unit `mm`.
2. Add `half`, expression `width / 2`, unit `mm`.
3. Choose **Drive a property**, select an object and its **Width (mm)** property,
   enter `width`, and apply. The numeric inspector marks that field as driven.
4. Edit the named parameter or binding to change the result. Remove a binding and
   apply to return the property to direct numeric editing at its current value.

Expressions support `+ - * /`, unary signs, parentheses, scientific notation and
references to named parameters. Explicit literals accept `mm`, `cm`, `m`, `in`,
`deg` and `rad`. A bare numeric result uses the field's declared unit; addition
and subtraction otherwise require matching dimensions: `width + 5 mm`, rather
than `width + 5`. Lengths are stored in mm and angles in degrees; `scalar` is
dimensionless. There are no script evaluation, property accesses or JS functions.

Parameters may reference later rows. Cycles, unknown names, incompatible units,
division by zero, out-of-range dimensions and duplicate bindings fail before
committing. A successful apply is one undoable, archived model edit. Errors leave
the previous model and expressions intact. Geometry-kernel errors still preserve
the last good display, with the editor's existing error message and Undo recovery.

Up to 64 named parameters and 256 bindings are supported. Expressions are bounded
to 256 characters, 128 tokens and 32 nesting levels. One expression drives each
bound property. Renaming a parameter requires updating expressions that refer to
it; unresolved references are refused, not silently renamed.

Duplicates preserve dimension/transform bindings to the same model parameters.
A driven Position X receives an explicit 10 mm offset expression when duplicated.
Deleting a body removes its bindings; Undo restores them. Clipboard paste preserves driving formulas and merges parameter namespaces,
renaming collisions. Headless hosts enable this with
`session.insert(fragment, offset, {mergeParameters:true})`.
Joints must be detached before driving connected bodies or their operands until
joint frames themselves have stable parametric references.

## Persistence and integration

Enabling parameters upgrades the editable document to **version 2**. Direct-model
version 1 documents remain supported; older builds reject version 2 explicitly.
Version 2 stores the design graph and its evaluated numeric geometry. Import
validates that both agree and refuses stale values. History snapshots and portable
archives retain the graph, including branches restored from earlier iterations.
Print exports remain evaluated meshes.

Headless hosts use `session.setParametric(design)` from `@brickwright/cad-core`;
`evaluateParameters`, `evaluateExpression`, `drivenProperties` and `propertyValue`
are also exported. Existing `session.update`/`transform` calls refuse changes to
driven properties; edit or detach a binding instead. Geometry evaluation and
physics continue to use the validated evaluated document. A geometry change
invalidates collision qualification, mass and inertia; old proofs cannot be reused.

This is the first parametric milestone. Catalog generator recipes, sketch
constraints, extrude/revolve/sweep feature history, stable topology references,
exact B-rep/STEP and full FreeCAD equivalence remain separate work. See
[UX-AND-PARAMETRIC.md](UX-AND-PARAMETRIC.md).
