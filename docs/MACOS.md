# macOS inspection build

Requires macOS 14 or newer, Node 22.18+ and the Xcode command line tools. The build
targets the current machine's architecture. No Apple developer account is needed.

```sh
npm ci
npm run mac:build
npm run mac:verify
npm run mac:run
```

The output is `apps/macos/build/Brickwright CAD.app`. Copy it to `~/Applications`
to keep a convenient local installation. It is locally ad-hoc signed, not
Developer ID signed or notarized for distribution to other people's Macs.

The small original Swift/AppKit host embeds system WebKit and the production web
bundle. It starts an immutable asset server bound to **127.0.0.1:4318**, exclusively
for this app, so workers, WebAssembly and IndexedDB have a stable origin. It does
not listen on the WLAN. Quit another copy before starting a second build.

Exports use a native Save panel and atomic file writes. Project/STL/SVG/history
imports use native Open panels. Confirmations and named-iteration prompts use
native sheets. The reusable CAD packages remain independent of AppKit/WebKit.

Models and iterations are retained in this app's WebKit website data, separately
from the browser and iPad workspaces. Keep `.bcad` and `.bcadhistory` backups;
deleting the app's website data removes local history. No automatic cloud sync.
The native bridge currently caps exports at 64 MiB, matching history backups.

`mac:verify` starts the **actual native app**, with ephemeral website data, and
checks editor startup, worker/WASM evaluation of a box and a saved iteration.
It exits without changing the inspection workspace. Run it while the regular app
is closed so the fixed port is available. Native file-dialog acceptance remains
a manual check; browser tests additionally cover the desktop export bridge.

Safari's Develop menu can inspect this WebKit app during development. The host
only permits its own origin inside the window and opens clicked web links in
the system browser. Build assets and signing output are ignored by Git.
