# Electronics completeness across all 22 robot examples

Each default robot now includes a full-size METRO Mini ATmega328P/16 MHz
controller, a regulated 5 V module, power source, mounting geometry and actuator
harnesses. DC drive/linear-actuator channels receive dual H-bridges as needed;
servos use a separate power distribution header and controller signal connections.
Atlas has three DC channels (A/B/D), two bridges and servo C. Mantis uses a compact
split layout around its moving ballast. Nova gains functional compact wheel-drive
housings and clearance bays; Scout has an ideal encoder pickup with four leads.

The METRO Mini and MPM3610 surfaces are converted from byte-verified MIT Adafruit
STEP originals. No board is scaled to fit. The Metro's Uno-compatible target is
documented at https://learn.adafruit.com/adafruit-metro-mini/overview . The 5 V
module reference is https://www.adafruit.com/product/4739 . Original derivative
hashes, rigid transforms and any omitted tiny faces are retained in the source
and generated metadata. OCP is an offline conversion tool, not a runtime dependency.

The supply housings and bridge boards are original functional illustrations.
The existing simulated 6 V source and ideal regulated 5 V rail remain nominal
functional models, not a switching-converter, battery-discharge, current-rating
or physical-pin qualification. Ideal linear stages remain ideal, including their
actuator interfaces. Physical actuator drive trains and sensor internals are not
certified fabrication designs. Existing print-only layouts are retained; the new
prototype trays can be selected/exported individually from the assembly.

New electronics proxies add explicit mass and collision bodies. No old controller
or driver placeholder is hidden behind a new board. Existing actuator ports and
project identities are preserved. Cable routes use the default functional circuit's
controller pin roles and bridge channels; importing arbitrary edited Circuit wires
into exact physical pad routes remains unimplemented. Curves, sample vectors and
tube buffers are reused, and stationary harnesses do not dirty geometry buffers.

Older saved examples offer **Add controller and power** in CAD Properties. This
is a revision-checked atomic edit with one Undo entry, preserving previous edits,
title, actuator ports and earlier history. It edits only the CAD document; Code,
Blocks, Circuit and Widgets are retained. Moved/rotated full-size frames are
supported; resized frames and conflicting electronics identities are left alone.
There is no silent project migration. Loading a fresh example also gets the new
hardware and Nova clearance bays.

Validation before the browser/packaging qualification: 27 suites, **240 tests
passed**, covering all 22 robots' existing geometry/physics, 22 explicit hardware
and wiring audits, non-overlapping electronics clearance boxes, licensed detailed
surfaces, frame consistency and legacy upgrade/history/ownership controls.
Nova's first added drive proxy touched the ground and failed its travel gate;
raising its clearance fixed the failure without changing the original 5 mm travel
or payload gates. The final browser/co-simulation/native receipts distinguish
those scopes and record their exact source commits. No Actions were requested.
