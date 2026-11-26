# Scout TT rover — PLA build guide

Scout is an original differential-drive robot built around two Adafruit 3777
yellow TT gearmotors. The assembled CAD model has independent **A / left** and
**B / right** drives, a moving chassis, a rear skid, and an electronics deck.
Its twelve structural parts, including a removable electronics carrier, are designed for PLA printing. Purchased motors,
rubber tires, batteries and electronics remain separate components.

**Physical prototype status: unprinted and untested.** Dimensions below are a
concrete first-build design. Print the shaft gauge and one cradle first, verify
them against the actual hardware, and inspect the slicer's toolpath before
committing to the full set. Mesh checks and rigid-body simulation establish
different things from a physical fit or load test.

## Open the model

The shared shape catalogue has four entries in **Robots**:

| Entry | Purpose |
| --- | --- |
| **Scout TT rover** (`robot-tt-rover`) | Complete assembly with Adafruit motor geometry, purchased-component envelopes, tires and A/B simulation joints |
| **Scout PLA print layout** (`robot-tt-rover-print`) | Twelve original PLA parts, already oriented for printing |
| **Scout shaft fit gauge** (`robot-tt-rover-fit`) | Five double-D test sockets, identified by one through five dots |
| **Scout electronics carrier** (`robot-tt-rover-carrier`) | Separate printable mount for the selected Feather RP2040 and DRV8833 boards |

The print layout arranges parts for inspection; its full spread exceeds many
printer beds. Export individual parts or use the generated individual part files.
There are **seven unique robot print parts**, plus the separate fit gauge: eight
unique STL/source designs in total. Print quantities are listed below.

The complete assembly contains purchased motor and tire bodies and an AA-pack
envelope. Use the dedicated PLA layout or individual part documents for printing.
The Feather and motor-driver blocks are labelled clearance envelopes, not
manufacturer PCB models. They are fixed to the deck so they follow the simulated
chassis. The underlying original, editable geometry is in
[`packages/editor/src/tt-rover.ts`][rover-source].

For the [ready-to-run Lite project][lite-example], download `lite/tt-rover.sb3`
from the repository alongside the build kit.
It embeds this editable assembly and a forward/turn/reverse/brake block program.
Its accompanying manifest hashes the exact document, program, archive and
licensing notices. Follow `lite/README.md` for loading instructions; the project
does not change the user's workspace preferences automatically.

## Generate and reproduce the kit

From the repository root, after installing its locked dependencies with
`npm ci`, run:

```sh
npm run robot:generate
npm run robot:check
```

Both commands build the workspace packages locally. `robot:generate` writes
`examples/scout-tt-rover/`; `robot:check` regenerates the same outputs in memory
and compares their bytes with the saved files. No GitHub Actions job is needed.

| Output in `examples/scout-tt-rover/` | Contents |
| --- | --- |
| `scout-tt-rover-kit.zip` | Complete portable build kit, including the files below |
| `scout-tt-rover.bcad` | Editable assembled robot, motor provenance and stable A/B joints |
| `scout-tt-print-layout.bcad` | Editable inventory of the twelve PLA pieces in printing orientations |
| `scout-tt-fit-gauge.bcad` | Editable five-socket fit gauge |
| `stl/chassis.stl`, `cradle.stl`, `wheel.stl`, `deck.stl`, `standoff.stl`, `skid.stl`, `carrier.stl`, `fit.stl` | Eight unique individual print meshes; use the quantity table below |
| `source/*.cadcode` | Matching original CAD Script recipes |
| `manifest.json` | Part quantities, units, bounds, volumes, triangle counts, geometry-check results and SHA-256 identities of the included source/model/notice files |
| `BUILD-GUIDE.md` | A copy of this guide |
| `LICENSE.txt`, `ADAFRUIT-MIT-LICENSE.txt`, `NOTICE.md` | Original-part and motor-derivative licensing notices |

The generator evaluates and screens every individual STL for parsing, closed
positive-volume geometry, extent and triangle limits. These checks do not
establish physical fit, material strength or full-assembly collision behavior.
The skid's generated STL and print document already apply its flange-down
rotation. Its editable `.cadcode` recipe describes the assembly orientation;
rotate a fresh standalone import 180° about X and lift it 14 before printing.

## Design dimensions

