# A curated reusable model library

Research checked 2026-11-13. Mesh content licences are independent of repository
code licences. Do not import a dataset merely because its loader is MIT/Apache.
STL has no reliable unit, author or licence metadata and does not recover the
source model's editable features. Keep original CAD alongside derived STL.

## Candidate sources

| Source | Content rights / suitability |
| --- | --- |
| [3DBenchy](https://www.3dbenchy.com/license/) | Current official model is CC0. Good calibration seed; check current evidence rather than historic BY-ND descriptions. |
| [FreeCAD library](https://github.com/FreeCAD/FreeCAD-library/blob/master/LICENSE-Assets) | Asset licence CC-BY-3.0. Native CAD is useful for retaining source intent; convert selected assets and preserve attribution. |
| [Thingi10K](https://github.com/Thingi10K/Thingi10K) | 10,000 real print models, mostly STL, with individual licences. The Apache code licence does not cover every model. Includes broken meshes: quality screening required. |
| [Smithsonian Open Access](https://www.si.edu/openaccess/faq) | Use media explicitly marked CC0. CC0 metadata alone does not establish media rights. Often needs format conversion and simplification. |
| [Poly Haven](https://polyhaven.com/license) | CC0 assets, primarily visual rather than engineering/print models. Live API has separate terms; downloaded assets need printability checks. |
| [LDraw](https://www.ldraw.org/pt-policies.html) | Per-part CC-BY / CC0 notices; legacy files may use CC-BY-2.0. Not STL: keep part provenance through conversion. Existing Brickwright ecosystem, useful later. |
| [Objaverse](https://huggingface.co/datasets/allenai/objaverse/blob/main/README.md) | Dataset/database licence is not a blanket object licence. Mixed per-object Creative Commons rights, often GLB; too noisy for an initial print library. |
| [ABC](https://deep-geometry.github.io/abc-dataset/) | CAD creators retain rights under the stated source terms. MIT processing code is not a blanket MIT licence for the CAD files. Exclude from automatic ingestion. |
| [STEMFIE](https://stemfie.org/license/) | Current part files use CERN-OHL-W-2.0. Treat separately from the initial simple content allowlist. |

Printables/Thingiverse-style community sites select licences per upload; they are
not a single freely redistributable corpus. FreeCAD distributes native parts;
LDraw distributes a curated part system; Thingi10K is a research corpus. These
serve different needs. We should curate a small reliable set, not mirror a site.

Initial automatic content allowlist: CC0-1.0 and explicit MIT/Apache-2.0/BSD
asset grants, plus CC-BY-3.0/4.0 with attribution. CC-BY-SA assets can be a separate
collection: retain licence, attribution and changes, and license adaptations
accordingly ([licence](https://creativecommons.org/licenses/by-sa/4.0/)). Exclude
NC, ND, unknown and contradictory grants. A mesh content licence does not change
our editor's BSD licence. Do not infer legal rights solely from a filename/tag.

## Storage and provenance

Use GitHub for catalogue metadata, schemas, curation scripts and a small seed set.
Use a versioned Hugging Face dataset for large mesh blobs if the library grows;
[storage limits](https://huggingface.co/docs/hub/storage-limits) still apply.
Publish a [dataset card](https://huggingface.co/docs/hub/datasets-cards) recording
scope and limitations. Keep private GitHub Actions disabled. No external library
repository or bulk download has been created by this change.

Each catalogue record needs:

- Stable asset ID, title, author and exact original download/source URLs.
- Exact content licence SPDX ID, attribution, archived grant/evidence URL and
  capture date. Resolve conflicts manually before admitting an asset.
- Original and derivative SHA-256, byte sizes, version and modification notes.
- Source format, explicit unit assumption, up axis and conversion transform.
- Original STEP/FCStd/other editable source where available, plus derived mesh.
- Separate quality results: parseable mesh, closed positive-volume solid,
  size/triangle limits and optional Jolt collision qualification/version.

Fetch selected files on demand, verify hashes, and cache locally for offline use.
Do not label a successful import as a physics certification. Non-convex dynamic
parts need qualified compound/decomposed collision shapes; visual meshes alone
are insufficient. Export attribution sidecars with library-derived STL, and keep
provenance in project documents before enabling catalogue insertion. Plain STL
alone cannot carry these obligations reliably. The current STL importer/exporter
is for user-provided geometry. Headless project provenance and a standalone
[attribution sidecar helper](MODEL-ATTRIBUTION.md) are available; headless STL catalogue insertion and its editor UI are available (see below); browser/native STL export delivers one ZIP with STL and attribution,
and MCP returns both files for recorded printable sources (see MODEL-ATTRIBUTION.md).

## Immediate useful library

Start with our 34 original, editable CAD Script examples (BSD-3-Clause), then a
small independently checked CC0 calibration collection. Add selected attributed
FreeCAD parts and filtered Thingi10K models only after manifest/quality tooling
and project provenance support are implemented. Do not promise that corpus
imports become parametric or mechanically accurate automatically.

## Implementation sequence

The first slice establishes a versioned catalogue contract and validates declared
provenance and separate quality results. Validation checks the shape and policy of
records; it cannot independently establish that a grant is genuine, that bytes
match their hashes, or that a mesh passes its reported checks. Curators must
verify evidence and files before admitting records.

The next slice now provides selected-file fetching with hash verification and an
offline cache (see below). Headless STL quality screening is also available
(see below). The 34 original editable examples now have a reproducible local collection
(see below). A small CC0 calibration set remains to be implemented. Preserve original files and derived meshes with their respective
hashes. Project provenance now retains reviewed source snapshots in version 5 documents,
and a standalone attribution sidecar helper is available. Headless STL catalogue insertion and its editor UI are available below. Browser/native STL export packages STL and
attribution together, and MCP returns both files for recorded printable sources; the catalogue contract alone
does not itself provide insertion.


## Selected-file retrieval and offline storage

`fetchModelLibraryFile` in `@brickwright/cad-core` accepts a catalogue, one explicit
file selection and an injected cache. It validates and snapshots the catalogue
before any IO. Select `{assetId, file: 'original'}`, `{assetId, file:
'editableSource'}` or `{assetId, file: {derivative: 0}}`; it never retrieves the
other files. No catalogue files, external repositories or bulk downloads are
created by this implementation.

The standalone host adapter `apps/standalone/src/model-library-cache.ts` provides
`createModelLibraryBrowserCache()`, using browser CacheStorage under the separate
`brickwright-model-library-files-v1` namespace. For example, in that host:

```ts
import {fetchModelLibraryFile} from '@brickwright/cad-core';
import {createModelLibraryBrowserCache} from './model-library-cache.js';

const cache = createModelLibraryBrowserCache();
const result = await fetchModelLibraryFile(catalogue,
  {assetId: 'selected-id', file: 'original'}, {cache});
// Reuse the verified file without any network request:
const offline = await fetchModelLibraryFile(catalogue,
  {assetId: 'selected-id', file: 'original'}, {cache, offline: true});
```

Files are addressed by SHA-256, so identical content can be reused across asset
versions. Every cache hit is checked against both the selected record's exact
byte size and SHA-256. Corrupt entries are removed where possible; normal mode
then downloads just that selection, while explicit `offline: true` fails without
network access. A changed hash cannot reuse a stale version. A cache read failure
is treated as a miss. A write/quota failure returns verified bytes with
`cached: false`; successful persistence or a verified hit returns `cached: true`.
Browser storage can still be evicted or cleared by the user; offline availability
is not guaranteed until a later verified read succeeds. Other hosts provide the
same small `ModelLibraryFileCache` interface without browser storage dependencies.

Network requests omit credentials, bypass the HTTP cache, and reject redirects
entirely to prevent intermediate HTTPS-to-HTTP requests. Catalogue download URLs
must therefore be direct HTTPS endpoints that support browser CORS; redirected
provider links must be resolved and curated separately. Failed HTTP responses,
truncated bodies and hash mismatches are never cached. Streaming is bounded by
the declared byte size regardless of Content-Length, with a default per-file
admission cap of 64 MiB (`maxBytes` may explicitly override it). Oversized streams
are cancelled. Callers can also provide an AbortSignal and an injected fetch for
headless hosts or tests.

This is a retrieval API, not catalogue insertion UI. Verified bytes establish file
identity only: they do not establish legal rights, mesh quality or physics
qualification. Retrieval changes no STL importer, saved project definition or history revision.
The headless insertion API and editor interface below integrate project provenance. MCP now
integrates the sidecar helper for attributed STL; browser/native delivery now
packages STL and attribution together in one ZIP.

## Headless STL quality screening

`checkModelLibrarySTL` in `@brickwright/cad-geometry` screens one explicit STL
byte array without fetching files, changing documents or inserting catalogue
assets. Supply `checkedOn` and an explicit `toMillimetresZUp` affine conversion:
STL does not establish its own units. The checker snapshots and SHA-256 hashes the
exact input bytes, and records its version, capture date and applied policy.
It accepts complete binary STL and line-oriented ASCII STL facet grammar;
trailing ASCII content, incomplete facets and non-finite data fail parsing. This
is stricter evidence than the existing user-provided STL importer's loose vertex
extraction, which remains a separate API.

The independent checks cover parsing; nondegenerate, consistently oriented,
closed manifold topology with positive total signed volume; converted bounding
box spans; and triangle count. Exact coincident positions are welded for topology
analysis, without repair or tolerance-based stitching. Each edge needs opposite
paired uses, and each vertex needs a connected manifold fan. Defaults admit at
most 83,333 triangles and a 1000 mm span along each converted axis. Callers may
lower the triangle limit and set a positive finite maximum span. Analysis itself
has hard limits of 16 MiB and 83,333 triangles; oversized byte input is rejected
before copying or hashing. Exceeding the triangle analysis budget reports a
failed count limit while parsing and other geometry checks remain `unchecked`.
Parse failures likewise leave dependent checks `unchecked`, distinct from a
checked failure.

Results include `checks`, diagnostics, and available measurements. A catalogue
`quality` record is emitted only when all checks have run; its booleans retain
failures and never convert unchecked work into evidence. Store its optional
`screeningPolicy` with the quality record to retain chosen size/count limits,
conversion and analysis budgets. This metadata is validated when present; older
catalogues remain valid without it, but their booleans alone cannot reproduce the
policy used. The quality hash identifies the screened STL, whose conversion can
differ from the editable original's catalogue conversion.

This screen does not detect intersections between nonadjacent triangles or
shells, establish shell nesting, prove printability or mechanical accuracy, or
qualify collisions. A passing topology/volume screen can still contain overlapping
or self-intersecting surfaces and requires further curation. No `physics` evidence
is produced. Source rights, retained project provenance, attributed exports and Jolt
qualification remain separate requirements.

## Original editable example collection

`library/examples-manifest.json` inventories all 34 original BSD-3-Clause CAD
Script examples. Each has a verbatim editable `.cad` source (plus a final newline)
and a binary STL rendered with default parameters. The collection retains the
complete original example module and repository licence under `library/sources/`
and `library/evidence/`. Per-record provenance links pin the actual source-module
commit; the archived source-module and licence hashes are checked before generation.
Generation transpiles that pinned TypeScript archive with the installed TypeScript
compiler. Live UI examples can evolve independently, including their formatting.
No reference application's source or assets were used for this collection.

This is a **local collection manifest**, format
`brickwright-local-example-library` version 1. File `path` values are relative to
`library/`; they deliberately do not claim HTTPS download endpoints for files
that have not been published at an immutable revision. It is separate from the
network catalogue schema, cannot be passed to `fetchModelLibraryFile`, and is not
a catalogue insertion UI. Publication and reviewed immutable download URLs are
still required to admit these generated files to the remote catalogue. The source
repository remains private; its provenance links require repository access.

Run locally from the repository root, with the lockfile-installed dependencies:

```sh
npm run library:examples:generate  # rebuild SDKs and intentionally write outputs
npm run library:examples:check     # rebuild SDKs; regenerate in memory and compare
```

Check mode does no network IO and writes no library files. It compares exact bytes
of every source, mesh, evidence file and manifest, and rejects unexpected files in
the generated source/mesh directories. Generation records its own SHA-256, the
package-lock hash and Manifold WASM hash. Reproduction is scoped to this locked
Node/Manifold toolchain; a toolchain or geometry implementation change requires
review and regeneration, not acceptance of stale hashes. Commands build SDKs
first so generation uses the current compiler, kernel and quality checker. The
archived source-module pin must be deliberately updated when curating a new
committed snapshot of the original examples; generation refuses silent changes to their pinned source or
grant. No files are fetched from the provenance URLs during these commands.

All 34 checked-in STL files pass the existing versioned parsing, positive-volume
closed-manifold topology, size and triangle screens as of 2026-11-13. Each record
retains the mesh hash, policy, explicit millimetres/Z-up identity conversion,
measurements, diagnostics and checker version. The `units` example resolves its
explicit inch/centimetre literals to millimetres before export. Default source
coordinates are preserved, including negative Z coordinates; meshes are not
moved onto a print bed or repaired. The screens do not establish self-intersection
freedom, printability, mechanical accuracy or physics/collision qualification.
Project provenance and the standalone attribution sidecar helper are separate
from this collection. Headless STL catalogue insertion and its editor UI are available below; browser/native STL export packages STL and
attribution in one ZIP, and MCP returns both files for recorded printable sources.


## Retained project provenance

`CadDocument` version 5 adds optional `provenance: {version: 1, records: [...]}`
and node `provenance` reference IDs. Each `ModelProvenanceRecord` retains a complete
validated catalogue asset snapshot, an exact `selectedFile` identity from that
asset, a local record ID, and explicit incorporation `modificationNotes`. This
keeps licence, attribution, evidence, conversion, original and derivative hashes,
and optional quality evidence together. The snapshots record curator assertions;
they neither verify grants nor prove that existing project geometry matches a
selected file.

`session.attachProvenance(nodeIds, record)` records sources for existing geometry
as one validated undoable edit. It performs no IO or catalogue insertion and never
overwrites a conflicting record identity. Generic inspector updates cannot replace
source references. Source metadata does not change geometry keys or establish
physics qualification.

Sources remain on boolean operands, are retained by transforms and duplication,
and follow selection fragments and paste with remapped local record IDs. Separating
a boolean propagates its own sources to the operands. Regeneration conservatively
retains all replaced construction sources on the replacement body; it does not
claim the replacement is unchanged. Removing geometry drops only source snapshots
no remaining node references. Unrelated selection copies omit those snapshots.
An attributed fragment is refused as a generated replacement until that separate
merge workflow is implemented.

The source metadata contract requires version 5 so older readers refuse these
documents instead of editing away attribution. Existing versions 1–4 open without
migration or rewriting. These older schemas previously permitted arbitrary
extension fields named `provenance`; such fields remain opaque and are never
validated, remapped or interpreted as library sources. Upgrading a document or
inserting a fragment with colliding legacy fields into version 5 is refused
rather than overwriting those fields. Sidecar generation requires version 5. New document snapshots and node source references are preserved by
the existing history header and content storage, including portable backup, restore
and branch operations. No database schema upgrade or old revision rewrite is
required. UI preferences and transient drag previews remain outside model history.

The provenance API provides persistence and graph propagation; the headless STL
insertion API below supplies verified conversion and atomic insertion. Library
automatic attribution of later modifications and a complete narrative of subsequent edits remain pending.
The MCP host now automatically pairs STL with attribution for recorded printable
sources and requires explicit export modification notes; see
[attribution export](MODEL-ATTRIBUTION.md). The editor now packages attributed STL and its JSON sidecar in one ZIP after
requiring explicit modification notes; attributed 3MF remains refused.


## Reviewed external geometric fixture

A separate [local CC0 fixture collection](../library/FIXTURES.md) now retains
Ghostkeeper's pinned nine-byte editable `cube(10);` source, full model-grant
evidence, author metadata and a reproducible 12-triangle STL. The existing
independent OpenSCAD translator and CAD Script/Manifold pipeline preserve corner
origin and explicitly assumed millimetres/Z up. Focused tests independently
check 10 mm spans and 1,000 mm³ volume; all four existing mesh screens pass.
No physics qualification or network derivative URL is claimed.

This is a geometric/slicer fixture: upstream explicitly excludes calibration
from its scope. The small external calibration collection remains pending.
The fixture audit documents why reviewed Benchy and Innerscene candidates were
not admitted. No source identity conflict was overridden by a passing mesh screen.


## Atomic headless STL catalogue insertion

`insertModelLibrarySTL` in `@brickwright/cad-geometry` accepts a session, catalogue,
one explicit original/derivative STL selection, and its bytes. It performs no
network IO. Hosts can obtain those bytes with `fetchModelLibraryFile` first;
insertion independently verifies their exact size and SHA-256 again. Editable
program sources and non-STL files are refused. The ordinary user STL importer
remains separate and never gains catalogue provenance implicitly.

```ts
await insertModelLibrarySTL(session, catalogue,
  {assetId: 'selected-id', file: {derivative: 0}}, verified.bytes, {
    evaluate: kernel.evaluate,
    toMillimetresZUp: selectedStlConversion,
    checkedOn: '2026-11-13',
    modificationNotes: 'Applied recorded unit/up-axis conversion; no repair.',
  });
```

Admission requires passing curated quality for the selected hash and its retained
`screeningPolicy`. The caller must explicitly supply the selected STL conversion,
which must match that policy. A derivative's conversion can differ from the
original editable source's `asset.conversion`; insertion never guesses units from
STL or applies the original conversion to a derivative. It applies the selected
matrix once to mesh vertices, retaining its translation without centering or
repairing the model. Optional `maxTriangles` and `maxExtentMm` can tighten the
curated limits. Current hard analysis budgets and document coordinate limits
still apply, including the curated analysis byte budget.

Metadata, bytes, conversion, notes and policy are snapshotted before asynchronous
hashing. Insertion reruns the strict versioned STL screen on those exact bytes and
that conversion. It validates the complete candidate in an isolated trial session
and calls the injected geometry kernel evaluator before changing the live model.
A missing, empty, non-finite or non-positive-volume inserted kernel body is refused.
Hosts must supply their actual kernel evaluator. An intervening project edit/load
causes insertion to fail so the host can explicitly retry against the new revision.

Success makes one undoable version-5 model edit containing both geometry and its
complete reviewed source snapshot, exact selected file identity and explicit
incorporation notes. Rejection leaves the existing document, selection, revision,
undo and redo stacks intact. Legacy opaque provenance collisions are refused.
Undo/redo retains geometry and attribution together. Existing saved definitions
and archived revisions are never rewritten.

The returned fresh quality result contains no physics evidence. Retained catalogue
quality (including any separate curation assertions) remains the curator's snapshot;
insertion does not independently verify licence grants, establish mechanical
accuracy, detect all intersections, prove printability or qualify physics/collisions.
Automatic source compilation and bulk ingestion remain pending.


## Editor catalogue interface

The editor's File → Model library panel browses a host-supplied reviewed network
catalogue or a catalogue JSON file selected by the user. No remote catalogue is
bundled: the checked-in local example and fixture manifests are different formats
and do not assert published download URLs. Browsing metadata makes no requests.
The panel shows the source, grant evidence, attribution, exact selected STL URL and
hash, and the selected mesh's screening conversion and limits separately from the
original source assumptions. Only an explicit insertion fetches the selected file.

Standalone uses its persistent browser cache; “Use cached files only” performs no
network access. Other hosts can provide `modelLibrary: {catalogue, cache, fetch}`
through `CadEditorOptions`. The catalogue is validated and snapshotted, but metadata
is a curator assertion, not independent verification of rights. Eligible files must
have passing hash-bound quality and a recorded conversion. Insertion requires
incorporation notes and uses the geometry worker for trial evaluation. Closing the
panel cancels pending work; an intervening edit also prevents the final commit.
A successful insert is one undoable edit with its source snapshot; re-screening
does not establish printability or collision qualification.
