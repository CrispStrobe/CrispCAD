# CAD terminal (first integration)

The optional **CAD terminal** toolbar button opens a bottom dock. Closing it does
not affect the design or undo history. It is mounted in the shared editor, not
the standalone host. An embedding host can set showTerminal at mount or call
setTerminalVisible. The terminal is an application command surface, not a shell
or a JavaScript interpreter.

| Input | Effect |
| --- | --- |
| help | Canonical command names and aliases |
| box 20,30,5 | Add an independent primitive box |
| box | Prompt for width, depth, height |
| move | Prompt for a target for the first selected top-level body's origin |
| m @10,0,2 | Move the entire selection by a world-space displacement |
| move 40,20 | Absolute XY target, retaining the reference Z |
| move @10<90 | Relative polar target, degrees counterclockwise from world +X |
| list | List root IDs and names |
| select ["id"] | Select by stable identity; use list to discover IDs |
| u / re | Undo / redo through the existing session |
| source | Open/toggle the existing Model Source dock |
| code | Open CAD Script's existing code-object editor |
| move-tool | Activate the normal pointer translation mode |
| clear | Clear transcript only |

Tab completes a command name or alias. Up/Down traverses submitted input
history, Escape cancels a pending prompt, and Enter submits one input.
Command text uses English canonical names and decimal millimetres regardless of
UI locale. The selection and revision are checked again before applying a
pending move. A successful typed transform is one undoable session edit;
invalid input or Escape creates no edit. Sketch/feature commands without an
inline grammar open the same existing editors as the command palette.

## GUI → command → model

The terminal observes session events (commit, selection, undo, redo, load).
A committed model change is shown as "apply-edit · action label". **Recall
terminal entry** fills the command input with its JSON delta; it never executes
it automatically. This includes generated objects, sketches, parameters,
drawings, joints, source changes, import and extension edits. Deltas contain
changed top-level fields and individual nodes, their previous values,
new values, the project identity and resulting selection. They retain IDs and
are not interpreted as JavaScript. Applying a delta validates the full retained
document and rejects conflicting changed fields or a different project. It
enters the same undo stack. Replay is intended for the same project at a
compatible prior state (e.g. immediately after Undo), not a portable script
for a fresh project. Large entries are encoded only when recalled.

The command transcript and typed input history are bounded and instance-local;
they survive hiding the dock, not a project load or editor remount. They are not
saved as model revisions. Camera movements, tool-mode switches and uncommitted
pointer previews are not recorded as model changes. Existing project files and
history schemas are unchanged. The terminal does not claim every editor action
has a human-readable or portable semantic command yet.

## Next slices

- Replace generic recorded edits with lossless semantic encoders where feasible
  (add, transform, sketch, feature, inspector property edits) while retaining
  the generic fallback for extension actions and unusual data.
- Extend the prompt lifecycle to canvas point picks, active sketch plane and
  snaps; add typed sketch paths, extrusion, rotation and feature parameters.
- Add explicit repeat, multi-line scripts with atomic grouping and diagnostics.
- Integrate a persistent, nonmodal CAD Script workspace with draft protection,
  parameter completion and preview/explicit Apply. Model Source already has a
  separate GUI-synchronized dock; do not conflate the two languages.
- Qualify standalone and embedded layouts, mouse/touch, localization, undo/redo
  round trips, stale/error paths and large imports. Keep cloud Actions disabled.