All model dimensions are millimetres. X is forward, Y is left and Z is up.

| Interface | Current design |
| --- | --- |
| Chassis | 160 × 110 × 4; X −100 to 60; assembled Z 14 to 18 |
| Drive axle | X 25, Z 32; both joint axes point along +Y |
| Motor placement | Original model translated by `[5.7, +44, 20.8]` on the left and `[5.7, −44, 20.8]` on the right |
| Wheel track | 141 between the centers of the two twin-tire wheel sets |
| Printed wheel | Ø60 rim, 8 wide; Ø20 hub, 18 total height in print orientation |
| Tire | Two purchased 56 mm ID × 3 mm cross-section O-rings per wheel; installed model OD 63 |
| Tire grooves | Two round grooves with nominal root diameter 57, at 2 and 6 from the wheel's outside face |
| Keyed shaft | Double-D: nominal Ø5.4, 3.7 across flats |
| Default wheel socket | Ø5.65, 3.95 across flats; 0.25 total allowance, 5.8 engagement in this assembly |
| Wheel clamp | 1.0 split, 3.4 clearance hole for M3, approximately 5.72 across-flats hex nut pocket |
| Motor cradle | 74 × 28.2 footprint, 2.8 floor; shallow rails stop before the output shaft |
| Electronics deck | 80 × 56 × 3; lower face at Z 46 |
| Deck standoffs | Four, Ø9 outside, Ø3.4 through-hole, 28 tall |
| Electronics carrier | 61 × 56 × 9; removable 3 mm plate with six 6 mm insulating bosses |
| Board mounting level | PCB underside at Z 58; 6 above carrier plate and 9 above deck |
| Rear skid | 32 × 20 × 14; centered at X −85 |

The assembled CAD envelope is approximately 160 × 149 × 66 before protruding
fasteners, straps and wiring. The tire starts 0.5 above the ground plane and the
skid touches it; the dynamic model settles under gravity.

The motor interface comes from the retained Adafruit STEP-derived model, rather
than a guessed rectangular motor. Its local shaft anchor is `[19.3, 0, 11.2]`,
axis `[0, 1, 0]`; the casing bounds are X −35.3 to 35.3, Y −11.3 to 9.3, and
Z 0 to 22.4. The shaft ends extend to Y ±18.3 and their keyed sections begin at
Y ±10.5. The wheel socket leaves approximately 0.2 axial clearance beyond the
shaft end in the assembled pose. The [supplier drawing][tt-drawing] and actual
motor remain the physical reference. Do not substitute a nominally similar TT
motor without checking its shaft and casing.

The front of each cradle narrows to 24 mm from local X 2 onward. This relief
cuts back both the floor lips and the ends of the side rails, so the wheel's
reinforced clamp ears can rotate past them. It leaves 0.5 mm nominal axial
clearance to the inward hub face while retaining the full shaft engagement.
The front M3 seats retain 3.3 mm of material outside the through-hole and
1.7 mm outside the countersink. Verify a full wheel revolution by hand after
assembly; actual print error, shaft runout and fastener projection still matter.

## Bill of materials

### Print in PLA

| Part | Quantity | Individual print envelope | Bed orientation |
| --- | ---: | --- | --- |
| Chassis | 1 | 160 × 110 × 4 | Broad underside down |
| Motor cradle | 2 | 74 × 28.2 × 8.8 | Flat floor down, rails up |
| Clamping wheel | 2 | Ø60 × 18 | Flat disc face down, keyed socket up |
| Electronics deck | 1 | 80 × 56 × 3 | Flat face down |
| Deck standoff | 4 | Ø9 × 28 | Bore vertical |
| Rear skid | 1 | 32 × 20 × 14 | **Flat mounting flange down**, rounded toe up; individual print document already flips it |
| Electronics carrier | 1 | 61 × 56 × 9 | Broad underside down, six PCB bosses up |
| Shaft fit gauge | 1 first | 74 × 18 × 4 | Flat face down; separate from the twelve robot parts |

The shape recipes aim to print without generated supports: wheel clamp ears have
sloped lower faces, cradles have open strap channels, and the skid prints upside
down. Inspect the small horizontal clamp holes and hex pockets in your slicer;
printer cooling and bridging performance still matter.

