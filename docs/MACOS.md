# macOS inspection build

Requires macOS 14 or newer, Node 22.18+ and the Xcode command line tools. The build
targets the current machine's architecture. No Apple developer account is needed.

```sh
npm ci
npm run mac:build
npm run mac:verify
npm run mac:run
```

The output is `apps/macos/build/CrispCAD.app` (named `Brickwright CAD.app` before the 2026-11-24 rename; the bundle identifier is unchanged, and `mac:install` removes the old bundle). `mac:run` / `mac:install`
verifies and installs it into `~/Applications`, asking any running copy to quit
normally before replacement. It never force-quits an editing session. It is
locally ad-hoc signed, not
Developer ID signed or notarized for distribution to other people's Macs.

The small original Swift/AppKit host embeds system WebKit and the production web
bundle. It starts an immutable asset server bound to **127.0.0.1:4318**, exclusively
for this app, so workers, WebAssembly and IndexedDB have a stable origin. It does
not listen on the WLAN. Quit another copy before starting a second build.

Exports use a native Save panel and atomic file writes. Project/STL/SVG/history
imports use native Open panels. Confirmations and named-iteration prompts use
native sheets. The reusable CAD packages remain independent of AppKit/WebKit.

Models and iterations are journaled in this app's WebKit website data, separately
from browser and iPad workspaces. On startup the app also copies existing journal
projects to `~/Documents/Brickwright CAD` (the folder keeps its pre-rename name so existing projects stay in place), then maintains full `.bcad` archives
automatically. **Settings → Choose library folder** changes that location and
copies the current library. Previous folders are kept. Missing IndexedDB journals
can be recovered from the selected folder through Projects/startup recovery.
Conflicting or corrupt existing files are refused rather than overwritten.
No automatic cloud synchronization or merging is provided.
The native bridge currently caps exports at 64 MiB, matching history backups.

`mac:verify` starts the **actual native app**, with ephemeral website data, and
checks editor startup, worker/WASM geometry, parameter recomputation, reload,
iteration selection, an actual atomic library-file write and refusal to prune
existing history. The library check uses a temporary folder that is then removed.
It exits without changing the inspection workspace, using separate port 4319
and ephemeral storage even while the regular app is open. Native file-dialog acceptance remains
a manual check; browser tests additionally cover the desktop export bridge.

Safari's Develop menu can inspect this WebKit app during development. The host
only permits its own origin inside the window and opens clicked web links in
the system browser. Build assets and signing output are ignored by Git.

## Native menus and shortcuts

The File, Edit, View and Object menus are generated from the editor's menu definition
(`packages/editor/src/editor-menu.ts`, the same one the web toolbar and BrickWright use).
`scripts/generate-mac-menus.mjs` writes `apps/macos/EditorMenu.generated.swift` (commands,
labels, sections, groups, availability and German titles from the core i18n catalogue) during
`npm run mac:build`; `tests/editor-menu.test.ts` fails when the committed file is stale. Main.swift
keeps only the macOS titles and key equivalents of known commands and the macOS-only items
(About, Settings, Project Library, Window, Help). A command added to the definition appears in
the native menus without a Swift change, runs through the same `brickwrightExecuteCommand`
bridge, and is enabled from the editor's own availability (`editor.menuItems()`, published to the
app with the command state); items the editor does not offer in the app are hidden.

File provides New Project (⌘N), Open Project (⌘O), Project Library (⇧⌘O),
Save Project (⌘S), Model Library, Import STL or STEP (⌘I), Import STEP as exact bodies, Export
(⇧⌘E), Export STEP (exact B-rep) and STEP evidence, then one submenu per further section of the
definition, in its order: **Exact modeling (B-rep)** (fillet, chamfer or shell, chosen edges,
measure exactly, recompute, surface blends), **Holes and fasteners** (standard hole, fasten
holes, standard parts), **Assemblies** (groups, exploded view, configurations, mechanism check,
planetary gear set) and **Drawings and checks** (assembly drawings, drawing export, printability,
manufacturing, materials and mass); a section added to the definition later becomes another
File submenu. Import as a mesh accepts closed STL meshes
and STEP and adds them to the current document. Saved project files include the journal; export
chooses a printable mesh format or STEP.

Edit provides Undo/Redo (⌘Z / ⇧⌘Z), Cut/Copy/Paste (⌘X / ⌘C / ⌘V), Duplicate
(⌘D), Delete and selection commands. These operate on CAD bodies when working
in the model and on text when a text field is focused. Model clipboard transfers
preserve editable generators, parameter bindings, materials and internal joints.
Copying a single part of a mechanism leaves external joints behind. Paste uses
fresh object/joint IDs and a separate parameter namespace when names collide.

View provides Fit Model (⌘0), Home (⇧⌘0), principal views, projection, workplane
and panel toggles. Object provides the shape library (⇧⌘A), Select/Move/Rotate/
Scale, Mirror, Pattern, Split, Drop, boolean operations and Parameters, and a **CAD tools** submenu
(terminal, command palette, code workspace, upgrade lofts). V / Escape returns to Select.
An Objects-row click gives keyboard focus to the scene, so Delete works directly.

The native smoke test invokes real Cocoa menu targets and transfers a model
through a private named system pasteboard. It verifies Paste, Duplicate, Delete,
Undo/Redo and persistent histories without overwriting the user's clipboard.
