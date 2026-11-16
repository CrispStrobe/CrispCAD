# Scout TT rover — Brickwright Lite demo

`tt-rover.sb3` contains the complete editable Scout TT assembly and a block
program that drives both wheels, brakes, pivots, reverses and stops. It uses
port **A** for the left wheel and **B** for the right wheel.

## Open and run

1. Use a Brickwright Lite build with the CAD Editor and a shared CAD SDK that
   supports the Scout TT mobile base and its collision geometry.
2. Enable **Settings → Workspace → CAD Editor**.
3. Choose **File → Load from your computer** and open `tt-rover.sb3`.
4. Open the **CAD** tab to inspect the robot, then press the green flag.
   The VM stop button also stops pending CAD commands.

The program starts both wheel speeds before each wait, so they run together.
Equal positive speeds drive forward; the opposite speeds produce a pivot.
The program is already compiled into blocks. Its editable text is in
`tt-rover-program.txt`; in Lite, use the Code tab and **To blocks** to change it,
or edit the **CAD models** blocks directly.

These commands drive the CAD simulation's ideal actuators. They do not send
commands to a physical Adafruit controller. The stock TT motors have no
physical encoders. Simulation timing, angle and motion are not measurements
of a built robot's performance.

## Files and provenance

| File | Purpose |
| --- | --- |
| `tt-rover.sb3` | Loadable Scratch project, including the model, program and notices |
| `tt-rover.bcad` | Exact assembled CAD source, also embedded at `brickwright/cad.json` in the SB3 |
| `tt-rover-program.txt` | Readable two-wheel demonstration program |
| `ADAFRUIT-MIT-LICENSE.txt` | Complete license for the Adafruit TT motor mesh derivatives |
| `BRICKWRIGHT-BSD-3-CLAUSE.txt` | Complete license for original geometry and program |
| `manifest.json` | Document/program format, A/B roles and SHA-256 hashes of the five distributed artifacts |

The SB3 includes both full notices under `brickwright/licenses/`. The BCAD
preserves the vendor mesh source and provenance records. The artifact manifest
is independent of the SDK revision: compatibility is checked separately, so
updating the SDK does not require changing these saved files.

From a prepared Brickwright Lite checkout, verify this directory using its
currently pinned SDK:

```sh
node --import ./scripts/lib/register-gui-scope.mjs \
  scripts/verify-cad-rover-project.mjs \
  /path/to/brickwright-cad/examples/scout-tt-rover/lite
```

The validator reports the SDK commit, checks the five file hashes and confirms
the SB3 contains the exact CAD source, A/B hinges, program and notices. It does
not modify the saved artifacts.

For PLA parts, the fit gauge, hardware list, assembly procedure and physical
prototype limitations, see the [Scout TT build guide](../../../docs/PRINTABLE-TT-ROVER.md)
and the [print kit](../).
