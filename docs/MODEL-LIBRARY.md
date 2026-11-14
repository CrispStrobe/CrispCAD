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

## Optional headless Jolt collision qualification

`qualifyModelLibrarySTL` in `@brickwright/cad-physics` explicitly qualifies one
reviewed original/derivative STL selection. Supply the catalogue, selected bytes,
and `{kernel, toMillimetresZUp, checkedOn}`. `kernel` must be the trusted host's
`createGeometryKernel()` instance; a caller-supplied implementation is within the
host trust boundary, not independently authenticated by this API. The conversion
must match the selected file's retained screening policy. This optional operation
does not run during browsing, retrieval, screening or insertion.

The qualifier reuses verified atomic STL insertion in a private disposable session:
exact byte size/SHA-256, passing curated quality, retained conversion and fresh
strict screening are all required. It then evaluates that converted solid, runs
the existing fail-closed compound decomposition/comparison gate, creates actual
native shapes in the pinned **debug** Jolt build, advances one 1/200 s rigid-only
step without ground, checks finite poses/source bounds, and tears down the world.
It never replaces a non-convex part with an unqualified hull or box. Optional
`maxTriangles`, `maxExtentMm`, `maxHulls`, `volumeFraction` and `boundsMm` retain
the existing admission and collision limits; oversized/difficult geometry fails.

The result keeps fresh `quality` separate from `evidence`. Evidence records the
exact source byte hash, converted geometry hash, evaluated source volume, explicit conversion, capture date,
mesh checker/policy (in `quality`), qualifier version, pinned Jolt version/debug
build, hull count, full geometric certificate/tolerances and native step scope.
Failures reject without returning positive evidence. Catalogue records, live
projects, selection and saved history are untouched. Serialized reports are
curation evidence only: they cannot be passed as qualified runtime collisions.
World creation still requires fresh immutable runtime proofs, and changed bytes,
conversion, geometry or toolchain require requalification.
The reported engine version and package release pin must be updated together;
a focused test binds them. The host's installed dependency closure is trusted.
The complete return value is a `brickwright-library-collision-report` version 1
report, including the exact selected STL identity and the fresh quality result.
Catalogue version 1 optionally retains it as `asset.quality.collisionReport`.
Older catalogues without reports and their optional `quality.physics` summaries
remain valid; a summary alone does not establish a complete qualification report.
The optional report has strict fields and binds the file, fresh passing checks,
checker/policy, conversion, date, geometry hash, source volume, certificate,
tolerances, engine/qualifier versions and native debug-step scope. Certificate
relative error must agree with its difference volumes and evaluated source volume.
Contradictory summaries, stale bindings, incomplete reports and unsupported report
versions are rejected. These checks establish metadata consistency, not that
serialized curator assertions describe a run that really happened.

`qualifyModelLibrarySTLAndAttach(catalogue, selection, bytes, options)` explicitly
runs fresh qualification and returns a new validated catalogue snapshot with the
full report and its fresh quality. It accepts no external report for attachment,
performs no IO, and leaves the input catalogue and all project/history state
unchanged. Hosts decide where to save the returned catalogue. Ordinary insertion
retains this complete reviewed asset snapshot in version-5 project provenance;
serialization, undo/redo and existing history archives preserve it without
rewriting old documents or revisions. Metadata is still curation evidence only:
serialized reports cannot create a physics world, and runtime collision proofs
must be freshly established. No automatic catalogue certification is performed.

Run this operation in a host worker with a time limit. `signal` is checked at
asynchronous stage boundaries, but cannot interrupt synchronous decomposition.
A native abort requires discarding the worker/module. The single free rigid step
does not test ground settling, cavity clearance, contacts, mechanism behavior,
elasticity, printability or manufacturing accuracy; fit-critical openings still
need independent probes. The native step API currently exposes no capacity/error
telemetry. No external content, bundled qualification collection or editor physics
interface is introduced by this API.

## Offline selected-STL curation command

After `npm run build:packages`, a curator can explicitly qualify one cached local
STL and save a **new** catalogue:

```sh
node scripts/qualify-library-stl.mjs \
  --catalogue /absolute/path/reviewed-catalogue.json \
  --stl /absolute/path/cached-selected.stl \
  --asset selected-asset-id --file derivative:0 \
  --checked-on 2026-11-13 --output /absolute/path/new-qualified-catalogue.json
```

