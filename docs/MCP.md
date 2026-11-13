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
| `cad_get_model` | Current revision and root object metadata |
| `cad_get_code_object` | Object source, local parameters and placement |
| `cad_preview_code` | Compile/evaluate source without saving |
| `cad_create_code_object` | Validate and commit a retained coded body |
| `cad_update_code_object` | Change source/overrides while preserving identity |
| `cad_list_revisions` | Paginated iteration metadata |
| `cad_restore_revision` | Append a restore, preserving later work |
| `cad_export_project` | Base64 complete history-inclusive project |
| `cad_export_stl` | Base64 printable mesh |

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
GUI for larger mesh exports. Geometry runs in a worker with a 30-second watchdog.
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

`cad_convert_code` is read-only. Supply source, inputFormat (cadcode/openscad/jscad),
outputFormat (cadcode/openscad/jscad), optional parameter overrides and optional
JSCAD entryPoint/arguments. Results identify snapshots and return warnings plus
JSCAD separate-output metadata. It neither modifies the model nor adds history.
