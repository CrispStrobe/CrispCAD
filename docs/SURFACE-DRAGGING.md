# Surface dragging and responsiveness

**Snap to surfaces** is enabled when no preference has been saved. The magnet
button or `C` toggles it; the host saves the choice outside model history.
Select mode supports dragging an existing shape onto another shape, including a
wall or inclined face. The target face lights up. The selection is carried as a
rigid group onto that face, preserving relative positions and scale factors.

`Alt` temporarily bypasses contact snapping during an existing-object drag. With
the magnet off, dragging keeps the previous plane-based behavior. Explicit axis
Move/Rotate/Scale controls remain available for precise transforms. Grid spacing
and Fine still control increments independently. Surface snapping does not scale,
combine or permanently mate the objects.

A drag previews without editing the document. Release commits one transform;
Escape or pointer cancellation restores the original poses. Live Properties and
optional on-canvas numbers show the pending pose. Driven expressions continue to
protect their fields; a refused transform does not change the model.

Autodesk calls the related drag/stack/assembly workflow
[Cruise](https://www.tinkercad.com/blog/cruise), described in its
[getting-started guide](https://images.tinkercad.com/jl5ii4oqrdmc/4nMtGEJi53o3n7V2KJKG7a/0b1818fdecff4868bebc74ebeaf925cf/Tinkercad_Getting_Started_Guide_printable.pdf).
Our default-on behavior follows the owner's preference. This is an original
implementation using public behavioral documentation, not reference source/UI
assets or a claim of identical behavior in every Tinkercad mode.

## Work removed from the drag path

- The shape palette now has an opaque background. It no longer applies a blur
  to the whole WebGL canvas behind it. One software-rendered Chromium scenario
  spent most of its trace opening/filtering that palette and exceeded its
  deadline; the opaque version passed the same scenario and all six basic-shape
  browser cases. Shared-host load varied, so elapsed times are observations, not
  a controlled rendering benchmark.
- Smoothed display geometry duplicates vertices at triangle/crease boundaries.
  Exact bounds now use the compact evaluated source buffer. Cached bounds handle
  translations without rescanning vertices, including translation following a
  rotation. Rotated/scaled bounds are still exact; this does not substitute an
  approximate transformed bounding box for vertex extrema.
- Pointer events are coalesced: the latest pending movement is processed once per
  animation frame. Release flushes the final event before committing, so the
  displayed endpoint and saved transform agree. Cancellation discards pending
  events. Surface targeting excludes the moving selection and other hole/helper
  bodies, and avoids an extra raycast during rendering.

Tests compare cached bounds with direct vertex extrema, check unchanged scales
and relative poses on top/wall/oblique surfaces, and verify a 100-event burst is
coalesced while retaining its final target and one committed edit. These operation
checks do not establish a universal frame rate on every model/device.