The input must be a validated `brickwright-model-library` catalogue, rather than
a local fixture/example manifest. Use `createLocalModelLibraryCatalogue` to
project those manifests first. `--file original` selects an original STL;
`derivative:N` selects exactly one zero-based derivative. Paths are explicit and
resolved from the working directory; catalogue paths/URLs are never used to
locate or download a mesh. The command verifies the selected byte size and SHA-256
before qualification and requires its retained screening policy. It reuses that
policy's exact conversion, triangle limit and extent limit. The fresh report
retains those limits plus the collision budget (2048 hulls, 2% volume difference,
0.2 mm bounds tolerance). No cache files or input catalogues are modified.

Only regular local input files are accepted; final-component symlinks are refused.
Catalogue input/output is capped at 4 MiB and mesh input at 16 MiB before analysis.
The disposable Node worker has a 256 MiB old-generation heap limit, 64 MiB young
generation limit and 4 MiB stack limit. These are JavaScript heap limits, **not**
a hard total-process/native/WASM memory quota; run the command within an OS memory
limit when processing untrusted local content. The geometry checker additionally
retains its hard 83,333-triangle analysis limit. The default wall-clock worker
deadline is 30 seconds; `--timeout-ms` accepts 1–120000. Timeout, SIGINT or SIGTERM
discards the worker, including synchronous native work, and produces no catalogue.

After fresh `qualifyModelLibrarySTLAndAttach` and validation succeed, the host
writes and syncs a private sibling temporary file and publishes it by an atomic
exclusive hard link. The output must not exist, including a dangling symlink;
concurrent creation also fails without replacement. The output directory must
already exist and support hard links. The temporary file is cleaned up. Keep
the original catalogue for review and choose a different output path for each run.
Publication gives complete-file visibility; this is not a power-loss durability
guarantee for the directory entry.

The full report stays in the selected asset's quality record. Console output
states the narrow one-step debug Jolt rigid-preview scope. This command is
separate from `verify:physics`'s built-in catalogue/drop report and changes no
editor, browser-worker timeout, project definition or history revision. It
establishes neither source rights nor fit, contact, printability or mechanical
certification, and serialized reports never authorize runtime collisions.

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
that have not been published at an immutable revision. The standalone host projects
this manifest to local file identities and bundles the editable sources, not the
derived meshes. It does not pass local paths to `fetchModelLibraryFile`. Publication
and reviewed immutable download URLs are still required for a remote catalogue. The source
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
Bulk ingestion remains pending.


## Editor catalogue interface

