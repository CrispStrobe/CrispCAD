# Visible purchased components

Scout now displays the real Adafruit 4884 Feather RP2040 and 830 4×AA holder
STEP surfaces, with original solid colours. USB, JST, chips, pads, board holes,
case seams and switch detail replace the previous solid clearance boxes.
Trident uses the same full-size Feather. Its differently sized battery placeholder
is deliberately not dressed as an incompatible 830 holder. Mantis's 28 mm board
placeholder cannot fit the real 50.8 mm Feather and remains unresolved.

The DRV8833-style illustration is original geometry: PCB, package, leads,
passives, annular pads and header pins. Its layout is illustrative, not verified
vendor PCB artwork. TT, DC and micro-servo source solids now have separate material
colours, so motor cans, gearbox plastic, caps and terminals are distinguishable.
The material palette is our own; the solid surfaces remain the pinned MIT models.

Rendering is attached to each existing body, preserving selection, drag, body
transforms and simulation poses. The display code never enters the physics
worker. Collision geometry, density, mass, ports and printed parts are unchanged.
These are display surfaces, not replacement printable mesh exports. Exact box
size and motor child-geometry guards return edited models to their own geometry.
Saved projects retain an explicit preset and source attribution, so no large
board mesh is duplicated into each project. Existing projects without the preset
retain their appearance; reopen the updated example to use the new display.

The STEP originals are byte-verified against the pinned media mirror. OCP 7.8.1.1
is an offline conversion tool only. Two source Feather blend faces under 0.01 mm²
cannot be triangulated; their areas are recorded in the derivative JSON. No mesh
is described as watertight or physics-qualified. MIT text is bundled in notices.

Validation: 40 focused tests pass (appearance, Scout, Trident, Atlas), including
provenance round trip, motor articulation, edited-geometry fallback and unchanged
print layouts. Full standalone and SDK builds succeed. An actual WebKit editor
loaded Scout without errors and produced `docs/images/scout-component-appearance.png`.
The final Lite integration and Mac build are recorded in the companion receipt.
