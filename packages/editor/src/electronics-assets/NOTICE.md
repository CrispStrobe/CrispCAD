# Purchased component appearances

The Feather RP2040 4884, 4×AA holder 830, METRO Mini 2590 and MPM3610 4739 meshes derive from Adafruit's
MIT-licensed STEP originals. Copyright (c) 2016 Adafruit Industries. The complete
MIT notice is retained at `library/sources/adafruit-electronics/LICENSE`.
Pinned originals, byte hashes, mirror and upstream revisions are in `sources.json`.
Reproduce with `scripts/convert-adafruit-electronics.py` using offline OCP 7.8.1.1.

Transforms are rigid, not scaled to fit. Original solid colours are preserved;
uncoloured solids use dark grey. Two Feather blend faces (each under 0.01 mm²)
that OCP cannot tessellate are recorded in the JSON. These meshes are display
surfaces, not watertight printable parts, collision certificates or new mass data.

The DRV8833-style board illustration is original BSD-3-Clause geometry, with
an illustrative component layout rather than copied PCB artwork. Motor material
palettes are original display choices over the existing MIT source solid meshes.

Appearances opt in through a saved source preset and an exact shape guard. They
follow their owning body's transform, selection and simulation pose. Existing
collision solids, mass properties and print-only layouts are unchanged. Editing
a box's dimensions or a motor's source solids disables the replacement appearance.

The shared robot assembly adds explicit approximate physical electronics bodies
and original mounting trays. Their mass and collision effects are checked by the
robot motion tests. Functional supply housings, bridge modules, servo headers,
encoder pickup and compact DC drive housings are original BSD illustrations;
no vendor hardware ratings or fabrication qualification are claimed.