The editor's File → Model library panel browses a host-supplied reviewed network
catalogue or a catalogue JSON file selected by the user. Standalone also includes
the 34 pinned editable CAD Script examples, the CC0 slicer fixture and the
[supported reviewed JSCAD gear snapshot](../library/README.md#supported-offline-gear-snapshot) as local
sources; no remote catalogue or fabricated download URLs are bundled. Browsing
metadata makes no requests.
The panel shows the source, grant evidence, attribution, exact selected STL URL and
hash, and the selected mesh's screening conversion and limits separately from the
original source assumptions. Only an explicit insertion fetches the selected file.

Local sources are resolved only from a fixed build-time map and verified by size
and SHA-256 before a trial worker evaluation and atomic insertion. CAD Script
remains editable. The OpenSCAD fixture is translated to editable CAD Script; the
original source remains in the repository and its hash and provenance are retained,
but the original OpenSCAD bytes are not embedded in the project. Local identities
are not filesystem paths to be opened by a host, and remote fetching refuses them.
Older readers that cannot validate these identities reject the project rather than
discard attribution. The JSCAD gear is translated with default parameters into an editable CAD Script
evaluated snapshot; original JavaScript parameter definitions are not project
parameters. Its exact original remains archived in the repository and build bundle. Its immutable upstream
original URL, selected local hash, conversion/default parameter notes, and full
original MIT notice wording (line breaks explicitly normalized to spaces) remain in
project provenance and attribution sidecars. Unsupported seed models remain archival
and unavailable for insertion. Local insertion does not establish physics qualification.

Standalone uses its persistent browser cache for remote files; “Use cached files only” performs no
network access. Other hosts can provide `modelLibrary: {catalogue, cache, fetch}`
through `CadEditorOptions`. The catalogue is validated and snapshotted, but metadata
is a curator assertion, not independent verification of rights. Eligible remote STL files must
have passing hash-bound quality and a recorded conversion; local editable sources
are verified and evaluated before insertion. Insertion requires
incorporation notes and uses the geometry worker for trial evaluation. Closing the
panel cancels pending work; an intervening edit also prevents the final commit.
A successful insert is one undoable edit with its source snapshot; re-screening
does not establish printability or collision qualification.

For a selected STL, the panel distinguishes a complete recorded Jolt report, a
legacy summary, and absent or different-file evidence. A complete report exposes
its file and geometry identities, conversion, screening and compound limits,
engine and qualifier versions, and the native step's scope. This is displayed
without fetching the model or running physics. It is a curator's recorded assertion,
not a reusable runtime collision proof; runtime shapes still require fresh
qualification. The one-step preview does not establish contacts, fit, printability,
or mechanical behavior. Local source records do not inherit a mesh's qualification.

## Reviewed archival source corpus

The November 14 admission adds 1,406 pinned OpenSCAD source files from 20
permissive libraries under `library/corpus/repos/`, with 34 retained licence and
README files (9,240,831 bytes before manifest/configuration metadata). This is a
source archive: files include reusable modules, examples and assemblies, rather
than 1,406 independently runnable solids. Each file has a pinned source URL,
commit, SHA-256, size, author attribution, SPDX grant and retained evidence.
Directories and original bytes are preserved.

See the [per-library admission report](../library/corpus-audit/admission-report.md),
[individual exclusions](../library/corpus-audit/blocked-sources.md), and
[offline ingest/validation commands](SOURCE-CORPUS-TOOLING.md). This admission
uses already staged files and performs no network access or source execution.
The manifest records unresolved dependency blockers separately from a file's own
permissive grant. All sources are render-unqualified; archive admission does not
make them insertable in the editor or establish mesh or collision quality.
The editor's supported seed collection and its bounded translators remain as
described above. No additional JSCAD models were present in these staged subsets.

### Editor-enabled corpus subset

Ninety dependency-complete MIT Asset Collection originals now project into a
separate `library/editor-corpus-manifest.json` and are selectable in the bundled
editor catalogue. See [exact model names and reproduction commands](../library/README.md#external-corpus-models-available-in-the-editor).
Only these 90 archive selections receive local importer, Manifold and STL screening evidence;
the archival manifest remains unchanged and unqualified.

The current bounded OpenSCAD converter supports typed string/colour selectors,
computed scalar indexing, lexical nested modules and functions, module children,
and module calls, local bindings and loops in planar profiles. Strings remain
separate from numeric dimensions. Source appearance and echo output are omitted
with conversion notices. `#` retains rendered geometry, `%`/`*` exclude background
or disabled geometry, and `!` selects root geometry. Supported fragment controls
retain their scoped behavior. The full-render `$preview=false` context is
read-only; broader indexing support does not permit overriding that builtin.
See [current coverage and limits](CODE-CONVERTERS.md#current-coverage).

The admission batches in the [library history](../library/README.md#external-corpus-models-available-in-the-editor)
record the narrower converter available when each source was screened. Banner,
Raccordo and the street models were admitted with explicit appearance-loss notes;
the nested-module batch qualified seven further sources alongside Street 04.
Ingot, Coin, LED and Sauce Bottle followed with constant-palette evidence. Floor 01
remains excluded after its recorded converted-mesh topology failure. Pipe 00 and
Flange 02 retain their recorded full-render facet counts and original conditional
source bytes. These historical qualifications do not imply that every newly
parseable source has been screened or admitted.

Translate-only XY/zero-Z interpretation admits Cup, Ring, Pipe 90 and Key Old
through their default authored entry points. Rotation, scale and primitive size
vector rules are unchanged by that compatibility rule; the source originals are
not rewritten. Ring and Pipe 90's retained unused helpers are outside the recorded
qualification scope. Walking Stick's corrected scoped-`$fn` mesh has a new
derivative path; its [previous qualification record](../library/corpus-audit/qualification-history/walking-stick-v1.json),
mesh and preview remain preserved. Existing per-model topology exclusions and
triangle/extent screening policies are unchanged.

Simple list comprehensions now build bounded profile/vector values from a fixed
range or fixed-length vector. The importer retains symbolic coordinate expressions,
restores lexical bindings after iteration and rejects parameter-dependent range
cardinality. This shares the existing loop, array, depth and evaluation budgets;
filters, `each` and multiple iterator bindings remain outside this subset.
Only independently screened default entry points enter the editor selection.
The host bundles exact selected source bytes, previews and the
correct asset-specific MIT notice. Insertion verifies hashes, evaluates the
candidate, and preserves provenance, attribution and undo/redo through the
existing source-insertion path. No whole-corpus rendering gate is used.