A reasonable initial profile is a 0.4 mm nozzle, 0.2 mm layers, four perimeters,
five top/bottom layers and roughly 30% infill. Use the filament manufacturer's
temperature settings. Extra perimeters around wheel hubs and clamp ears are more
useful than treating infill percentage as a strength guarantee. Keep the mating
faces free of elephant's foot and remove any strings from the clamp slit.

### Purchased mechanical parts

| Item | Quantity | Use |
| --- | ---: | --- |
| [Adafruit 3777 yellow TT motor][tt-product] | 2 | Left and right drive; other TT variants need a new fit check |
| O-ring, 56 mm inside diameter × 3 mm cross-section | 4 | Two elastomer tires per wheel; rubber is purchased, not printed in PLA |
| M3 × 12, 90° countersunk screws | 12 | Eight cradle fasteners and four carrier-to-deck fasteners; heads finish flush |
| M3 × 40 machine screws | 4 | Deck → standoff → chassis |
| M3 × 12 machine screws | 2 | Rear skid flange → chassis; 12 mm leaves room for a washer and full nut engagement |
| M3 × 20 machine screws | 2 | Wheel split clamps |
| Standard M3 hex nuts | 20 | Eight cradle, four deck, two skid, two clamp and four carrier; clamp pockets use ordinary thin hex nuts |
| Thin M3 flat washers | About 28 | Under nuts and non-countersunk heads as space permits, with a few spares |
| M2.5 × 16, 90° countersunk screws | 6 | Four Feather and two driver through-bolts; fit from the carrier underside before mounting it |
| M2.5 hex nuts and thin insulating washers | 6 each | Retain the boards above their printed bosses; check nearby components |
| Small reusable ties or cable ties, about 2.5 mm wide | 4 plus spares | Two per motor; thickness must fit the 1.4 mm-deep underside channels |
| Battery straps, up to about 12 mm wide | 2 | Pass through chassis slots at X −85 and −45 |
| Firm insulating pad, 6 mm thick | 1 | Between AA holder and chassis; remains at least 5 mm thick under strap pressure |

Keep countersunk cradle and carrier heads bare so they can seat in their conical recesses.
Check bolt projection with the actual washers and nuts; use a suitable longer
bolt if a chosen head, washer or nut differs substantially from this stack.
M3 × 10 skid screws leave almost no spare thread after the 7 mm plastic stack,
washer and nut, so the build recommendation is M3 × 12. The nut pockets and listed
lengths are sized around standard nuts, not thicker nylon-insert locknuts.

For the wheel clamps, keep the screw head/washer outside diameter at or below
7 mm and their combined projection beyond the ear at or below 4 mm. This
envelope retains at least 0.5 mm nominal clearance behind the relieved cradle.
A 5.5 mm-diameter, 3 mm-high M3 socket head with a 0.5 mm-thick, 7 mm-diameter
washer fits that envelope; check the actual hardware. Rotate the free wheel
for tool access, especially on the right where the screw initially faces down.

The split clamp retains the printed wheel without relying on the motor's axial
shaft bore. That bore is not a verified M2 machine thread. Adafruit's own
[3777 shaft-screw discussion][shaft-screw] records variation and unsuccessful M2
and M2.5 fits. A bought [Adafruit 3757 wheel][bought-wheel] with its supplied tire
and screw is a compatible hardware alternative, but its dimensions and geometry
are not the Scout printed wheel.

### Electronics for a physical prototype

| Item | Quantity | Current role |
| --- | ---: | --- |
| [Adafruit 830 switched 4×AA holder][aa-holder] | 1 | Motor power pack, strapped to chassis |
| Matched rechargeable NiMH AA cells | 4 | Nominal 4.8 V pack; use an appropriate external charger |
| [Adafruit DRV8833 breakout, 3297][drv8833] | 1 | Two motor channels with the board's default current limiting retained |
| Feather-format 3.3 V controller, such as [Feather RP2040, 4884][feather-rp2040] | 1 | Controller candidate; firmware and physical transport require a separate implementation |
| USB power source/cable for the controller | 1 | Separate logic power during initial bench testing |
| Insulated wire and connectors | As needed | Secure wiring to the printed carrier and slotted deck |

