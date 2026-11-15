# CAD motor programs

The shared CAD editor exposes `editor.simulation`. It runs the same qualified
Jolt worker as the manual Simulate panel, without changing design geometry or
writing simulation poses into undo history. Programs can keep running when the
CAD panel is hidden; hiding the browser page stops them.

Hinge joints have optional persisted `control.port` addresses. New articulated
presets allocate A, B, …; inserting or duplicating an assembly allocates unused
ports. Deleting another motor does not renumber surviving ports. Older projects
remain addressable by joint ID; the Simulate panel can assign ports explicitly.
Port edits participate in normal CAD undo/save/load. Fixed joints have no port.

Commands: start, stop, reset, setMotor(ref, speedDegreesPerSecond, torqueNm),
runDegrees(ref, signedDegrees, speedDegreesPerSecond), and stopMotor(ref,
'brake'|'coast'). Angle and speed reporters use the physics encoder. Multi-turn
angles are unwrapped every 5 ms; degree commands approach their target using
encoder feedback, with cancellation and a bounded simulated deadline. Stop,
reset, model edits, editor disposal and replacement commands cancel pending
travel. The worker never replaces a body's pose to achieve its target.

The controls are an ideal finite-torque hinge drive, limited to ±720 degrees/s.
They are not a calibrated DC electrical model: there is no claim of real current,
stall torque, winding temperature, battery discharge or manufacturer RPM.
Model density remains a user-editable rigid-body approximation.

Adafruit's original MIT STEP motor geometry and exact source hashes are in
`library/sources/adafruit-motors/`. The offline converter records mesh tolerance,
orientation, units and any shaft separation. Every inserted preset retains the
original STEP record, license, source revision and modification notes in its
project provenance. Collision geometry is independently qualified against the
current mesh before creating a world; source provenance does not bypass that gate.
