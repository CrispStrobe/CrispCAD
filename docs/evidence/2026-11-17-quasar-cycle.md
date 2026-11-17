# Quasar workpiece cycle and first-start preparation

The previous generic circuit program ran all axes simultaneously. Its displacement-only smoke test did not establish an indexing/press/eject sequence. The ram could enter the dial because mechanism self-collisions were disabled. The original ejector could not reach the pressing station.

Quasar now has a radial guide channel and retaining lip, a wedge ejector with sufficient stroke, a raised ram and a matching clearance opening in the stand. Internal contacts are enabled; the servo/stand bearing pair is explicitly excluded. Visible solids remain rigid; stamping means contact with a rigid blank, not plastic deformation. Linear stages are ideal guided actuators, not a build-qualified lead-screw assembly.

The new physics regression ramps the dial to 90 degrees while holding the ram raised, checks that the blank arrives beneath the ram, verifies that contact stops the ram before it intersects the blank, retracts the ram and ejects the blank off the elevated dial onto the work surface. The former simultaneous-axis test is replaced because it commanded obstructed motion and did not verify the machine function.

Local validation: 28/28 Quasar print/topology, assembly, workpiece-cycle, Atlas and simulation telemetry/controller checks passed. TypeScript package build passed. A new focus-loss regression failed before the fix: window blur during external mechanical clock preparation cancelled acquisition. External ownership now protects preparation; hidden-page and explicit Stop behavior remain intact.

Merged the coherent robot refinements through 8ac5dfa with current main including the five qualified library originals. Five affected robot suites passed 47/47. Atlas fork/mast candidates use 2,299 scene hulls with our shared compact motor candidates; the contact-pair regression preserves the 2% volume / 0.2 mm bounds qualification gates.

The 16 mm channel leaves clearance around the 12 mm blank so a slightly yawed workpiece does not bridge the upper walls during ejection. The 80 mm stroke ejector exits toward +X; the C-frame column is behind the dial, clear of the exit. Removing invalid legacy box collision candidates leaves the live exact decomposition. The native contact test uses finite 0.1 N pressing / 0.05 N ejection, consistent with the small nominal circuit actuators, rather than a 10 N stamp.

Atlas qualification rejected the imported solid crate for the existing coupled demo: its tilt drifted to about 52 degrees for a 15 degree target. Retaining the original hollow crate and precise spline fork candidates restores approximately 15.55 degrees in the same six-second coupled harness while keeping the newer cradle/wheel/mast optimizations. The collision certificates retain all original tolerances; the fork/crate contact product is 784.

App/VM workpiece-cycle and native build validation are recorded separately in the Lite repository after SDK integration.


The complete-project stress run exposed a remaining low-mass wedge instability. A source-modelled printable pusher carriage now supports the wedge; the mass/inertia comes from its visible 22×12×6 mm geometry, not a hidden mass override. Three complete WebKit cycles (closed Controls, open Controls, and after centering controls) passed index/contact/ejection/return checks. The trajectory proof now explicitly requires clearing the dial edge before falling, so a workpiece tunnelling through the dial cannot pass as ejection.

Stop/release previously left preview poses active while the host reported Ready, blocking selection and dragging until Reset. Stop now disposes the worker and restores the editable design immediately while retaining recorded replay/traces for inspection/export. A fresh preparation starts a fresh recording. Pause still preserves the preview. Both new regressions failed before the fix. Combined Quasar, Atlas and controller tests pass 30/30.


Native trackpad host parity: the integrated Tauri app now uses the existing CAD native event contract. An isolated AppKit/WKWebView test showed that ordinary HTML scrolling works without the native router while precise scrolling over Blockly does not reach its SVG handler. The router delegates only handled editor input; unhandled events must be forwarded to their original NSWindow. Application-level redispatch suppressed ordinary panel scrolling in the native regression. The standalone macOS host now uses the same corrected window forwarding. The browser SDK runtime is unchanged by this native-host-only follow-up.


Stopped replay follow-up: retain the last measured snapshot so Previous recorded frame starts at the end of the recording. Returning to Live with no mechanical worker restores the design instead of creating another hidden preview lock. A regression using actual 20 Hz recording intervals fails with the prior Stop/Live behavior; all 31 targeted tests now pass.
