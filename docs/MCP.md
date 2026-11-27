# CAD code through MCP

The original stdio MCP server uses the same bounded compiler, retained document
and Manifold evaluator as the GUI. It operates a **headless project session**;
it does not attach to a running Mac/iPad editor window. Live GUI attachment is a
later host integration. Source or parameter edits made here can be opened in
the GUI through the complete `.bcad` project.

Build packages first, then configure your MCP client with absolute paths:

```sh
npm ci
npm run build
node apps/mcp/server.mjs --project /absolute/path/design.bcad
```

```json
{
  "mcpServers": {
    "brickwright-cad": {
      "command": "/absolute/path/to/node",
      "args": [
        "/absolute/path/brickwright-cad/apps/mcp/server.mjs",
        "--project", "/absolute/path/design.bcad"
      ]
    }
  }
}
```

Requires Node 22.18+. Add `--locale de` for German tool descriptions, help and diagnostics; protocol identifiers and source remain unchanged. Omitting `--project` gives an in-memory session; export it
before closing. Avoid wrappers that write npm startup messages to stdout.
The configured file is created if absent, or resumed with its entire saved
history. Use a dedicated file: this process is its writer until closed.

| Tool | Purpose |
| --- | --- |
| `cad_code_help` | Grammar, constructors, limits and example |
| `cad_get_model_source` | Read the complete retained design source and revision |
| `cad_apply_model_source` | Preflight a source draft, or accept it as one history step |
| `cad_get_model` | Current revision and root object metadata |
| `cad_get_code_object` | Object source, local parameters and placement |
| `cad_preview_code` | Compile/evaluate source without saving |
| `cad_create_code_object` | Validate and commit a retained coded body |
| `cad_update_code_object` | Change source/overrides while preserving identity |
| `cad_list_revisions` | Paginated iteration metadata |
| `cad_restore_revision` | Append a restore, preserving later work |
| `cad_export_project` | Base64 complete history-inclusive project |
| `cad_inspect` | Read-only per-body volume, area, bounds, centroid and topology, with object kinds, placements, code parameters and joints |
| `cad_check_interference` | Read-only overlapping body pairs (common volume) and, with `clearanceMm`, near misses |
| `cad_render` | Read-only PNG views (iso/top/front/right/back/left/bottom) returned as MCP image content |
| `cad_check_printability` | Read-only FDM screening of the current model: watertightness, sampled minimum wall, overhangs/bridges, bed fit, six ranked axis orientations |
| `cad_export_stl` | Base64 printable mesh; automatic paired attribution for recorded library sources |
| `cad_export_step` | Read-only exact STEP (AP214) as base64 from the optional exact B-rep kernel; `objectIds` limits the bodies; unsupported bodies fail with a diagnostic naming body and feature |
| `cad_measure_exact` | Read-only exact volume, area, bounds and centroid per body from the exact kernel |
| `cad_fastener_table` | Read-only ISO fastener tables: clearance holes (ISO 273), tap drills, heads, nuts, washers, counterbores, heat-set inserts, stocked lengths |
| `cad_add_hole` | Add a standard hole (clearance, tapped, counterbore, countersink, heat-set pocket; document version 47) as one saved step |
| `cad_fasten` | Place the ISO screw, washers and nut (or insert) each standard hole is made for, as one saved step |
| `cad_insert_part` | Insert one ISO standard part (screw, nut, washer, heat-set insert) as one saved step |
| `cad_list_commands` | Read-only list of the shared command vocabulary with typed arguments |
| `cad_run_commands` | Run terminal commands headlessly; all edits become one history step |

Read `cad_get_model`, then send its `revision` as `expectedRevision` for every
mutation. Creation needs `source`; optional `name` and `parameters` supply its
name and a map of local expression overrides. Updating needs `objectId` and
optionally source and/or parameters. A supplied parameters map replaces the
previous overrides; `{}` restores all source defaults. Stale revisions are
refused. Preview does not advance the revision. Tool failures return `isError`.

Changes preflight the complete model before atomically replacing the configured
file. Existing iteration IDs, ancestry, hashes and content are retained; restoring
creates a new branch head without discarding subsequent iterations. The process
uses a `.mcp-lock` writer lock and refuses a competing writer or externally changed
file. A crashed process may leave a lock: inspect its PID before manually removing
it. Open/import a copy into the GUI, and close the server before exchanging edits;
the lock does not lock other applications' library or IndexedDB storage.

