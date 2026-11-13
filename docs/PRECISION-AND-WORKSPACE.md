# Precision and workspace controls

Shift during a drag uses one-tenth pointer sensitivity. Snap increments become
one tenth of the selected move grid, 1 degree rotation (normally 15 degrees), and
0.01 scale (normally 0.1). The Fine checkbox provides this on touch devices.
Changing precision during a drag integrates travel rather than jumping back to
its origin; fine snap resolution remains until that gesture ends. Shift-click
still means multi-select: start ordinary object dragging first, then hold Shift.
Shift with an arrow key moves one tenth of the grid. Numeric input Shift-Up/Down
uses one tenth of that field's step; expression inputs retain normal text editing.

This follows [Blender's documented precision convention](https://docs.blender.org/manual/en/latest/scene_layout/object/editing/transform/control/precision.html).
Other CAD tools differ in modifier bindings. Numeric dimensions, explicit snap
settings and a visible touch option avoid making modifier knowledge mandatory.

Objects controls only the model browser. The browser has a scrolling content
area and a fixed iteration selector footer; File > History opens it when hidden.
File also contains Projects, STL import and format-based export. Edit and Combine
are icon menus with accessible names; pointer/focus outside dismisses menus.
Selection adds common actions when the top bar has room. Shape creation uses the
workplane: presets, imports, new code objects and new sketch extrusions are placed
with their lowest point at Z=0. Editing existing definitions preserves placement.

Code examples are original programs with English/German titles in the core SDK,
selected explicitly using Load example in Code an object. Loading changes only
the draft. Preview does not change history; Create/Apply commits the result. All
34 examples compile, evaluate, export and reimport as solid STL in local tests.
