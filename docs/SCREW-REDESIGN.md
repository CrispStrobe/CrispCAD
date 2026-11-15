# Optional thread redesign after resizing

Ordinary Move/Rotate/Resize stays unchanged and does not regenerate the screw on
pointer movement. For a retained screw, Properties now has a compact **Redesign
thread** disclosure. Opening it temporarily hides the regular generator fields;
closing it returns to them. Draft inputs do not edit geometry or model history.

The default keeps the original nominal pitch. The resized shaft therefore has
more or fewer turns. Choose **Turns per start** to start with the previous turn
count instead, or enter a new pitch/count explicitly. The other value updates
live. Diameter and nominal threaded length are editable too. Counts use
`threadLength / (pitch * starts)`; partial end runouts are trimmed, so the count
is nominal, not a promise of that many complete crest loops at the end faces.

Apply preflights the rebuilt design, then saves one undoable **Redesign thread**
edit. It consumes the screw's own scale into its dimensions and resets that scale
to one. Position, rotation, identity, name, colour, Solid/Hole role and material
properties remain. Undo restores the previous stretched geometry and scale.
Portable revisions and model source retain the new recipe.

The redesigned thread is circular. For unequal X/Y scales, the displayed default
diameter preserves their cross-sectional area (`oldMajorDiameter * sqrt(sx*sy)`);
the user can choose another diameter before Apply. A parent group's scaling is
not silently baked into one child: reset that scaling first. Driving expressions
on the screw's scale and attached joints are guarded by the shared transaction.
Parent rotations and unscaled retained booleans remain supported.

## Design and compatibility

The core `redesignScrew(recipe, scale, request)` function is shared by GUI and
MCP. `request` accepts major diameter, nominal thread length and either pitch or
turns per start. Omitting both keeps pitch. Changing thread length explicitly
does not resize the head a second time; head/point dimensions consume the current
radial/axial resize. Head/drive style, handedness, starts and specified point type
are retained. Old version-one screws upgrade explicitly to the version-two
contract while retaining their legacy head/thread direction.

Depth follows the original depth-to-pitch ratio, and the explicit flank angle
remains. A retained construction-overlap value lets fine pitches rebuild without
the old fixed 0.3 mm root penetration forcing an overly wide flank. Existing
recipes without this new optional value keep the old profile. Existing point
styles remain; an unspecified old tip becomes an explicit flat end with trimmed
runout during this deliberate redesign. Existing saved meshes are not silently
regenerated or normalized.

Screws now support up to 64 nominal turns per start; standalone thread/nut
limits remain 16. Tube-grid metadata supports bounded longer wires (up to 4,096
segments), and generated long ridges group adjacent samples for collision
candidates. Candidates still require the same actual-mesh 2% volume / 0.2 mm
bounds / 2,048-hull qualification. Metadata that cannot fit the compound budget
is rejected before generating all its pieces. More turns do not automatically
confer simulation readiness. No Jolt settings or fork changes are made.

The generator's size, pitch and material-remaining rules still apply. Very coarse
threads on a small diameter, excessive turn counts or unsupported dimensions
are refused without changing the model. These are generic V-thread designs,
not ISO/DIN fit or manufacturing certification.

## Headless API

`cad_redesign_screw` accepts `objectId`, `expectedRevision`, optional `diameter`,
`length`, and **either** `pitch` or `turnsPerStart`. `preview: true` evaluates and
returns the new recipe without saving an iteration. Accepted edits reset local
scale and append one portable revision. Stale revisions, invalid input, scaled
parents and scale expressions are refused transactionally. This tool uses the
existing headless project session; it does not attach to a running GUI.

Tests measure pitch directly from crest vertices, cover all seven screw
presets, direction, multiple starts, circularization, fine/long designs, undo,
source/reopen, revision guards, invalid requests and Jolt support. The catalogue
parameter gap stays at 13; springs/gears remain the next retained-mechanical work.
