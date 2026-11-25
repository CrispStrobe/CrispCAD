# Terminal and code workspace

The optional CAD terminal and the pointer tools operate on the same `CadSession`.
The terminal is a CAD command surface; it does not execute operating-system shell
commands or arbitrary JavaScript. This is an original BSD-3-Clause implementation
with no additional runtime dependency. Cota's documented command-line workflows
informed the interaction requirements; its source and assets were not copied.

## Open the terminal

Choose **Terminal** in the bottom status bar, **CAD terminal** in the command
palette, or press **Ctrl/Command+backtick** inside the editor. The bottom dock
leaves the canvas available. Close it with the same shortcut or its close button.
The standalone app remembers visibility locally; the default is closed.

- **Enter** submits input or accepts a displayed default. With no pending prompt,
  an empty Enter repeats the most recent command line.
- **Tab** completes commands, the argument to `help`, body names/IDs for `select`,
  and closed-sketch names/IDs for `extrude`. The same entity choices work at their
  interactive prompts. Repeated Tab cycles matches; Shift+Tab cycles backward.
  Completion never runs a command and preserves later arguments when the caret
  is in the middle of a line.
- **Up/Down** recalls command input and restores the unfinished input at the end
  of the history list. Prompt responses are separate from command history.
- **Escape** cancels a pending command. Partial input creates no model edit.
- **help** lists syntax, and **help move** gives help for one command.
- **list** shows current body and sketch identifiers and names.

Command names and fixed or custom aliases are case-insensitive. Object names use exact
matching; quote names with spaces. Unknown, ambiguous, extra or invalid input
reports an error. Invalid prompt input leaves that prompt available for correction.
Completion inserts quotes and escapes automatically. Duplicate names are offered
by stable ID instead. Quoted `"all"` and `"none"` select objects with those names;
the unquoted words are selection keywords. An exact object or sketch ID takes
precedence over a name that happens to look like that ID.
A model revision made elsewhere cancels a pending command rather than applying
its old input to changed geometry. Changing the selected bodies also cancels a
pending transform, so it cannot act on bodies that are no longer highlighted.

## First commands

Each line below is a separate submission:

```text
box 40,30,10 0,0,5
move 0,0,0 @10,0,0
undo
redo
rect 0,0 40,30
extrude Rectangle 5
code
```

`box` creates and selects a box. `move` moves that selection between the supplied
base and destination points. `rect` creates an editable closed XY sketch;
`extrude` adds a retained extrusion referencing it. If more than one sketch has
the name Rectangle, use its identifier from `list`.

Omitting arguments starts the same command as a sequence of prompts:

```text
box
40,30,10
0,0,5
```

The box is committed only after the center is supplied. At the center prompt,
empty Enter instead places the solid on the XY workplane. Sphere and cylinder
commands use the same placement default.

### Modeling commands

| Command | Arguments | Aliases |
| --- | --- | --- |
| `box` | width,depth,height; center | `b` |
| `sphere` | radius; center | `sp` |
| `cylinder` | radius; height; center | `cyl` |
| `line` | first XY point; second XY point | `l` |
| `rectangle` | first XY corner; opposite XY corner | `rect` |
| `circle` | XY center; radius | `c` |
| `extrude` | closed sketch ID or unique name; height | `ex` |
| `select` | `all`, `none`, body IDs, or quoted exact names | `sel` |
| `move` | base point; destination point | `m` |
| `rotate` | X,Y,Z degree deltas | `ro` |
| `scale` | positive X,Y,Z scale factors | `sc` |
| `code` | opens the persistent CAD Script workspace | `script` |
| `export step` | optional bodies: `all`, IDs or quoted names (default: the selection, else every solid body) | |
| `measure exact` | optional bodies, as for `export step` | |
| `fillet` | radius; optional bodies (default: the selection); `--face <normal>` | |
| `chamfer` | distance; optional bodies; `--face <normal>` | |
| `shell` | wall thickness; optional bodies; one or more `--open <normal>` | |
| `recompute exact` | optional bodies (default: all) | |

