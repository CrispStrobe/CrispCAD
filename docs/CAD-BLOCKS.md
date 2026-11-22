# Block and pseudocode modelling

Hosts with a block editor (Brickwright Lite's **CAD shapes** extension) and
agents (MCP `cad_compile_blocks`) describe a model as a small JSON program,
format `brickwright-cad-blocks`. `packages/core/src/cad-blocks.ts` compiles that
one tree to three **parametric** targets:

| Target | Function | Result |
| --- | --- | --- |
| CAD Script | `compileBlocksToCadScript(program)` | `param`/`const` source; the retained, editable code body |
| OpenSCAD | `exportBlocksOpenSCAD(program)` | Customizer variables, real `for`/`if`, centred primitives |
| JSCAD | `exportBlocksJSCAD(program)` | `getParameterDefinitions()` + `main(params)`, real loops |

The compiled model does not run once into fixed geometry; it stays a formula: change a parameter and it regenerates. Unlike the
existing OpenSCAD/JSCAD exports of arbitrary CAD Script (evaluated snapshots),
block exports keep parameters, loops and conditions. That keeps the generated code
readable for teaching.

## Program shape

```json
{"version":1,"format":"brickwright-cad-blocks","name":"Peg board",
 "params":[{"name":"holes","value":5,"min":1,"max":12,"step":1}],
 "body":[
  {"k":"set","name":"x","value":{"k":"num","v":0}},
  {"k":"subtract","body":[{"k":"shape","shape":"box","args":{"width":{"k":"num","v":60}}}],
   "cutters":[{"k":"repeat","count":{"k":"var","name":"holes"},"body":[
     {"k":"move","x":{"k":"var","name":"x"},"y":{"k":"num","v":0},"z":{"k":"num","v":0},
      "body":[{"k":"shape","shape":"cylinder","args":{"radius":{"k":"num","v":3}}}]},
     {"k":"change","name":"x","by":{"k":"num","v":12}}]}]}]}
```

Statements carry an optional `id` (the Scratch block id). Errors are
`CadBlocksError` with `blockId`, so a host can highlight the offending block.

- **Shapes** (`BLOCK_SHAPES` lists inputs and defaults): box, cylinder, cone,
  sphere, halfSphere, tube, torus, wedge, roof, roundRoof, pyramid, prism (regular
  polygon), star, heart, paraboloid, text. All are centred on their bounding box,
  in millimetres. Star points and prism sides must be fixed whole numbers.
- **C-blocks** wrap the shapes they act on: `move`, `rotate` (fixed-axis X→Y→Z
  degrees), `scale` (signed), `mirror`, `group` (union), `intersect`, `hull`,
  `subtract` (`body` minus `cutters`), and `hole`. There is no hidden "current
  selection".
- **Holes**: shapes inside a `hole` block cut
  every solid of the enclosing `group` (or of the whole model), including solids
  placed later. Holes pass through `move`/`rotate`/`scale`/`mirror`, loops and
  `if` branches, and stop at `group` boundaries. In `intersect`/`hull` bodies they
  cut the result. Block editors can therefore express cutting with single-body
  C-blocks; the explicit two-body `subtract` remains available in JSON.
- **Colours**: `{"k":"color","color":"#rrggbb","body":[…]}` paints the solids in
  its body; the innermost colour wins. A `group` (also `intersect`, `hull`,
  `subtract`) is one solid of one colour: its own colour block's, else the first
  colour painted inside it. See [Colours](#colours).
- **Control**: `repeat n`, `for var from to [step]` (inclusive, directed),
  `if/else`, `comment`.
- **Values**: numbers, variables, `+ - * / %`, comparisons, `&& || !`, unary minus,
  `abs floor ceil round sqrt sin cos tan asin acos atan atan2 ln log exp pow10 pow
  min max` (trigonometry in degrees), and `random`.

## Variables become formulas

Each `set`/`change` creates a new named binding (single assignment), e.g.
`const x_2 = x + w;`. Expressions are pure, so the result remains parametric.

- An `if` that changes a variable in either branch merges it as
  `cond ? then : else`.
- Inside a loop, unconditional `change by` with a loop-invariant amount is an
  induction variable. It compiles to the closed form `x + k * step` inside the loop
  and `x + count * step` after it, also through nested loops. This covers the usual
  block pattern "repeat: place, then change x by spacing".
- A variable first `set` inside an iteration is local to it.
- Anything that would carry another kind of value between iterations is refused
  with a block-specific explanation. That covers a change inside an `if` in a loop,
  a set after a change, reading a value before it is set in the iteration, changing
  the loop counter, and reading a loop-local value after the loop. The compiler
  never guesses geometry.
- `random` is fixed at compile time from its seed (the block id), so models are
  reproducible. Its limits must be fixed numbers. Whole-number limits give whole
  numbers, as in Scratch.

Names are sanitised once for all three languages (umlauts transliterated,
keywords/builtins suffixed `_v`, collisions numbered). Unused bindings are dropped.

## Colours

A code object has one colour, so `compileBlocksToCadScript` also returns `parts`:
one CAD Script program per colour, in order of first use (solids without a colour
form a part with no `color`, which the host paints with its default). The parts are
exact. Holes cut every solid of their level whatever its colour, because
(A ∪ B) − H = (A − H) ∪ (B − H). Variables, loops and parameters are kept in every
part, and `source`/`program` remain the whole model. A model with at most one
colour has a single part.

`applyBlocksModel(session, name, compiled)` puts a compiled model into a session
as **one undo step**: one code object per part, named `name`, then
`name (#rrggbb)`. A later build finds them again by name and updates them in place.
It keeps the parameter overrides that the new source still declares, and removes
colour parts the model no longer has. Its result is `built`, `updated` or
`unchanged`. Brickwright Lite's CAD shapes blocks use it.

OpenSCAD and JSCAD keep colours natively: `color("#rrggbb") { … }` and
`colorize([r, g, b], …)`.

## Limits and known gaps

4,096 tree nodes, nesting depth 32, 64 parameters and 64-character text. The
generated CAD Script remains subject to the normal [code limits](CODE-MODE.md),
including 256 statements and loops of at most 256 values.

- Text keeps the engine font in CAD Script and its family name in OpenSCAD.
  JSCAD has no outline fonts, so the export draws the text in JSCAD's built-in
  single-stroke font, stroked to the same cap height (= size) and a similar weight.
  The letter shapes and widths differ from the editor's.
- Tessellation follows each target's own kernel, so curved volumes agree to within
  about 2 %. Boxes, booleans and transforms agree exactly.

Tests (`tests/cad-blocks.test.ts`) build every shape and control-flow case with the
Manifold kernel from CAD Script, re-import the OpenSCAD output through our importer,
and execute the JSCAD output on the real `@jscad/modeling` (test-only dependency).