The AA holder's official dimensions are approximate: 2.5 × 2.75 × 0.75 inches,
with ±0.1 inch stated tolerance. The model reserves **66.1 × 72.4 × 21.6** at
`[-65.5, 0, 34.8]`, including a coarse size allowance. Its underside is 6 above
the chassis for the insulating pad. The skid mounting bolts can project to about
Z 23, so the nominal pad leaves 1 mm below the battery holder. Use a firm pad or
hard insulating support that does not compress below 5 mm under the straps, and
cover any exposed bolt tips. Confirm the actual holder and keep its switch and
cover accessible. The simulation's pack mass is illustrative.

The printed carrier supplies through-bolt positions for the Feather and
DRV8833 revisions below. Its four M3 mounting holes fit the existing deck
slots; the deck and its 28 mm posts retain their original dimensions.

The assembled CAD model (since the all-robot electronics update) shows the
shared simulation electronics instead of the two board envelopes: a METRO Mini
(45 × 18 × 6), an MPM3610 5 V regulator (11 × 18 × 4) and a dual H-bridge
(26 × 18 × 8) on an 88 × 62 × 2.4 printed tray, Z 59.5–61.9, carried 7.5 mm
above the carrier on four Ø5.2 posts at carrier X −2, Y ±14 and X 32, Y ±5.
The right-hand posts stand between the M3 carrier-to-deck screws, at least
4 mm from their Ø6.6 head recesses. Four Ø8 access holes in the tray sit over
those screws at X 25/39, Y ±12.5: a 4 mm screwdriver reaches every head with
the tray and boards installed (2 mm radial clearance in the tray), and an M3
countersunk head (Ø6.72 maximum) passes through the tray. The boards stay
clear of the driver path. These are component envelopes, not vendor PCB meshes.

A two-channel reflective encoder pickup for drive A (12 × 8 × 17 envelope,
including its printed mounting block) is screwed to the chassis top in front of
the left motor, X 44.5–56.5, Y 47–64, Z 18–26, overhanging the chassis edge by
9 mm. Its face looks along +Y at the left wheel's inner rim face (Y 66.5,
radius 25–30 mm about the axle) through a 2.5 mm gap; both emitter/detector
pairs sit at radius 25.1 and 29.7 mm. Apply a two-track stripe ring to that rim
face for it to read. The pickup stays outside the wheel hub's swept radius
(under 16 mm) and short of the rim, so the drive A hinge-clearance proof still
holds. The 3777 motors themselves have no encoders.

## Removable electronics carrier

The original BSD-3-Clause carrier replaces the previously unspecified insulated
board carrier. It prints as one flat piece with six upright bosses, using no
snap fits, heat-set inserts or self-tapping threads. Two board islands
and an overlapping joining web leave the four existing deck-post screw heads exposed.
All four carrier-to-deck screws sit outside both PCB outlines, so a 4 mm
screwdriver shaft can reach their heads with the boards installed. This allows
the builder to counterhold each screw while tightening its nut beneath the deck.
The bottom countersinks have 45-degree walls; inspect the slicer preview and
remove elephant's foot before seating their heads. Both rows of deck fasteners are
shifted 1.5 mm toward the centre along their slots to clear the nearby post: use an M3 washer no more
than 7 mm outside diameter there, leaving about 1.55 mm nominal clearance to the
Ø9 post. Keep the existing deck-post screw heads and washers at or below
7 mm outside diameter too: the right-hand carrier island leaves 0.5 mm nominal
clearance to their edges. Verify the real hardware, tool access and print
tolerances before tightening.

The two board layouts were checked against Adafruit's exact fabrication data.
These are dimensional references only: no PCB artwork or another mount design
is redistributed or used as carrier geometry.

| Interface | Source dimensions | Position in the carrier |
| --- | --- | --- |
| [Feather RP2040 Rev B PCB][feather-layout] | 50.8 × 22.86 outline; mounting-hole centres `(2.54, 2.54)`, `(2.54, 20.32)`, `(48.26, 2.54)`, `(48.26, 20.32)`; source drill Ø2.50 for the two plated USB-end holes at X 2.54, Ø2.54 for the two unplated far-end holes at X 48.26 | Rotate the centred PCB +90° about Z: bosses at X ±8.89 and Y ±22.86; USB faces −Y |
| [DRV8833 PCB][driver-layout] | Outline X −2.286 to 15.494 and Y −1.27 to 24.13; mounting-hole centres `(12.954, 1.27)` and `(12.954, 21.59)`; source drill Ø2.50 for both plated holes | Centre the PCB, rotate +90° about Z, then move +32 in X: bosses at `(21.84, 6.35)` and `(42.16, 6.35)` |
| Carrier to deck | Four Ø3.4 bores and upper 90° countersinks, nominal Ø6.6 opening | `(25, -12.5)`, `(25, 12.5)`, `(39, -12.5)`, `(39, 12.5)`, within the existing driver-side deck slots |
| Boards to carrier | Six Ø2.8 through-bores; Ø5 bosses; underside 90° countersinks, nominal Ø5.6 opening | Printed plate Z 0–3; bosses Z 3–9; nominal 6 mm gap under each PCB |