Project archives are capped at 64 MiB and never pruned to fit. The headless edit
surface caps a current model at 1 MiB; inline project/STL exports are capped at
3 MiB (before base64). Use the configured project file for larger archives and the
GUI for larger plain mesh exports. Recorded library sources require accurate
`modificationNotes` describing changes since insertion (including when unchanged).
Such STL exports return one `brickwright-attributed-stl` response with a `files`
array containing STL and attribution JSON; distribute both together. The combined
pair must fit the 3 MiB limit. The GUI currently refuses attributed STL and 3MF
exports pending paired delivery support. See [attribution export](MODEL-ATTRIBUTION.md). Geometry runs in a worker with a 30-second watchdog.
MCP JSON messages are limited to 256 KiB. Cancellation is checked before acceptance;
a final atomic file commit may already have completed when cancellation arrives.

Transport is newline-delimited UTF-8 JSON-RPC on stdin/stdout; diagnostics go to
stderr. Initialization negotiates MCP versions 2024-11-05, 2025-03-26,
2025-06-18 or 2025-11-25. Tools expose JSON schemas, text responses and, on newer
protocols, structured content. There is no arbitrary file path or script-execution
tool. The implementation adds no runtime MCP dependency. Local interoperability
was verified with the official TypeScript MCP SDK client, including initialization,
tool discovery, coded geometry creation and stale-revision refusal.

