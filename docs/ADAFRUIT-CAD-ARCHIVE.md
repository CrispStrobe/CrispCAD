# Adafruit CAD archive

The shared editor includes a compact index of the original Adafruit CAD Parts
collection. Each card represents one upstream folder; select any original file
to download it after its exact size and SHA-256 are verified. Files are fetched
only when selected, without credentials, and may be cached by content hash for
offline reuse. Opening the library does not fetch model files. The embedded SDK
uses the same index and browser cache as the standalone app; hosts can provide a
cache adapter through `ModelLibraryOptions`.

The snapshot is pinned to Adafruit commit
`9f2a89f3d5c3491886d58cb7fe83385417563cf4`. The indexed mirror commit, exact
paths and hashes are in `packages/editor/src/adafruit-archive-data.ts`; the
mirror retains every original file and its root MIT notice. The archive index is
separate from the qualified model catalogue: STEP, Fusion, STL and other files
have not been screened merely by being listed. For an STL, a user may explicitly
choose units and up axis and request insertion; the exact file is checked and
strictly screened on demand before insertion, and the choice is retained in
provenance. Files exceeding the analysis budget or failing screening remain
downloadable. STL does not reliably declare units. Dimensions, units, axes and
manufacturing suitability must be established independently before use. No
collision qualification is implied.

Adafruit's root MIT license and README were reviewed. The upstream tree has no
other files with license/copyright/notice/copying/readme names; this filename
check does not inspect embedded binary notices. Original and mirror content
remain attributed to Adafruit Industries. The license text is shown for each
folder, and the original license file is also downloadable in the root-files
card.
