# Quasar workpiece cycle and first-start preparation

The previous generic circuit program ran all axes simultaneously. Its displacement-only smoke test did not establish an indexing/press/eject sequence. The ram could enter the dial because mechanism self-collisions were disabled. The original ejector could not reach the pressing station.

Quasar now has a radial guide channel and retaining lip, a wedge ejector with sufficient stroke, a raised ram and a matching clearance opening in the stand. Internal contacts are enabled; the servo/stand bearing pair is explicitly excluded. Visible solids remain rigid; stamping means contact with a rigid blank, not plastic deformation. Linear stages are ideal guided actuators, not a build-qualified lead-screw assembly.

The new physics regression ramps the dial to 90 degrees while holding the ram raised, checks that the blank arrives beneath the ram, verifies that contact stops the ram before it intersects the blank, retracts the ram and ejects the blank off the elevated dial onto the base. The former simultaneous-axis test is replaced because it commanded obstructed motion and did not verify the machine function.

Local validation: 28/28 Quasar print/topology, assembly, workpiece-cycle, Atlas and simulation telemetry/controller checks passed. TypeScript package build passed. A new focus-loss regression failed before the fix: window blur during external mechanical clock preparation cancelled acquisition. External ownership now protects preparation; hidden-page and explicit Stop behavior remain intact.

Merged the coherent robot refinements through 8ac5dfa with current main including the five qualified library originals. Five affected robot suites passed 47/47. Atlas fork/mast candidates use 2,299 scene hulls with our shared compact motor candidates; the contact-pair regression preserves the 2% volume / 0.2 mm bounds qualification gates.

The 16 mm channel leaves clearance around the 12 mm blank so a slightly yawed workpiece does not bridge the upper walls during ejection. The 80 mm stroke ejector exits toward +X; the C-frame column is behind the dial, clear of the exit. Removing invalid legacy box collision candidates leaves the live exact decomposition. The native contact test uses finite 0.1 N pressing / 0.05 N ejection, consistent with the small nominal circuit actuators, rather than a 10 N stamp.

Atlas qualification rejected the imported solid crate for the existing coupled demo: its tilt drifted to about 52 degrees for a 15 degree target. Retaining the original hollow crate and precise spline fork candidates restores approximately 15.55 degrees in the same six-second coupled harness while keeping the newer cradle/wheel/mast optimizations. The collision certificates retain all original tolerances; the fork/crate contact product is 784.

App/VM workpiece-cycle and native build validation are recorded separately in the Lite repository after SDK integration.
