# Model browser and workbench direction

Keep the viewport central and the top row compact. The browser answers “what is
in this model and what defines it?”; Properties answers “what can I change about
this selection?”; the iteration selector answers “which saved version am I viewing?”
These are different jobs and should not become three competing histories.

## Current browser

- **Bodies** opens by default, with compact icon/name rows and explicit selection.
  Checkboxes select several objects; clicking a name selects it and immediately
  enables viewport shortcuts, including Delete. Long labels keep their full tooltip.
- Authored booleans expand into **Inputs**. Select an input to edit its definition;
  Properties offers the route back to the parent result. Generated presets remain
  a single part, with generator controls rather than an exposed triangle recipe.
- A code body expands into **Code & parameters**, showing evaluated local inputs
  and an Edit action. An extrusion exposes **Sketch & extrusion**.
- **Sketches** and **Parameters** sections appear when the model contains them,
  with direct routes into their existing editors. A sketch can be shared by several
  features: these are references to one canonical definition, not copied sketches.
- Sections retain their expansion during edits/selections within the open project.
  Expansion is transient view state, not a saved model iteration. Desktop rows are
  compact; touch pointers retain taller row targets.

This is a staged browser built on retained model identities. It is not yet an
assembly tree or a general constrained sketch feature timeline.

## Next steps as modeling capabilities arrive

1. Add a focused sketch editing context: entities and named dimensions, inline
   editable constraints, clear remaining degrees of freedom and conflicting input
   diagnostics. Keep these beneath their sketch, not among body rows. Escape exits
   the active operation; cancel must retain the last accepted model.
2. Introduce explicit parts/components before assembly nesting. Distinguish
   construction references from independently selectable simulation bodies. Add
   visibility and lock controls with real semantics and keyboard access.
3. Present ordered feature dependencies per part, with edit/diagnose actions.
   Suppression and rollback need canonical state and downstream validity checks;
   saved revision restore remains the compact iteration selector and retains all
   later work. A dependency tree alone is not a chronological feature timeline.
4. Add datums and semantic references before broad face-attached operations.
   Surface selections must survive recomputation or report a broken attachment.
5. Add joints and simulation configuration under an assembly's real data model.
   Use the same qualified collision data and explicit rigid/elastic distinctions.

Use selection-aware properties and operation-specific numeric controls. Keep
frequent actions immediately available; put rare operations in searchable menus.
Show live values during direct manipulation, then commit one edit on release.
Do not add empty Constraints/Assembly/Surface tabs before they have working tools.

The supplied reference screenshots illustrate established CAD concepts such as
hierarchical browsing and feature organization. Our implementation, icons, layout
and interaction details are independent; Solidcraft's UI design is excluded.