Protocol references: [stdio transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
and [tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools).

`cad_code_help` also returns `examples`: the 34 original GUI examples with stable
IDs, localized titles, retained source and empty initial parameter overrides.
Use a source with `cad_preview_code`, then create with the expected current
revision. Listing examples never changes the headless project or history.

`cad_compile_blocks` is read-only. Supply a block program as JSON text (format
`brickwright-cad-blocks`, see [block modelling](CAD-BLOCKS.md)) and outputFormat
(cadcode/openscad/jscad). It returns parametric source; pass CAD Script output to
`cad_create_code_object` to add it to the model.

`cad_convert_code` is read-only. Supply source, inputFormat (cadcode/openscad/jscad),
outputFormat (cadcode/openscad/jscad), optional parameter overrides and optional
JSCAD entryPoint/arguments. Results identify snapshots and return warnings plus
JSCAD separate-output metadata. It neither modifies the model nor adds history.

## Shared design source

`cad_get_model_source` returns the same stable-ID design language used by the GUI
source dock. Send `source` and its `expectedRevision` to `cad_apply_model_source`.
With `preview: true`, it evaluates without saving; otherwise an accepted change
creates one iteration. No-op edits do not append history. Generated recipes use
the same part factory as the editor. Source input is capped at 65,536 characters;
project-contained mesh assets and immutable attribution stay in the project.
See [the language and GUI workflow](UNIFIED-DESIGN-SOURCE.md).


Retained screws can be rebuilt after local scaling with `cad_redesign_screw`: read
the current revision, supply `objectId` and `expectedRevision`, and optionally
`diameter`, `length` and either `pitch` or `turnsPerStart`. `preview: true` saves
nothing. Acceptance appends one revision and resets local scale. See
[thread redesign](SCREW-REDESIGN.md) for defaults and guards.

## Printability screening

`cad_check_printability` evaluates the current model in the geometry worker and
returns, per solid body, edge-manifold topology, a sampled minimum wall thickness
(one inward ray per triangle), overhang regions classified as unsupported, bridged,
first-layer or short-reach, bed contact/tip risk, and the six axis-aligned build
directions ranked best first. Optional settings: `nozzleMm` (0.4), `maxOverhangDeg`
(45), `maxBridgeMm` (10), `minWallMm` (0.8) and `bedXMm`/`bedYMm`/`bedZMm`
(220/220/250). Results are tessellation-bounded screening, not a slicer result
or print guarantee. The mesh algorithms are adapted MIT code from kernelCAD; see
THIRD-PARTY-NOTICES.md and [the kernelCAD review](KERNELCAD-REVIEW.md).

## Review tools

`cad_inspect`, `cad_check_interference` and `cad_render` evaluate the current
model in the geometry worker and change nothing. Inspection integrates signed
tetrahedra of the evaluated mesh (volume, centroid) and reports closed-mesh
topology. Interference intersects each bounding-box-overlapping pair with
Manifold; `clearanceMm` adds Manifold's minimum-gap search for pairs that do not
overlap. `cad_render` is an original headless software rasterizer (orthographic,
z-buffered, flat-shaded in body colours, PNG via fflate's zlib), up to four views
of 64–1024 px; the images arrive as MCP `image` content beside a short JSON summary.

## Shared command vocabulary

`cad_list_commands` returns the same registry that drives the terminal, the
command palette and the CLI: canonical name, aliases, localized description,
usage, category, typed arguments, `editsModel` and `headless`. Pass
`headlessOnly: true` to list only the commands `cad_run_commands` accepts.

`cad_run_commands` takes `commands` (one command per line, at most 64 lines and
65,536 characters; blank lines and `//` comments are skipped), `expectedRevision`
and optional `preview`. It runs on a private copy of the current model with the
headless command runner from `packages/core`:

- Same syntax, aliases, coordinate parsing and limits as the terminal. A missing
  argument takes the default an empty Enter would give, or fails.
- The script starts with an empty selection. Use `select` before
  `move`/`rotate`/`scale`. `undo` and `redo` act within the script.
- `apply …` and `select [...]` replay canonical journal records (data only).
- View, panel and clipboard commands are refused. Nothing evaluates JavaScript;
  there are no file paths or shell commands.
- The first failing line stops the script, nothing is saved, and the error
  carries `line`.
- When the model changed, the result is evaluated in the geometry worker
  (30-second watchdog), checked against the 1 MiB editable-model cap, and
  appended as one history iteration labelled "Run commands". `preview: true`
  evaluates without saving. Scripts that only read (`list`, `help`) save nothing.

The result lists each command's canonical invocation and output, plus
`journal`: the [journal export](TERMINAL-WORKSPACE.md#journal-export) of the
script, in which plain primitives and literal sketch extrusions and revolutions
appear as CAD Script.

The editor's terminal runs pasted multi-line scripts the same way
(`runCommandScript` in `packages/core`): a private trial session, the same runner,
and one commit (labelled "Run command script") or none. See
[multi-line scripts](TERMINAL-WORKSPACE.md#multi-line-scripts).

`export step` and `measure exact` also run here. They use the optional exact B-rep kernel
(`@brickwright/cad-exact`), which the host starts in its own thread
(`apps/mcp/exact-worker.mjs`) on the first exact request; a request has 60 seconds, and
cancellation terminates only that thread. Each reads the model as of its own line. Their
results carry `kernel` (`{id:'smlib', package:'@crispcad/exact-kernel', version, smlib}`); an
`export step` result carries `file` (`name`, `mime: model/step`, `base64`; all files of one
script at most 3 MiB). A body without an exact construction (imported mesh, minkowski, text,
…) stops the script with `Line N: <body> (<feature>): …`; nothing falls back to a mesh.
Recorded `apply` lines that carry `context.kernel` replay only when this host provides that
kernel version ([kernel identity](TERMINAL-WORKSPACE.md#kernel-identity-in-recorded-commands)).

`fillet`, `chamfer`, `shell` and `recompute exact` edit the model on the same thread
([exact fillet, chamfer and shell](TERMINAL-WORKSPACE.md#exact-fillet-chamfer-and-shell)):

```text
select none
fillet 1 "Bracket" --face top
shell 2 "Housing" --open +z
recompute exact
```

Individual edges: `edges "Bracket"` lists the body's B-rep edges, numbered (read-only), and
`chamfer 0.5 "Bracket" edges 3 7` bevels those two. The numbers hold for the current model only;
the commit records stable edge references (document version 44), which a later script may pass
instead of numbers.

The exact kernel computes the feature and its display mesh (0.01 mm / 10°) on the trial
session; the edit is recorded with `context.kernel`, so the script's `journal` replay text
carries the kernel. The script is then evaluated with Manifold, which uses the display mesh,
and committed as one history revision like any other script. A project with an exact feature
is document version 41; the 1 MiB editable-model limit of the MCP host includes the display
mesh.

### Headless CLI

The CLI reuses the MCP host, so it has the same writer lock, validation and
atomic history append. It prints JSON on stdout; errors go to stderr with exit
code 1. A project that does not exist yet is created.

```sh
npm run build:packages
node apps/cli/crispcad.mjs commands
node apps/cli/crispcad.mjs run design.bcad "box 40,30,4" "select all" "move 0,0,0 @0,0,2"
node apps/cli/crispcad.mjs run design.bcad "sphere 5" --dry-run
node apps/cli/crispcad.mjs inspect design.bcad        # also: interference, printability, measure
node apps/cli/crispcad.mjs step design.bcad design.step  # exact STEP via the exact kernel
node apps/cli/crispcad.mjs run design.bcad "export step all" --out exports/
```

`measure` and `step` use the exact kernel (`cad_measure_exact`, `cad_export_step`), and so do
`run` scripts with `fillet`, `chamfer`, `shell` or `recompute exact`, for example
`node apps/cli/crispcad.mjs run design.bcad "fillet 1 all"`. Files that
`run` commands produce (`export step`) are written to `--out`; without it the JSON reports only
their names and sizes.

`--locale de` gives German descriptions and diagnostics.
