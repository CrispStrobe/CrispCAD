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

Command names and fixed aliases are case-insensitive. Object names use exact
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
without this context keep their original structural checks. Capturing the read
dependencies of every other editing policy remains follow-up work.

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
  data from archived history labels. Replay currently targets the same project;
  cross-project ID remapping and portable multi-command macros remain future work.

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
points, aliases/completion, selected-body transforms, sketch/extrusion identity,
GUI-to-text-to-replay roundtrips, stale and invalid rejection, source/draft
persistence, and compatibility with existing model history.

Run the focused checks with:

```sh
npm run test:terminal
```

This builds the packages and runs the command, completion, draft-store and panel
regressions. `tests/editor-panels.test.ts` mounts the actual terminal and code
panels in a ShadowRoot with real CAD sessions. It checks focus, history, prompt
cancellation, quoted entity completion, one-step Apply, parameter keyboard
navigation, and stale asynchronous callbacks. Geometry evaluation, preview
rendering and pointer hit testing are stubbed; these checks do not qualify
WebGL, layout or touch. The pinned MIT `happy-dom` package is a test-only dependency.

Browser scenarios in `tests/browser/terminal.spec.ts` and
`tests/browser/code-workspace.spec.ts` cover mixed pointer/typed input, focus,
history recall, GUI replay, draft reload, live preview, explicit Apply and stale
source review, including argument completion and linked-Apply lifecycle changes.
Run them on a machine with Chromium/WebKit installed:

```sh
npx playwright test tests/browser/terminal.spec.ts tests/browser/code-workspace.spec.ts
```

Browser qualification remains open. The initial implementation environment
denied browser IPC; this follow-up environment could not install the browsers
because the Playwright download host returned HTTP 403. Test discovery and DOM
interaction checks are not a substitute for those browser runs.

Next milestones are configurable aliases; completion for further command arguments;
active sketch planes and advanced snaps; continuous paths/arcs and constraint
prompts; more readable action serializers; transaction-based command scripts;
durable journal export and cross-project replay; complete view-command capture;
and qualified mouse, touch and narrow-layout behavior.

Reference: [Cota command-line documentation](https://mxchristian17.github.io/cota/docs/).