Before assembly, compare the real boards' hole centres and connector direction
with this table, and check that the actual M2.5 screws pass freely through the
PCB mounting holes. The source drill sizes are not printed clearance allowances.
The Feather source is pinned to commit
`ea88166891ee0a1697a3899a5d55ab3722a2f125`, file `Adafruit Feather RP2040 rev B.brd`;
the driver source is pinned to `dda79a86d6518d05a35091cb8b03b9c0d57d04e2`, file
`Adafruit DRV8833.brd`. The [Feather specification][feather-spec] also documents
the classic outline and hole diameter, while the [driver fabrication page][driver-fab]
provides a dimensioned drawing. Other Feather boards and similar motor-driver
breakouts are not automatically compatible.

1. Seat the six M2.5 × 16 countersunk screws from the carrier underside, with
   every head flush or recessed. The printed holes are clearance bores: do not
   cut threads into the bosses. Clear a tight bore gently and reject a print
   whose bosses crack. Head shape and actual print compensation still need a
   fit check.
2. Put the four M3 × 12 countersunk carrier screws through the upper recesses.
   Their heads remain accessible beside the driver board. Mount both boards over
   the M2.5 screws and bosses, using insulating washers
   beneath the top nuts. Tighten gently so that the PCB stays flat. Installing
   the screws and boards on the bench retains access to the lower screw heads;
   do this before bolting the carrier to the deck.
3. Confirm every board underside is clear of solder tails and components. The
   M3 heads must be flush to retain the full nominal 6 mm clearance. This is an
   allowance for inspection, not a qualification of arbitrary headers. The
   board screws extend above the nuts; trim or substitute a suitable length
   if an added shield or enclosure needs that space. No stacked FeatherWing
   envelope has been qualified.
4. Lower the carrier onto the deck, put its M3 screws through the four matching
   slots, and install washers and nuts below. With a nominal 1.6 mm PCB, 0.5 mm
   washer and 2 mm nut, the M2.5 stack is about 13.1 mm from the carrier underside;
   a 16 mm screw leaves roughly 2.9 mm above it before countersink seating
   variation. The M3 stack is approximately 8.9 mm with one 0.5 mm washer and a
   2.4 mm nut; verify the actual hardware and its projection below the deck.
5. Route the Feather USB cable toward −Y and wires away from the wheel sweeps.
   Keep access to USB, reset/boot controls, driver terminals and all fasteners.
   Anchor cables with light ties through unused deck slots; do not clamp a tie
   across exposed PCB components.

The carrier's retained `boardClearance` accepts 6–20 mm and `boardBore` accepts
2.6–3.0 mm; values outside these design bounds refuse geometry evaluation. The
stock values are 6 and 2.8 mm. The bore cut follows the boss height, so a taller
post remains open all the way through. These ranges retain the nominal solder
gap and at least 1 mm nominal radial wall at the largest bore; they are editing
bounds, not a physical strength qualification. Changing boss height also requires
moving the component envelopes by the same amount and rechecking fastener
lengths and collision candidates. The four long deck posts set the height of the entire deck; changing
them does not change board-to-carrier clearance. Physical fit, thermal behaviour
near the driver and fastener retention remain to be checked on a printed unit.

## Fit gauge and tolerances

The dots identify increasing **total** allowance: the number is added once to
the diameter and once to the across-flats dimension, rather than to each side.

| Dots | Total allowance | Socket diameter | Across flats |
| ---: | ---: | ---: | ---: |
| 1 | 0.15 | 5.55 | 3.85 |
| 2 | 0.25 | 5.65 | 3.95 |
| 3 | 0.35 | 5.75 | 4.05 |
| 4 | 0.45 | 5.85 | 4.15 |
| 5 | 0.55 | 5.95 | 4.25 |