Movement acts on the selected top-level bodies in one transaction. Rotation
adds each body's XYZ rotation values; scaling multiplies each body's local scale.
These use the session's existing driven-dimension, generator and document guards.
They do not introduce a separate geometry engine. XY sketch commands retain
editable analytic profiles. Lines remain open paths; they are not directly
extrudable. Rectangle and circle profiles can be extruded or edited using the
existing sketch tools.

Run `select` without arguments, select geometry with the pointer, then press
Enter on the canvas or in the terminal. Selection itself does not add Undo steps.

Existing commands such as `undo`, `redo`, `duplicate`, `delete`, `union`,
`subtract`, `intersect`, `fit`, `top`, `front`, `parameters`, `sketch`, `sketch-path`,
`mirror`, `pattern`, and `model-source` route through the editor's command bridge.
Commands that require their existing editor panel open that panel. Common aliases
include `u`, `re`, `dup`, `erase`/`del`, `join`, and `zoom`.

### Exact-kernel commands

`export step` and `measure exact` run on the optional exact B-rep kernel
(`@brickwright/cad-exact` on the kernel lab's `@crispcad/exact-kernel`, SMLib). They
read the model and never edit it.

```text
measure exact "Bracket"
export step all
```

- **Loaded on first use.** The first exact command loads the kernel (9.4 MB of
  WebAssembly) in its own instance of the geometry worker; until then nothing of it is
  downloaded. The output ends with `Exact kernel: load … ms · run … ms · WASM memory … MiB`;
  `load` is 0 once the kernel is loaded.
- **No fallback.** A body without an exact construction is an error naming the body and its
  feature, for example `Scan (mesh): Imported meshes have no exact B-rep …` or
  `Rounded (code): minkowski has no exact lowering …`. Nothing is ever exported or measured
  from a Manifold mesh instead.
- `export step` writes one AP214 file with one solid per body, in world millimetres, through
  the host's file export (a download in the browser). Bodies that touch or overlap are refused,
  because one STEP solid would merge them; export them separately or combine them first.
  Reference and hole bodies are never exported. Recorded library sources (STL with
  attribution) are refused.
- `measure exact` reports volume (mm³), surface area (mm²), bounds and centroid from the
  B-rep, not from a mesh.
- Plain `export` still opens the export dialog, which also offers **STEP · exact B-rep**.
- A request has 60 seconds; cancelling (or the timeout) terminates only the exact worker. The
  Manifold evaluator keeps running.

### Exact fillet, chamfer and shell

`fillet`, `chamfer` and `shell` add an exact feature (document version 41) built by the same
kernel. They edit the model, so each is one Undo step, recorded with the kernel that built it.

```text
fillet 2 "Bracket"                  # round every edge, r = 2 mm
chamfer 1 "Bracket" --face top      # bevel the edges of the top face by 1 mm
shell 1.5 "Box" --open +z --open -y # hollow to a 1.5 mm wall, open at the top and front
recompute exact                     # rebuild out-of-date exact features
```

- **Selectors.** Without `--face`, every edge is used. `--face` takes the edges of one planar
  face, chosen by its outward normal: `+x`, `-x`, `+y`, `-y`, `+z`, `-z`, `top`, `bottom`,
  `front` (−Y), `back`, `left`, `right`, or an explicit `X,Y,Z`. If several faces match, the
  outermost along the normal is used. A shell removes 1 to 6 faces, each `--open <normal>`.
  There is no topological naming: selectors are re-evaluated on the current source.
- **Targets** are top-level bodies by ID or exact name, `all`, or (no target) the selection.
  The body becomes the feature's source, under Inputs, and stays editable.
- **How it is stored.** The node keeps the operation, size and selectors, plus the exact
  result tessellated at 0.01 mm / 10° (`display`), so Manifold-only consumers (viewport,
  physics, printability, drawings, STL/3MF, BrickWright) work without the kernel. `export step`
  and `measure exact` never use that mesh; they rebuild the operation on the exact source.
- **Out of date.** The mesh carries the key of the source geometry and settings it was computed
  from. After an upstream change (a source dimension, a parameter it uses, the size) Manifold
  refuses it with `stale-exact`: “… the exact fillet is out of date after an upstream change.
  Recompute it with the exact kernel …”. `recompute exact [targets]` rebuilds every stale
  feature in one Undo step (“Recompute exact features”). Renaming, moving, duplicating or
  pasting a feature keeps its mesh.
- **Replay.** The commit happens inside `session.withKernel(...)`, so its record carries
  `context.kernel`; `apply` refuses it on another kernel version (see
  [GUI actions and exact replay](#gui-actions-and-exact-replay)).
- A radius the kernel cannot realise fails with the kernel's diagnostic and changes nothing.

What the exact lowering covers: boxes, cylinders and spheres (segment counts are display
resolution; the solids are exact), sketch extrusions and revolutions on every plane (rectangles,
circles, outlines with arcs, regions with holes: arcs and circles stay exact), mirror, linear
and circular patterns, Booleans including solid/hole combinations, exact fillets, chamfers and
shells (rebuilt on their exact source), and CAD Script objects (see
[experiments/exact-kernel](../experiments/exact-kernel/README.md#cad-script-lowering)).

### Custom aliases

Define a shortcut with `alias <name> <command>`, inspect it with `alias <name>`,
list all custom shortcuts with `alias`, and remove one with `unalias <name>`:

```text
alias makeplate b
alias pick sel
makeplate 40,30,10 0,0,5
pick "Box"
help makeplate
alias
unalias makeplate
```

Targets can be command names, fixed aliases, or existing custom aliases. The
mapping stores the resolved canonical command immediately: `makeplate` above
maps to `box`. Removing or redefining another alias cannot break it. Aliases do
not expand arguments or run multiple commands. Built-in names and fixed aliases
cannot be replaced. Names start with an ASCII letter and use 1–32 letters,
digits, hyphens or underscores; up to 64 custom aliases are supported.

Execution, help and argument completion resolve the same mapping. Tab expands
a matching custom alias to its canonical command, just as it does for fixed
aliases. `alias` and `unalias` also complete saved alias names, while the target
argument to `alias` completes commands.

Aliases are preferences shared across projects in a host's storage adapter;
they never add model Undo steps. Standalone retains them on this device. Without
an adapter they last for the mounted editor. Sequential saves merge unrelated
aliases from other editor instances. If storage cannot be read or written, local
changes remain usable, report that saving failed, and retry on the next change.
An unreadable collection is never overwritten. Malformed stored data can be
repaired by a valid save. Simultaneous cross-tab writes still require a future
transaction protocol.

### Coordinates and picking

Coordinates are world millimetres with Z up. Commas separate components even in
a localized interface. Scientific notation is accepted; expressions and unit
suffixes are not part of this first terminal coordinate parser.

| Input | Meaning |
| --- | --- |
| `10,20` or `#10,20` | Absolute `[10,20,0]` |
| `10,20,5` | Absolute three-dimensional point |
| `@10,-5` | Offset from the last accepted point, retaining its Z |
| `@10,-5,2` | Three-dimensional offset from the last accepted point |
| `20<90` | Absolute polar point in XY, measured from +X counterclockwise |
| `@20<90` | Polar offset from the last accepted point, retaining its Z |

A relative point needs a prior point. Coordinates are finite and bounded to
100000 mm from the origin. For XY sketch commands, nonzero Z is rejected.

During a point prompt, click the canvas to provide the same input as typed
coordinates. XY drafting picks intersect the XY workplane and use the existing
grid spacing. Other point prompts can pick a body's surface, falling back to
the XY plane. These initial picks do not implement the full sketch-panel
endpoint/intersection/tangent snapping system. Camera navigation remains
available while choosing points.

## GUI actions and exact replay

The session's central commit boundary emits the accepted result of every
modeling edit while a command subscriber is attached. The terminal subscribes
even while its dock is hidden, so opening it can show recent GUI actions.
Actions include inspector changes, parameter and sketch edits, source edits,
imports, assembly operations and direct transforms. Transient drags and previews
are not commits. Selection and Undo/Redo are separate canonical commands.

An action row shows its human-readable label. **Use command** places its exact
command in the input for inspection or copying; it does not execute it. Most
modeling actions currently use a data form:

```text
apply {"version":1,"kind":"apply","projectId":"...","label":"...","changes":[...],"selection":[...]}
select ["object-id"]
undo
redo
```

An apply record contains structural property changes with both prior and resulting
values. Replay checks all prior values and project identity before changing the
model. It preserves IDs and untouched fields and then runs normal session
validation and derived-model checks. Replaying an already-applied edit therefore
usually reports a stale command. To try a record, Undo its original action and
then replay it. It is not a request to create another independent copy; use
`duplicate` or another creation command for that.

New records that change an existing sketch also carry optional
`context.sketchJoints` read preconditions. These record the joint relationships
of dependent solids, including dependencies through booleans, mirrors and
patterns. Attaching or reconnecting a joint before replay makes the edit stale,
even when its written sketch coordinates are unchanged. Unrelated names, colors
and joints remain untouched. Accepted assembly edits that change a sketch and
its joints together still replay as one transaction. Older version-1 records
without this context keep their original structural checks.

Changed mirror and pattern definitions also capture optional
`context.bodyOperations` preconditions. These retain the operation's ID and kind
plus joint and motion-tracer relationships on it or an enclosing construction
body. Attaching or reconnecting a dependent joint or tracer makes an older
record stale, matching the corresponding GUI edit guard. Unrelated bodies and
connections, joint settings, and tracer positions/colors remain untouched.
Accepted atomic assembly edits can still change an operation and its connections
together in one Undo step. Capturing the read dependencies of every other
editing policy remains follow-up work; older records cannot gain context they
never recorded.

Edits whose result was computed by the exact kernel (`fillet`, `chamfer`, `shell`,
`recompute exact`, the editor's automatic recompute) carry `context.kernel`
(`{id:'smlib', package:'@crispcad/exact-kernel', version}`). Replay needs a host that declares
the same kernel package and version; another version is refused with “Recorded command is
stale: it was built with @crispcad/exact-kernel 0.1.0, but this host has …”, and a host without
the kernel is refused as well. Records without `context.kernel` replay everywhere.

Every successfully completed modeling operation enters the existing Undo stack
once. There is no terminal Undo stack and no saved-document schema migration.
Viewing the transcript, changing visibility, typing, completing, and previewing
source do not create model revisions. Loading another project resets pending
input and the transient transcript and loads that project's input history.

### Current retention and scope

- The transcript is transient: at most 200 entries and approximately 2 MiB of
  text. A single oversized replay payload is explicitly marked as unavailable
  in the terminal. This does not remove its geometry or the project's Undo/archive
  history. The session API still emits the complete record to subscribers.
- Input history is separate: at most 100 command lines per project, up to 4096
  characters each. Large canonical `apply` payloads are not persisted as input
  history. Storage failure falls back to the active session.
- Camera gestures, panel visibility, export dialogs, and other view/host actions
  are not yet captured as a comprehensive replay stream. No-op edits and project
  loads are not recorded as model commands.
- The journal starts when the editor is mounted. It does not reconstruct command
  data from archived history labels. Replay text targets the same project;
  cross-project ID remapping remains future work. `journal export` (below) gives
  a durable export whose portable part is CAD Script.

## Shared command registry

Every command the terminal knows is defined once, in `packages/core`
(`command-registry.ts`). Each entry has its canonical name, fixed aliases, an
i18n description and usage line, typed arguments (point, XY point, vector,
number, sketch, bodies, keyword, JSON record), whether it edits the model, and
whether it runs **headlessly** over a `CadSession` with no DOM. The same entry
also carries the command palette label, search keywords and availability flag.

| Front end | Uses the registry for |
| --- | --- |
| Terminal | Execution of every modeling command (box … select, move/rotate/scale), help, completion, alias targets |
| Command palette | Labels, order, keywords and availability (`requires`) |
| MCP | `cad_list_commands` and `cad_run_commands` (see [MCP](MCP.md#shared-command-vocabulary)) |
| CLI | `node apps/cli/crispcad.mjs run <project.bcad> "<command>" …` |

The terminal still prompts for missing arguments; the shared
`prepareCommand(session, name)` returns those prompts and the executor, so a
typed command and a headless run make the same single commit and the same Undo
step. View, panel and clipboard commands (`fit`, `top`, `sketch`, `copy`, …)
remain editor-side through the command bridge but are described in the same
registry. Headless runs refuse them with a clear error.

```ts
import {createCadSession,createCommandRunner} from '@brickwright/cad-core';
const session=createCadSession();
const runner=createCommandRunner(session);
runner.runScript('box 40,30,10\nselect "Box"\nmove 0,0,0 @10,0,0');
```

The headless runner has no prompts. A missing argument takes the value an
empty Enter would give (a body's center defaults to the workplane; a move's
base defaults to the origin) or fails with `Missing arguments`. Scripts take
one command per line; blank lines and `//` comments are skipped; the first
failing line stops the script and is reported as `Line N: …`. Relative points
(`@dx,dy`) refer to the previous accepted point of the same runner.

### Exact-kernel commands in the registry

`export` and `measure` carry `kernel: 'exact'`. Core parses and resolves their targets and
formats their results (`parseExactCommand`, `formatExactResult`), but has no kernel: a host
passes an `ExactCommandHost` (`run(request, signal)`) and calls `runAsync` / `runScriptAsync`.
The synchronous `run` refuses exact commands. Each exact command reads the model as of its
own script line.

| Host | Exact host |
| --- | --- |
| Editor terminal and export dialog | `createGeometryClient(...).exact`: a lazily created second worker; `cancelExact()` |
| MCP `cad_run_commands`, `cad_export_step`, `cad_measure_exact` | `apps/mcp/exact-worker.mjs`, a thread started on first use |
| CLI | the MCP host: `step <project> <file.step>`, `measure <project>`, `run … --out <dir>` |

### Kernel identity in recorded commands

An `apply` record whose changes were computed by a kernel carries
`context.kernel = {id, package, version}` (for the exact kernel
`{"id":"smlib","package":"@crispcad/exact-kernel","version":"0.1.0"}`). Sessions declare the
kernels their host provides (`createCadSession(document, {kernels})`; the editor's terminal
journal and the MCP host declare the exact kernel through `@brickwright/cad-exact/identity`,
which loads no WebAssembly). Edits made inside `session.withKernel(kernel, run)` are recorded
with it. Replay (`apply …`, the journal's `replay` export) refuses a record whose kernel the
host does not provide, or provides in another package version:

```text
Recorded command is stale: it was built with @crispcad/exact-kernel 0.1.0, but this host has 0.2.0
```

Records without `context.kernel`, including every record made before this field existed, never
depend on a kernel and replay as before. Kernel records are non-portable in the CAD Script
journal export. `export step` and `measure exact` do not edit the model, so they produce no
records; their results name the kernel (`kernel` in `CommandRunResult` and in the MCP results).
The commands that edit the model through the exact kernel are `fillet`, `chamfer`, `shell` and
`recompute exact` (and the editor's dialog and automatic recompute, which run the same code);
their records carry `context.kernel`. See
[exact fillet, chamfer and shell](#exact-fillet-chamfer-and-shell).

## Journal export

The terminal keeps a host-owned journal of every accepted command (typed and
GUI). It is bounded (1000 entries, 8 MiB), lives in memory beside the session,
and resets when another project is loaded. It is never written to the
document, its history or its saved schema, and exporting it adds no revision.

- `journal` prints a summary.
- `journal export` (or `journal export cadscript`) writes the CAD Script export.
- `journal export replay` writes every entry as canonical replay text.

Core exposes the same: `createCommandJournal(session)`, `journal.export(format)`
and `exportCommandJournal(entries, options)`. The terminal controller also has
`exportJournal(format)`.

The CAD Script export turns bodies with a faithful CAD Script equivalent into
`@object` blocks. Each block is a complete CAD Script program that can be pasted
into the code workspace or sent to `cad_create_code_object`. Everything else is
kept in `@replay … non-portable` blocks as canonical replay text, commented out
with `//| `:

```text
// crispcad-journal 1 · cadscript
// Data only. Never evaluate this text as JavaScript.
// project: 3f0c…
// Each "@object" block is a complete CAD Script program for one body.
// "@replay" blocks are non-portable: canonical replay text (prefixed "//| ")
// that only applies to the recorded project.
// 1 selection, undo and redo entries were resolved and omitted.

// @object 1 "Box" color #76b7ce
// from: box 40,30,10 0,0,5; move 0,0,0 10,0,0; rotate 0,0,30
return move([10, 0, 5], rotate([0, 0, 30], box(40, 30, 10)));

// @replay 3 non-portable: rectangle 0,0 20,30
//| apply {"version":1,"kind":"apply","projectId":"3f0c…",…}
```

Portability rules:

- A body is portable when it was created in the journal as a plain box,
  sphere or cylinder (typed or from the GUI), and every later edit that touched
  it only changed its own properties while it stayed a plain primitive.
  Transforms, renames, colour and size edits fold into its final placement.
  The program is `move(position, rotate(rotation, scale(scale, primitive)))`,
  the same order as the model's own transform, with explicit segment counts.
- An edit that consumes a body (a boolean, mirror or pattern), turns it into a
  hole or reference, or otherwise changes it non-portably makes that body
  non-portable as well, together with every edit it depends on.
- Sketches, extrusions, imports, code objects, parameters and assembly edits
  are non-portable for now.
- Undo/redo pairs known to the journal cancel out; undone edits are left out.
  Undo or redo of edits made before the journal started stays as replay text.
  Selection entries are omitted: apply records carry their own selection.

The replay format lists canonical commands one per line after `//` header
comments. The headless runner and MCP `cad_run_commands` can run it against the
recorded project. Neither export is ever evaluated as JavaScript: CAD Script
goes through the bounded compiler, and replay text through the data-only
command parser.

## Persistent code workspace

Enter `code`, use the terminal's **Code workspace** button, or choose that command
in the command palette. A selected code object opens for editing; otherwise the
workspace resumes its last applicable draft. **New code draft** opens the
project's retained new-object draft, preserving any unapplied source already
there. Once that draft is applied, the next new draft starts another object.
The original **Code** modal remains available for the established flow.

The workspace keeps source, object name, parameter overrides, target identity and
the source baseline. Its local draft does not change the CAD model. Preview runs
after a 450 ms pause and shows geometry and compiler diagnostics. Ctrl/Command+
Enter explicitly previews, and Ctrl/Command+Space completes declared parameter
identifiers. For multiple suggestions, Up/Down changes the highlighted choice,
Enter or Tab inserts it, and Escape dismisses the suggestions. With suggestions
closed, Tab indents and Shift+Tab leaves the source field. Explicit build errors
select the compiler's reported source location.

**Create code object** or **Apply code changes** validates the source and geometry,
commits one edit, and leaves the workspace open. Applying again edits the same
code object. Closing retains the draft. In the standalone app, drafts survive
reload on the same device. Once applied, the source is also stored in the normal
code node and travels with saved projects and their history.

If another action changes the model or the saved source, Apply is blocked.
**Use current model** explicitly refreshes the baseline while retaining the
draft for review. Refreshing also invalidates any preview or Apply already in
flight; accepting the refreshed draft still requires a new explicit Apply.
If the target was removed, restore it with Undo or begin a new
draft. Late previews and file imports from a closed/replaced workspace cannot
overwrite the active editor or commit old input.
When several source files are selected while earlier reads are pending, only
the latest selection can replace the draft or report an import error. Editing
the source, closing, or replacing the workspace invalidates older file reads.
The linked **Apply & show model source** action also checks that the same view,
draft and model are still current after its asynchronous rebuild. Closing or
replacing the workspace suppresses that old navigation callback.

Local draft storage retains up to 16 recently used drafts across projects, with
the CAD Script compiler's existing 32 KiB UTF-8 source limit. It is bounded to
2 million stored characters. Export valuable unapplied source for long-term or
cross-device use. Unavailable/full storage is reported in the workspace, and the
active draft remains available in memory. Embedded hosts choose their storage
adapter; without one, drafts/history remain in memory for that mounted editor.
Each save or removal merges this editor's outstanding changes into the latest
readable stored collection. Sequential editor instances therefore preserve one
another's unrelated drafts, and failed writes remain available for retry.
The synchronous adapter has no cross-tab transaction or conflict-resolution
protocol: simultaneous writes can still race, and the same draft uses the last
successful write.

## Host and core APIs

The shared editor has no implicit storage dependency. A browser host can opt in:

```ts
import {mountCadEditor, browserCodeWorkspaceStorage} from '@brickwright/cad-editor';

const editor = mountCadEditor(host, {
  wasmURL,
  workspaceStorage: browserCodeWorkspaceStorage(),
});
editor.setTerminalVisible(true);
editor.openCodeWorkspace();
await editor.executeCommand('terminal'); // toggles the dock
await editor.executeCommand('code-workspace');
```

`workspaceStorage` accepts synchronous `getItem(key)` and `setItem(key,value)`
methods. The standalone host supplies browser storage. Preferences and drafts
are intentionally outside project history. The code workspace and terminal
release subscriptions, point-picking callbacks and timers when disposed.

Headless applications can consume or replay the same committed action stream:

```ts
import {createCadSession, serializeSessionCommand} from '@brickwright/cad-core';

const session = createCadSession(document);
const unsubscribe = session.subscribeCommands(({command, text, summary}) => {
  // text === serializeSessionCommand(command)
  // Store or present a detached, immutable record in a host-owned journal.
});

session.executeCommand(recordedText); // validates before mutation; throws if stale
unsubscribe();
```

Subscribers receive `{command,text,summary}`. Command generation is skipped if
there are no subscribers. Structural deltas avoid including unchanged mesh
buffers when only transforms change. Parsing accepts data only, with no callbacks
or executable source.

## Validation and next work

Unit coverage verifies prompt atomicity/cancellation, absolute/relative/polar
points, configurable aliases/completion, selected-body transforms, sketch/extrusion identity,
GUI-to-text-to-replay roundtrips, stale and invalid rejection, source/draft
persistence, and compatibility with existing model history.

Run the focused checks with:

```sh
npm run test:terminal
```

This builds the packages and runs the command, registry, journal, completion,
draft-store and panel regressions. `tests/editor-panels.test.ts` mounts the actual terminal and code
panels in a ShadowRoot with real CAD sessions. It checks focus, history, prompt
cancellation, quoted entity completion, one-step Apply, parameter keyboard
navigation, and stale asynchronous callbacks. Geometry evaluation, preview
rendering and pointer hit testing are stubbed; these checks do not qualify
WebGL, layout or touch. The pinned MIT `happy-dom` package is a test-only dependency.
The focused command now also includes alias persistence/failure recovery and
asynchronous source-import regressions.

Browser scenarios in `tests/browser/terminal.spec.ts` and
`tests/browser/code-workspace.spec.ts` cover mixed pointer/typed input, focus,
history recall, GUI replay, draft reload, live preview, explicit Apply and stale
source review, including argument completion, custom-alias persistence and
linked-Apply lifecycle changes.
Run them on a machine with Chromium/WebKit installed:

```sh
npx playwright test tests/browser/terminal.spec.ts tests/browser/code-workspace.spec.ts
```

Browser qualification, 2026-11-24: all 20 cases (10 scenarios, each in
Chromium and in iPad WebKit emulation) pass locally on macOS after merging into
`main`. Two test-only fixes were needed:

- The replay scenario now reaches Duplicate through the shared `clickTool`
  helper, because at iPad width the button is in the Edit menu.
- The workspace scenario now targets the Model source panel, not the
  identically labelled toolbar button.

Embedded-host review and qualification on a physical iPad are still open.

Next milestones are completion for further command arguments;
active sketch planes and advanced snaps; continuous paths/arcs and constraint
prompts; more readable action serializers; transaction-based command scripts in
the terminal (MCP and the CLI already commit a script as one step); portable
export of sketches and extrusions; cross-project replay; complete view-command
capture; and qualified mouse, touch and narrow-layout behavior.

## Design notes from PR #79

PR #79 was a parallel, smaller terminal implementation. It was closed in favour
of this one. These of its decisions still apply:

- The terminal is an application command surface. It is not a shell or a
  JavaScript interpreter, and recorded edits are never evaluated as code.
- Readable, lossless encoders for common actions (add, transform, sketch,
  feature, inspector property edits) should replace generic `apply` records
  where feasible. The generic record remains the fallback for extension actions
  and unusual data.
- Repeat and multi-line scripts need atomic grouping: one Undo step per script,
  with diagnostics that point at the failing line.
- Model Source (the GUI-synchronised source dock) and the CAD Script workspace
  are different languages with different jobs. Do not merge them.

Convergence with the exact kernel and the shared command registry is planned in
[CRISPCAD-CONVERGENCE.md](CRISPCAD-CONVERGENCE.md).

Reference: [Cota command-line documentation](https://mxchristian17.github.io/cota/docs/).
