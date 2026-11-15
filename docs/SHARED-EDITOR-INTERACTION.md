# Shared Robots and CAD interaction

CAD's viewport and Brickwright's Robots editor now use the same pure rectangle
selection functions and pointer camera intentions. The selection source lives in brickwright-lite at
`overlay/scratch-gui/src/lib/editor-interaction/box-selection.js`; CAD vendors it
unchanged at `packages/editor/src/vendor/box-selection.js`. It normalizes drag
rectangles and intersects projected bounding boxes, clipping homogeneous edges
to the near/far planes before perspective division. Both perspective and
orthographic cameras use the same function.

Selection policy, model IDs/groups, hidden-part filtering, gestures, pointer
capture and history ownership remain in each editor. The shared function knows
only clip-space points and canvas-local rectangles. This keeps CAD independent
of Scratch and Robots' simulation and coordinate system.

Update the shared source in a dedicated Lite worktree and commit it, then run:

```sh
node scripts/sync-editor-interaction.mjs /path/to/brickwright-lite-worktree
node scripts/sync-editor-interaction.mjs /path/to/brickwright-lite-worktree --check
npm run build:packages
npm test -- tests/box-selection.test.ts
npm run test:e2e -- --project=chromium tests/browser/solid-hole.spec.ts tests/browser/camera.spec.ts
```

The sync command records a source commit and SHA-256 in
`brickwright-provenance.json`; older shared files retain their existing pins.
The check verifies the checkout, vendor bytes, hash and content at the recorded
source commit. Runtime has no dependency on another checkout.

The Lite worktree's `docs/ROBOT-CAD-EDITOR-PARITY.md` records the reviewed next
steps: camera gesture intents, live transform readouts, host SDK integration and
user-created part metadata. Existing SDK entry points (`mountCadEditor`, host
file/selection callbacks and the Brickwright sidecar adapter) are the intended
integration boundary. Saved model history stays with its editor.

The shared `camera-pointer.js` maps pointer buttons/modifiers to pan/orbit
intentions for Robots' Brickwright/Studio presets and CAD's Tinkercad/Fusion
presets. Space-left-drag pans in all profiles; plain left-drag stays with the
editor. Robots retains Ctrl-connected-selection and Alt part tools, while CAD
retains modifier orbit. The viewports keep their own axes, units, touch controls,
pointer capture and cancellation. Both shared files are pinned by the sync script.

Robots activates Space-pan only when no placing/picking tool or part drag owns
Space. Escape, pointer cancellation, lost capture and focus loss stop the camera
gesture without a model/undo write. Its EN/DE top Help describes the shortcut.


The same sync/check covers the retained touch tracker and transform arithmetic.
The touch tracker resets its pinch baseline when a third finger replaces a lifted
member of the active pair, preventing a discontinuous camera movement.