Print the gauge using the same filament and profile planned for the wheels.
Try it on both motors, gently and without forcing a shaft sideways. Select a
socket that slides onto the keyed section by hand with little rocking. The
default wheel uses the two-dot 0.25 allowance. The gauge is 4 thick, while the
wheel engages 5.8, so follow it with one full hub/wheel fit check.

Edit the retained wheel CAD Script's `clearance` parameter for both wheels when
needed, or change the shared recipe before regenerating the part files. Recheck
fit after changing printer compensation, filament or layer height. Clearance
values are starting points, not calibrated machine-independent tolerances.

## Assembly sequence

1. **Prepare the prints.** Inspect for incomplete layers, fused clamp slits,
   distorted floors and obstructed holes. Fit an M3 nut into each wheel pocket
   and check bolt passage before mounting the wheel on a motor.
2. **Mount the cradles.** Thread two motor ties through each cradle's underside
   channels before seating it on the chassis. Install four countersunk M3 × 12
   screws per cradle, from the cradle floor through the chassis, with washers
   and nuts beneath. Every screw head must sit flush below the motor.
3. **Seat both motors.** Both motor bodies point the same way: the long motor
   cans face toward the rear battery bay and the output shafts sit toward the
   front. The shallow rails end before the shafts. Secure the ties around the
   housings, leaving terminals and shafts clear. Do not distort the gearbox by
   overtightening.
4. **Fit the tires.** Seat two O-rings in each wheel's grooves. The 56 mm nominal
   ID stretches slightly onto the 57 mm groove root. Actual compound and
   tolerance affect fit; the O-rings should sit evenly without rolling out.
5. **Install the wheels.** Turn the blind keyed sockets inward, toward the
   motors, and slide them on. Check the intended engagement and end clearance;
   the hubs must not rub the casing or cradles. Insert an M3 × 20 clamp screw
   and its captured nut. Tighten only enough to retain the wheel. Stop if the
   slit closes completely or the plastic starts whitening or cracking. No
   clamp torque or pull-off load has been physically qualified.
6. **Attach the rear skid.** Its rounded toe faces the floor and its flange
   meets the underside of the chassis. Put the two M3 × 12 screws upward from
   below the flange through the X −96 and −74 holes, with washers and nuts on
   the chassis. Cover the protruding tips and maintain the battery-pad clearance
   described above. The skid is replaceable as it wears.
7. **Assemble the deck.** Put the four 28 mm standoffs at X −20/40 and Y ±22.
   Pass four M3 × 40 screws through the deck, standoffs and chassis. Use washers
   and nuts, and keep the deck level without compressing the printed spacers.
8. **Secure the power pack and electronics.** Place the firm 6 mm insulating pad
   and AA holder in the rear bay, check clearance over the skid-bolt tips, then
   route both straps through the chassis slots.
   Assemble the printed carrier and its PCB bolts as described above, then bolt
   it through the existing deck slots. Leave the holder switch, battery lid,
   board controls and controller USB accessible.
9. **Check free movement.** Lift the drive wheels and turn them by hand. Check
   both hubs, cradles, wires, tires and the rear skid for interference. Keep
   wires outside the wheel sweep and leave strain relief near motor terminals.

PLA clamp force, repeated service life and skid friction need physical testing.
This first design is suitable for investigating a lightweight indoor prototype;
there is no payload, outdoor-temperature or impact rating.

## Electrical interface and first powered checks

The [3777 product specification][tt-product] gives a 3–6 V motor range and no
built-in encoders. Adafruit measured approximately 1.1 A stall current at 3 V,
1.2 A at 4.5 V and 1.5 A at 6 V. Those observations explain the driver choice:
the [DRV8833 board][drv8833] has two H bridges and defaults to approximately 1 A
current limiting per channel. Retain that limiting during initial tests and
follow its [pinout and wiring guide][drv-guide]. Motors connect to the driver,
and the controller supplies logic signals.

The intended initial power arrangement is:

| Connection | Arrangement |
| --- | --- |
| Motor supply | Switched 4×NiMH AA holder → DRV8833 motor supply |
| Left motor | One complete DRV8833 output channel |
| Right motor | The other output channel |
| Logic supply | Feather's USB connector from a suitable USB source |
| Reference ground | Feather GND, driver GND and motor-pack negative connected together |
| Control signals | Two suitable 3.3 V logic/PWM signals per motor channel, plus any enable/sleep wiring required by the driver guide |

GPIO numbers are deliberately left to the selected controller firmware. The
motor pack is not wired to the Feather's 3.3 V or LiPo input. A fresh four-cell
alkaline pack can be about 6.4 V according to the [holder specification][aa-holder],
so it is not interchangeable with the nominal 4.8 V NiMH choice without checking
the motor-supply arrangement. The AA cells charge outside the robot with a
compatible NiMH charger.

Make the first powered check with the wheels raised, low commanded output and
the motor-power switch within reach. Confirm that each channel stops, then
check each wheel's forward direction before lowering the robot to the floor.
Swap a motor's leads or invert that channel in firmware if necessary. Increase
load gradually and check motor/driver heating and wheel retention. The model
contains no temperature, stall, current, battery-discharge or wire simulation.

## CAD and BrickWright controls

Ports are fixed in the document, independent of translated display names:

| Port | Joint | Function |
| --- | --- | --- |
| A | `drive-a` | Left wheel drive |
| B | `drive-b` | Right wheel drive |

Both hinges use the same global +Y axis. Equal positive commands roll toward
+X; equal negative commands reverse. Opposite signs produce a turn in place,
subject to contact friction and the skid. Keep **Fix first body as base** off
for the assembled rover. Ground and gravity are enabled in its document.

Start the A and B velocity commands together before waiting, then stop both.
Running a blocking angle-travel instruction for A and subsequently another for
B drives them in sequence. The controller's angle and speed readings are
simulated joint values. The physical 3777 motors have no encoders, so they
cannot reproduce degree-accurate wheel travel from this model alone; that needs
real feedback, calibration and controller firmware.

In Lite, enable **CAD Editor** under **Settings → Workspace**, insert the
assembled rover and add the **CAD models** extension. The following uses the
existing [CAD pseudocode dialect][lite-cad]. Convert it with **To blocks** and
run it using the green flag:

```text
WHEN green flag clicked:
  cad start
  cad run motor A at 120 degrees per second
  cad run motor B at 120 degrees per second
  wait 2 seconds
  cad stop motor A brake
  cad stop motor B brake
  wait 0.5 seconds
  cad run motor A at -90 degrees per second
  cad run motor B at 90 degrees per second
  wait 1 seconds
  cad stop motor A brake
  cad stop motor B brake
  wait 1 seconds
  cad stop
```

The first segment commands straight travel; the second commands a pivot. The
wait durations are illustrative and do not specify a measured distance or turn
angle. Both nonblocking velocity commands are issued before each timed wait.

The CAD motor model is an ideal hinge actuator. Its torque setting is not a
measured electrical model of a 3777. Ground friction, skid friction, printed-part
mass from solid geometry, and battery mass are illustrative. A path trace is
useful for comparing commands, but is not a physical odometry measurement.

### Qualified collision geometry

The displayed and printed solids retain the original manufacturing detail.
Simulation uses reproducible compound candidates with fewer facets, including
the keyed sockets, clamp splits, mounting holes and tire grooves. Every start
compares those candidates against the live solid using the existing 2% volume
difference and 0.2 mm bounds limits. The scene keeps the existing 4,096-piece
budget; serialized certificates are never treated as proof of qualification.
Editing a part's CAD Script invalidates its saved candidates, and undo restores
the previous program and candidates together.

To regenerate or verify the stock simulation candidates after changing the
shared recipes, run these before regenerating the print kit:

```sh
npm run robot:collisions:generate
npm run robot:collisions:check
npm run robot:generate
npm run robot:check
```

Collision qualification measures geometric approximation. It does not establish
the strength, fit, friction or electrical performance of a physical robot.

`npm run robot:verify` separately runs the complete assembled robot through
settling, forward travel, braking, reverse travel and a differential turn at
the editor's default 0.02 Nm motor limit. It checks finite poses, moving-base
travel, joint-frame alignment and floor penetration. The saved local results
are engineering evidence for the simulation and are separate from physical
prototype testing.

