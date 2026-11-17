# Visible functional robot harnesses

The editor now renders coloured 3D cable tubes from existing component identities
and controlled joint ports. Scout has eleven conductors: two per TT motor,
five controller/driver connections and two battery/driver connections. Servo
harnesses have ground, supply and signal conductors. Robots without a visible
controller terminate their motor/servo harnesses at their fixed mounting body's
cable-entry surface. Ideal slider stages without a modeled motor are not dressed
with invented motor housings or leads.

This is an original routing illustration, not a fabrication pin assignment, a
new circuit solver net, cable dynamics, connector fit certification or automatic
Circuit-tab wire import. In particular the illustrative Feather/driver drawings
do not certify the Uno-based functional circuit as a physical Feather build.
The topology is derived from current motor ports/component roles; existing
Circuit wires and simulation settings are never mutated. Exact circuit net to
physical connector/pad mapping remains future work.

The wire endpoints and route anchors follow the actual owner meshes, including
preview transforms and Jolt poses. Fixed tube buffers are reused; unchanged
endpoint positions do not dirty buffers. Cables are excluded from body picking,
mass, collisions, print layout, STL export and authored history. Deleted anchors
hide their cables; rebuilding/disposal frees geometry and materials. Old examples
with the same saved component identities gain the view without project migration.

Validation: focused CAD tests and actual browser screenshots are recorded in the
Lite release receipt. The initial four suites passed 32/32, including real source
geometry, distinct endpoint movement, retained buffers, unchanged projects,
print-layout exclusion and cleanup. `docs/images/scout-wiring.png` is the actual
WebKit SDK editor, not a mockup. The final source is built and checked again
before its SDK is pinned in Lite.