The current Lite connection drives the shared CAD simulation through its SDK.
A physical Adafruit controller transport and deployment workflow are separate
work. Selecting this rover does not install firmware or connect to a real motor
driver.

## Source, export and licensing

The chassis, cradles, wheels, deck, standoffs, skid, carrier, gauge and simple component
envelopes are original Brickwright designs under the repository's
[BSD-3-Clause license][brickwright-license]. Their retained CAD Script supports edits and
individual STL regeneration. Export those printed components in millimetres.
The complete assembly is useful for visualization, joint control and fit
inspection; it is not one combined printable object.

The two motor models reuse the existing Adafruit derivatives and their original
MIT provenance. Their source is pinned to
[`adafruit/Adafruit_CAD_Parts` at `9f2a89f3d5c3491886d58cb7fe83385417563cf4`][adafruit-source].
Retain the complete [Adafruit MIT notice][adafruit-license]
and the model's attribution when distributing those derivatives. The motor
generator records its coordinate transform and tessellation changes in the
saved document. Existing [attribution export rules][attribution] apply.

The [Adafruit archive][archive-guide] also contains the Feather, AA
holder and servo CAD files, but archive inclusion is not geometry, mounting or
manufacturing qualification. This rover uses simple, labelled electronic
keep-outs instead of silently treating those other meshes as validated parts.

Local geometry, document, export and simulation checks should be run through
the repository's build and test tools. Record their actual result separately
from the future physical print, assembly and drive tests. GitHub Actions is not
required for this build workflow.

[tt-product]: https://www.adafruit.com/product/3777
[lite-example]: https://github.com/CrispStrobe/brickwright-cad/tree/feat/printable-robot-20261115/examples/scout-tt-rover/lite
[tt-drawing]: https://cdn-shop.adafruit.com/product-files/3777/3777_diagram.jpg
[shaft-screw]: https://forums.adafruit.com/viewtopic.php?t=136463
[bought-wheel]: https://www.adafruit.com/product/3757
[aa-holder]: https://www.adafruit.com/product/830
[drv8833]: https://www.adafruit.com/product/3297
[drv-guide]: https://learn.adafruit.com/adafruit-drv8833-dc-stepper-motor-driver-breakout-board/pinouts
[feather-rp2040]: https://www.adafruit.com/product/4884
[feather-spec]: https://learn.adafruit.com/adafruit-feather/feather-specification
[adafruit-source]: https://github.com/adafruit/Adafruit_CAD_Parts/tree/9f2a89f3d5c3491886d58cb7fe83385417563cf4
[lite-cad]: https://github.com/CrispStrobe/brickwright/blob/fc333ddf88023cf17e9bb5973109b74a350f2ab7/docs/CAD-EDITOR.md
[rover-source]: https://github.com/CrispStrobe/brickwright-cad/blob/feat/scout-tt-integration-20261116/packages/editor/src/tt-rover.ts
[brickwright-license]: https://github.com/CrispStrobe/brickwright-cad/blob/53581e9cbd2565e9e088c8fcd52fb1ba5c739b09/LICENSE
[adafruit-license]: https://github.com/CrispStrobe/brickwright-cad/blob/53581e9cbd2565e9e088c8fcd52fb1ba5c739b09/library/sources/adafruit-motors/LICENSE
[attribution]: https://github.com/CrispStrobe/brickwright-cad/blob/53581e9cbd2565e9e088c8fcd52fb1ba5c739b09/docs/MODEL-ATTRIBUTION.md
[archive-guide]: https://github.com/CrispStrobe/brickwright-cad/blob/53581e9cbd2565e9e088c8fcd52fb1ba5c739b09/docs/ADAFRUIT-CAD-ARCHIVE.md

[feather-layout]: https://github.com/adafruit/Adafruit-Feather-RP2040-PCB/blob/ea88166891ee0a1697a3899a5d55ab3722a2f125/Adafruit%20Feather%20RP2040%20rev%20B.brd
[driver-layout]: https://github.com/adafruit/Adafruit-DRV8833-Motor-Driver-Breakout-PCB/blob/dda79a86d6518d05a35091cb8b03b9c0d57d04e2/Adafruit%20DRV8833.brd
[driver-fab]: https://learn.adafruit.com/adafruit-drv8833-dc-stepper-motor-driver-breakout-board/downloads
