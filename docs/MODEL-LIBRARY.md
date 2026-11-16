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

Ninety-three dependency-complete MIT Asset Collection originals now project into a
separate `library/editor-corpus-manifest.json` and are selectable in the bundled
editor catalogue. See [exact model names and reproduction commands](../library/README.md#external-corpus-models-available-in-the-editor).
Only these 93 archive selections receive local importer, Manifold and STL screening evidence;
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
Unbound animation time remains the static `$t=0` fallback and now records that
actual interpretation in converter warnings and source provenance. Authored global,
lexical and module/transform time bindings retain their existing behavior. Rod 01,
Animation Gear 02 and Animation Mechanism 01 pass at the authored default entry
points with that fallback; their qualifications establish static geometry only.
Spawing Cube remains excluded because the unchanged default produces no solid.
Fragment-control scalar reads and self-shadowing `$fa`/`$fs` assignments now
resolve their enclosing values or builtin defaults without changing unspecified
48-segment tessellation. This removes a false variable-cycle refusal in the CC0
Smooth Primitives demo. Its unchanged authored entry point then exceeds the
existing construction-depth limit (33 versus 32), before geometry or STL
screening; it remains archival and unqualified, outside the 93 editor selections.
The host bundles exact selected source bytes, previews and the
correct asset-specific MIT notice. Insertion verifies hashes, evaluates the
candidate, and preserves provenance, attribution and undo/redo through the
existing source-insertion path. No whole-corpus rendering gate is used.

### Bounded A2D dependency collection

Two authored MIT A2D roots, `Samples/GrillSquare.scad` and
`Samples/PointGenerators.scad`, are projected separately in
`library/a2d-editor-manifest.json`. Together with the unchanged 93-entry corpus
selection this gives 95 editor-enabled source entries and 93 distinct mesh
hashes (134 gallery entries including the other seeds). A2D.scad is retained as
one shared dependency, not counted as an additional model.

Each root retains its exact original bytes and relative directory structure.
`sourceBundle` records its logical root and every local dependency's file hash,
size, author, source URL, pinned commit and independent reviewed licence grant.
Insertion verifies all originals before in-memory include expansion and preserves
that metadata in project provenance and attribution sidecars. The pure bundle API
has no ambient file access, search path or network loading. Explicit local file-scope
`use` is now supported with isolated library definitions; library root geometry is
not executed (see the cycle 23 measurement below).
Both aggregate original and expanded source stay within 32 KiB and expanded
lexical tokens within 8,192. Existing construction, geometry and timeout limits
are unchanged. Assertions remain live and failing edits abort atomically.

The [nine-root measurement report](../library/corpus-audit/editor-screening-cycle17.json)
retains two strict STL passes, five unsupported roots and two resource refusals.
Only the two passes are reproduced on the final runtime and inserted. The three
planar samples receive no invented extrusion; source parameters, time, fragment
settings and entry points remain unchanged. Unused A2D library helpers are outside
these two default-root qualifications.


### Full-turn shaft admission — 2026-11-14

Two further unchanged MIT defaults, `Shaft_01.scad` and
`Shaft_02_With_Keyway.scad`, pass strict STL screening after support for full
revolutions of wholly left-side profiles. Their six-point authored profiles and
48-segment full turns remain unchanged; no source edits, repairs or tessellation
overrides were used. They add 384- and 568-triangle meshes respectively. The
standalone corpus now has 95 entries plus the two separate A2D entries: **97 source
entries / 95 distinct mesh hashes**, and 136 total gallery entries. All earlier
records and previews are preserved. See `editor-screening-cycle18.json` for the
two original failures and final measurements. Partial-turn and crossing-axis
profiles remain refused; this is static geometry qualification only.


### SCON function-valued configurations — 2026-11-14

The separate `library/scon-editor-manifest.json` admits five MIT authored defaults
from Warren MacEvoy's pinned openscad-scon revision
`c954e07bf0faf571d8eccc259d47e61938666cef`: `examples/ex1.scad`, `ex2.scad`,
`ex3.scad`, `ex4.scad` and `tldr.scad`. Every root includes only the independently
retained 5,595-byte `scon.scad`; all exact original bytes and the complete MIT
notice remain local and are hash-checked before insertion. No JSON file, external
renderer, parameter override, repair or alternate entrypoint is used.

The six-root report `library/corpus-audit/editor-screening-cycle19.json` retains
0/6 before and 5/6 after. The remaining `ex5` refuses construction depth beyond
32. The admitted meshes have 5000, 524, 524, 5084 and 5000 triangles, respectively,
and pass parse, closed positive-volume, 200mm extent and 10,000-triangle screens.
They add five distinct hashes: 95 Angelo + 2 A2D + 5 SCON = **102 source entries /
100 distinct meshes**, and 141 total gallery entries. The prior 97 records,
136 previews and seven historical A2D refusals remain unchanged. All counts refer
to these static authored defaults; no manufacturing, motion or physics claim.


### Coin default and retained cycle20 refusals — 2026-11-14

`Asset_SCAD/Coin_02.scad` adds one unchanged MIT authored default, with a
3,132-triangle mesh passing all four strict STL screens. Its nonstandard text
`center` argument is warned and ignored, retaining the original default left /
baseline alignment; existing Droid-font substitution can change glyph metrics.
No source edit, font download, model repair, parameter override or limit change
was used. The first 95 Angelo records, two A2D records and five SCON records,
their 141 previews, all historical refusals and SCON `ex5`'s depth exclusion remain
unchanged. Totals are **103 source entries / 101 distinct STL hashes**, and 142
gallery entries. This is static authored-default qualification only.

The bounded four-root measurement improved from no qualified defaults to one:
`meshbuilder` reaches the fixed work limit after its generated-list syntax is
supported; `functional` requires unsupported `version_num`; `Sign_03` fails
strict topology; `Coin_02` passes geometry, STL and offline editor insertion.
See `library/corpus-audit/editor-screening-cycle20.json` for the separate measured
phases, unchanged-result reuse and exact runtime identities.


### Authored circular grill default — 2026-11-14

`Samples/GrillCircle.scad` adds a third A2D entry from the same reviewed MIT
revision and exact shared dependency bytes. Its original 80mm fan-grill default
passes all four strict STL screens at 3,372 triangles with bounds
[-40,-40,0] to [40,40,2]mm. Original dimensions, fragments, entrypoint and source
bytes remain unchanged; no repair or parameter override was used.

The two-root sample is 1 pass / 1 resource refusal after being 0/2 qualified.
`ParametricBoxWithLid` remains excluded at the original work limit, as does SCON
`ex5` at depth32. The old 103 records, 142 previews and all historical refusal
reports remain unchanged. Totals are **104 source entries / 102 distinct STL
hashes**, and 143 total gallery entries. The new result supersedes only the prior
GrillCircle refusal for current admission; its historical observation stays in
the original nine-root report. See `library/corpus-audit/editor-screening-cycle21.json`.

Cycle 23 measured scoped `use` on Angelo `Scene_House.scad` (one unchanged authored
root and four exact dependencies). It now produces actual geometry and a 2,284-
triangle STL, and editor insertion/serialization/undo-redo pass. Strict STL topology
fails with 44 invalid edges and 54 invalid vertex fans; it remains excluded. The
cohort is **0/1 qualified before → 0/1 qualified after**, with one topology refusal.
Delivered counts remain **104 sources / 102 distinct STL hashes / 143 previews**.
See `library/corpus-audit/editor-screening-cycle23.json`. Seven other ranked `use` roots
have independent path, loop/list-size or JSON blockers and are not credited as
expected admissions. Their ranking and exact root names remain in the cycle 21 report.

### Authored city scene default — 2026-11-14

`Projects/Scene_City_Street.scad` adds one Angelo source root with five existing,
independently retained MIT Street dependencies. All six original files remain
byte-identical. The first `use` resolves an exact supplied bundle-root file after
its relative candidate is absent; other directives resolve relatively. Relative
files take precedence, parent paths retain their original guards, and used
library demos never execute. No dependency aliases or source edits are used.

The one-root cohort improves **0/1 → 1/1 strict STL and editor passes**. The authored
assembly produces 842 triangles and 9.927364671 mm³, with bounds approximately
[-6.1,-1.1,-0.11] to [2.3,7.3,0.11] mm. Only this new preview was rendered.
Totals are **105 source roots / 103 distinct STL hashes / 144 gallery entries**:
97 Angelo, three A2D and five SCON roots. All prior 104 complete records, 143
previews and historical refusal reports remain unchanged. KnurledKnob's 32 KiB,
webbing's 64-item, Box's work, SCON's depth and all topology refusals remain.

The focused reproduction command evaluates only this new root while verifying
the exact historical 96 Angelo records, original bytes and derivative hashes:

```sh
node scripts/generate-corpus-editor-library.mjs --check --asset-id corpus-angelo-scene-city-street
```

See `library/corpus-audit/editor-screening-cycle25.json` for the ranked alternate,
actual before/after measurements and validation reuse. The remaining five
ClosePoints defaults and catchnhole retain independent loop/list or missing
JSON/data blockers; no additional admission credit is assigned to them.

### Authored Bricks random snapshot — 2026-11-14

`Asset_SCAD/Bricks.scad` adds one byte-identical MIT source root without
dependencies. The authored ranges, six calls, two instantiations and placement
are unchanged. Brickwright resolves its unseeded draws into a reproducible
source-derived import snapshot and discloses that policy in the generated code
and model provenance. This qualifies the retained snapshot; it is not an
upstream random-sequence equivalence claim or a qualification of every draw.

The measured cohort improves **0/1 → 1/1 strict STL and editor passes**: 24 triangles,
264.357610779 mm³, bounds [0,0,0] to approximately [15.6601,8.7175,3] mm. Independent
component bounds confirm two 5–10 mm rectangular profiles at height 3 mm and the
authored second origin [10,0,0]. Export identity survives serialization and
undo/redo; edits do not resample an already imported snapshot.

Totals are **106 source roots / 104 distinct STL hashes / 145 gallery entries**:
98 Angelo, three A2D and five SCON roots. All 105 prior complete records, 144 previews
and historical refusals remain unchanged. Only the new preview was rendered.
Focused reproduction evaluates Bricks and hash-verifies the 97 earlier Angelo
records and their exact original/derivative bytes:

```sh
node scripts/generate-corpus-editor-library.mjs --check --asset-id corpus-angelo-bricks
```

See `library/corpus-audit/editor-screening-cycle26.json` and the disclosed
conversion policy in `docs/CODE-CONVERTERS.md`. No Knob, webbing, Box, depth or
topology refusals were retried.

### Archived JSCAD example and transformation fixtures — 2026-11-14

Four already archived MIT roots are now admitted in
`library/jscad-editor-manifest.json`: `basicBooleans.js` and the upstream
transformation test fixtures `translateEx1.scad`, `scaleEx1.scad` and
`rotateEx1.scad`. Fixture titles explicitly identify them as fixtures. Their
original bytes, authored default roots/main, coordinates, source URLs and pinned
JSCAD revision are retained. The existing JSCAD MIT notice is included in full.
No new source was downloaded and no compiler/runtime changes were needed.

These roots already converted on the delivered compiler. This is an offline
library admission change: **0/4 previously shipped → 4/4 strict STL/editor
admissions**, not a claim of four compiler repairs. Actual baseline geometry and
STL hashes remain identical after editor insertion. The Boolean demonstration
has 1,532 triangles and volume 29.769003 mm³; the three transformed cubes have
12 triangles each and volumes 1,000 / 8,000 / 1,000 mm³. The existing editor
combines the Boolean demonstration's five outputs into one body, as disclosed.
All four retain exact provenance, export identity, serialization and undo/redo.

Delivered source counts now require all four explicit manifests: **110 roots /
108 distinct STL hashes**, from 98 Angelo + 3 A2D + 5 SCON + 4 JSCAD example/fixture
roots; there are 149 gallery entries. The earlier bundled JSCAD gear is unchanged
and is not counted again. Every previous 106 complete record, 145 preview and
historical refusal is preserved.

```sh
node scripts/generate-jscad-editor-library.mjs --check
```

The earlier Round-Anything cohort produced no geometry/STL admission under the
fixed guards. Its unsupported filter/sign/format and memoization experiment was
preserved externally and entirely reverted. No cache/work-counter change is
shipped. See `library/corpus-audit/editor-screening-cycle28.json` for the separate
failed cohort and successful admission evidence.


## Reviewed authored LDraw batch

`ldraw-reviewed-batch-manifest.json` adds eighteen official authored parts (no
fixtures): three simple tiles/slopes, twelve distinct axle originals and three
round plate/tile/beam originals. Exact root/dependency files, per-file authors and
CC-BY-4.0 grants, source revisions, nominal LDU conversion, derivative identities
and fresh mesh measurements are retained. The eighteen records add eighteen
unique STLs and previews; together with prior admitted collections the corpus
has 129 records/127 distinct STLs and the full gallery has 168 previews.

The original archival converter uses exact decimal affine arithmetic for point
identity, so mathematically equal authored coordinates share an index without
rounding or tolerance welding. Native polyhedron planarity remains unchanged.
When a convex LDraw quad exceeds native planarity but satisfies the official
ordinary less-than-one-degree coplanarity rule for both diagonals, the converter
emits two triangles on a fixed diagonal, preserving all four coordinates and
winding. Strongly warped/concave quads are refused. Decimal precision is bounded;
existing source/file/depth/work/point/face and mesh limits still apply. The prior
6934 derivative reproduces byte-for-byte. No runtime dependency is added.

Reproduce the batch offline after building packages:
`node scripts/generate-ldraw-reviewed-batch.mjs --check`. Its specification pins
every source and previously qualified derivative; stale source, grant, mesh or
quality identities are refused. The browser batch checks every new raster
preview and actual offline insertion/history/provenance on Chromium and iPad
WebKit. DAT files remain archival metadata; editor insertion uses verified STL.

The associated screening evidence distinguishes the sixteen initial planarity
refusals caused by converter representation (twelve become fully qualified;
four then expose source-surface boundaries) from twenty-six final non-manifold
refusals. Independent exact source-face traces prove unpaired edges in those
render-surface assemblies; these are unsupported closed-solid inputs, not a
claim that the physical parts are defective. No facet repair, guessed caps,
primitive substitution or relaxed tolerance is used. The existing111 records,
222 source/derivative identities and150 preview values are retained unchanged.

## Updated-code Arc01 admission

The next archived-family pass rechecked24unshipped Angelo roots under the
current integrated code. The authored `Asset_SCAD/Arc_01.scad` default now passes
all gates with328triangles. Its exact original and derived STL are pinned; the
existing generator can reproduce only this explicitly reviewed root while
hash-verifying and reusing the prior98corpus records without rerendering them.
No compiler/kernel/source/default/tolerance or guard change is part of this
admission. Actual editable-source insertion, fresh topology, source/mesh hashes,
project serialization/provenance, undo/redo and mismatch-before-evaluation refusal
are checked. Chromium and iPad-WebKit each verify actual preview raster pixels
and offline insertion/history with zero network requests.

This adds one authored original beyond the129record/127STL/168preview checkpoint:
the resulting local catalogue has130records/128distinctSTLs/169previews.
The remaining24-root batch outcomes are two necessary byte exclusions, three
actual size/triangle exclusions, six invalid/unsupported authored default-input
cases, and twelve exported-topology failures whose source-versus-code cause is
still provisional. Those failures are not labelled defective physical models.
The next25StoneAgeLib demonstrations all exceed the unchanged32KiB source
bound in necessary include subsets; this is not an archive-exhaustion claim.

## Preserve exact corner origins at decimal face contacts

The authored Flag France root exposed a kernel representation bug. Its grey
panel and red layer share a source face at decimal 0.1. Translating a centred
box by its half-size and then the layer offset introduced
`(0.1 + 0.05) - 0.05 = 0.10000000000000002` before CSG. The indexed kernel mesh
remained topologically closed, but two separate edges collapsed to the same
Float32 coordinates. The resulting STL had four incident faces on that edge.
STL export itself preserved every kernel coordinate exactly.

The kernel now constructs `move(size/2, box(size))` directly as a box from the
origin. This exact constructive identity avoids the artificial intermediate
centering; it does not round, weld, cap, simplify, alter tolerances or change
primitive defaults. Centred boxes retain their existing behavior, and an authored
gap remains two disconnected closed components. Arc01's previously qualified
mesh hash is unchanged. No public schema/API or dependency changes are involved.

The unchanged Flag France original now passes all gates with 582 triangles,
including exact source/derivative hashes, strict topology/positive volume,
actual editable-source insertion and provenance/history, and actual preview
pixels/offline insertion on Chromium and iPad WebKit. With the pending Arc01
addition, this gives 131 records / 129 unique STLs / 170 previews locally; neither pending
model is claimed delivered until its PR lands.

The other eleven provisional SCAD topology failures were actually rerun.
Flag Italy now passes mesh/topology and has the same derived geometry as France;
its editor/preview gates remain pending and it receives no admission credit.
Ten remain source-versus-output investigations rather than defective-model
claims. The independent 30-root next batch has 28 necessary byte exclusions and
two missing-input cases: catchnhole's actual converter refused JSON `import`,
and its required `bolts.json` and `nuts.json` are absent from the staged archive.
The earlier preflight checked SCAD includes/use only; the corrected full-input
assessment and original failed assessment are both retained. No speculative
import patch or replacement input data is used.


### Authored Italian flag, 2026-11-15

Flag_Italy adds the unchanged 404-byte MIT original by Angelo Nicoli, pinned at
`4f9e3d4d16b5e427186c1f89e10c2181c437dee6`. Its default geometry passes strict
closed-positive-volume screening with 582 triangles. Actual source insertion,
byte-mismatch refusal before evaluation, attribution, snapshot restore, undo/redo,
raster preview, Chromium and iPad-WebKit tests pass on main `9c795ae` plus this selection.

The French and Italian originals produce identical STL bytes after the existing
cosmetic-colour omission; country colours are absent from geometry and monochrome
previews. This is one new authored record and one preview, with **zero new unique
STLs**. Main has 131 records / 129 unique STLs / 170 previews before this delivery;
qualified local totals are 132 / 129 / 171. All prior 100 corpus records and 170
preview values remain exact. No primitive/compiler/guard changes are required.

See `docs/evidence/italy-qualification-2026-11-15.json` for source/derivative hashes,
actual commands, original resource refusals and exact tested-file bindings.


### Uniform cylinder contacts and authored Sign03, 2026-11-15

The unchanged MIT Sign_03 source shares z=0.1 between its grey base (line6) and
red disk (lines8/11). Its centred-cylinder construction introduced
`(0.1+0.05)-0.05 = 0.10000000000000002` before CSG. Primitive-ID tracing matched
the first collapsed edge to those surfaces; observer and baseline STL bytes were
identical, and the exporter changed zero coordinates. This is a demonstrated
construction bug, not an intrinsic source or physical-part defect.

Construct the exact identity `move([0,0,h/2], cylinder(r,h))` directly at the
origin, including equal-radius frustum representations. Tapered frustums retain
their path. The general fix has no model names or special dimensions. Centred
defaults and a real gap remain intact; France, Italy and Arc01 derivative hashes
remain exact. Limits, tolerances, defaults and source bytes are unchanged.

Sign03 now passes all strict STL screens with 564 triangles, actual editable-source
insertion, byte mismatch refusal before evaluation, attribution/history, raster
preview and Chromium/iPad-WebKit tests. This adds one locally qualified record,
one unique STL and one preview: 133 / 130 / 172 locally, with main at 132 / 129 / 171
after Italy delivery. Prior 101 corpus records and 171 previews remain exact.
See `docs/evidence/uniform-cylinder-sign03-qualification-2026-11-15.json`.


### Authored LDraw internal components, 2026-11-15

Thirty new archived official Part/Shortcut component roots were selected after
excluding aliases, patterns, primitives, shipped roots and historical refusals.
Seventeen pass actual conversion, strict closed-positive-volume mesh screening,
editor insertion/history/provenance and Chromium/iPad-WebKit preview/insertion
checks. These are named unchanged authored component originals with complete
CC-BY-4.0 closures pinned to the existing owned source revision; qualification
covers the standalone component, not its parent assembly or physical operation.
Nominal LDraw units/transforms use the existing converter unchanged.

The seventeen originals add fifteen unique STL hashes: EV3 Square Button99146,
Powered Up Hub Button34745 and Boost Move Hub Button27198 share one exact mesh.
All prior133 record objects,266 source/derivative hashes and172 preview values
remain exact. Local qualified totals become150records/145uniqueSTLs/189previews
from delivered main133/130/172; delivery is recorded separately.

Twelve other roots produced non-manifold output and one refused quad coplanarity
or convexity. These remain A/B unresolved pending source/output tracing; no
intrinsic physical-part defect or archive exhaustion is asserted. Fifteen next
complete authored roots remain queued. No rejected Wall01 construction rule,
parent-module implementation, source/default edits or weaker guard was used.

The first browser provenance assertion failed because newly supplied dependency
grants included build-only localEvidence. Packaging now follows the existing
runtime schema, while root evidence and every dependency source/grant/hash are
preserved. That failure and resource refusals remain in the evidence history.
After actual reserve restoration, regeneration/reproduction, six focused tests,
build and all34 model/browser attachments passed under the original guards.
See docs/evidence/ldraw-components-qualification-2026-11-15.json.


### Next authored LDraw reserve, 2026-11-15

The next fifteen distinct complete authored component roots were executed on
synced main1989504 under the original lock/resource/input/quality limits. Four
pass every actual gate: u9404,99401,u9396 and56474. Their original DAT sources,
complete dependency grants/hashes, defaults, units and transforms are unchanged.
Actual source/STL reproduction, six focused tests, build/typechecks, editor
evaluation/provenance/history and eight Chromium/iPad-WebKit model attachments
pass, including real raster pixels, offline insertion and zero requests.

This cohort adds four records, four unique STLs and four previews: local qualified
totals154/149/193 from delivered main150/145/189. Prior35 LDraw records,300
source/derivative hash entries and189 preview values remain exact; the earlier
seventeen-source cohort is not credited again. Qualification covers only each
standalone authored component, with no physical-operation or parent-assembly claim.

The other eleven new roots produced non-manifold output. Their A/B causes remain
unresolved until source/output tracing. The preceding thirteen refused roots
were not retried, and no kernel/compiler/source/default/tolerance/guard change
or repair was used. This finishes the current fifteen-root reserve, not the
whole staged archive. See docs/evidence/ldraw-reserve-qualification-2026-11-15.json.


### Authored Lighting Ring Separator subcomponent, 2026-11-15

Thirty new dependency-complete authored Subpart roots were executed with the
existing converter after excluding shipped/historical roots, aliases/patterns,
primitives and source-declared partial surfaces. One passes every actual gate:
parts/s/u9465s02.dat, Electric Powered Up Distance Sensor Lighting Ring Separator.
Its unchanged standalone default and complete CC-BY-4.0 closure produce20triangles
with strict closed-positive-volume screening PASS. Source/STL reproduction, six
focused tests, build/typechecks and Chromium/iPad-WebKit attachments pass, including
actual preview pixels, offline insertion, provenance/history and zero requests.
Qualification covers this named component, not its whole parent part or physical
operation. No source/default/converter/kernel/guard/tolerance changes were used.

The local delta is one record, one unique STL and one preview:155/150/194 from
delivered main154/149/193. All prior154 records,308 original/derivative hash entries
and193 preview values remain exact. Twenty-eight other new roots produced
non-manifold output and one refused quad coplanarity/convexity; A/B remains
unresolved pending source/output tracing. The prior24 refusals were not retried.
Twenty next complete authored archive roots remain ranked, without any archive
exhaustion claim. See docs/evidence/ldraw-subcomponent-qualification-2026-11-15.json.


### Exact LDraw facet conformity and authored battery top, 2026-11-15

Exact source/output tracing of parts/u9558.dat found eight unmatched indexed edges whose authored segments pair exactly. The bounded original converter now groups edges by exact rational supporting lines and inserts only existing endpoints inside matching edges. All grouping, sorting and insertion work is charged under the unchanged16384 limit. No coordinates, surfaces, winding, source defaults, tolerances or other guards change. Real tiny gaps and overlapping facets remain refused.

The unchanged five-file CC-BY-4.0 authored battery-top closure uses6689original/20920expanded bytes and2257work. Its148-triangle derived STL passes actual closed-positive-volume screening and editor insertion/restore/provenance/history, including mismatched-byte refusal before evaluation. Normal package/app builds,10focused Vitest tests, complete existing LDraw derivative reproduction, real preview generation and both Chromium/iPad-WebKit workflows pass. Browser attachments bind exact source/STL hashes and actual raster pixels, with zero offline requests.

One local qualification adds one record, one unique STL and one preview:156/151/195 from155/150/194. All prior310 source/mesh hash entries and194 preview values remain unchanged. Delivery is separate until the normal owner PR lands. Other retained failures are not reclassified from this proof; the next repair queue remains staged. This qualifies only the authored standalone component. See docs/evidence/ldraw-exact-conformity-2026-11-15.json.


### Nine authored LDraw components after exact endpoint conformity, 2026-11-15

The retained roots u9289, u9301,32108,u9406,27195,28943,28944,2941 and2893 pass actual conversion, native closed-positive-volume mesh screening, provenance/editor history and preview gates with their exact original default closures. Existing landed exact-endpoint subdivision is reused; no product source, dependency, tolerance, default or guard changes were made. All77focused tests and the final app build pass.

The original aggregate browser command reached its unchanged300-second timeout after completing all9Chromium and4WebKit assertion loops. A necessary continuation ran only the remaining5WebKit cases on the identical built snapshot, passing in168.666seconds with durable per-model results and5actual JSON attachments. The prior13completed loops are bound to the frozen test/log/source/mesh bytes; their unflushed raw attachments are not invented. The original timeout remains recorded. Every model has both engine assertion proofs, including actual raster pixels, offline insertion, provenance, undo/redo and zero requests.

Local qualification adds9records,9unique STLs and9previews to165/160/204 from delivered156/151/195. Prior312asset hash entries and195preview values remain exact. Delivery is credited separately after the owner PR lands. The remaining11repair roots retain unresolved A/B incidence findings; no intrinsic physical-part claim or archive-exhaustion inference follows. See docs/evidence/ldraw-repair9-qualification-2026-11-15.json.


### Two whole authored LDraw parts, 2026-11-15

The exact original default closures of54200(Slope Brick31 1x1x0.667) and3068b(Tile2x2 with Groove) pass native closed-positive-volume screening with80and182triangles respectively, editor insertion/provenance/history and actual raster preview checks. The existing landed endpoint converter is reused; no product/kernel/source/default/tolerance/dependency/guard change was made. The wholePart batch actually attempted27roots:2pass and25return Not manifold. Those25remain A/B unresolved, not intrinsic physical-part judgments.

All19focused tests and the final app build pass. An initial browser parser failure came from a duplicate durable-metadata variable; it produced zero browser outcomes and remains frozen. Only that new metadata binding/serialization was corrected, preserving the original provenance assertions/actions byte-for-byte. Actual Playwright collection passed before a necessary browser-only continuation on47identical built/runtime files. Chromium and iPadWebKit both pass, with4actual source/mesh JSON attachments and4durable records covering raster pixels, zero-network offline insertion, attribution and undo/redo. No native/preview/test/build or delivered-nine replay was used.

Local qualification adds2records,2unique STLs and2previews:167/162/206 from delivered165/160/204. All prior330source/mesh hashes and204preview values remain exact; owner delivery is separate. The next46complete archived named-component roots are candidates only, not qualifications or an archive-exhaustion claim. See docs/evidence/ldraw-wholeparts2-qualification-2026-11-15.json.


### Smooth Primitives authored default, 2026-11-15

Ryan A. Colyer’s complete original `smooth_prim.scad` default demonstration (8818 bytes, pinned commit `0d0038f984465f3eb0f6026a4d5de2f79d2dcea8`) is retained with its exact CC0-1.0 grant. The existing importer and native kernel produce 5220 triangles and a closed positive volume; strict STL screening, source/mesh identity, preview and editor/history gates pass under unchanged limits. This is one authored scene, not a fixture or per-body count, and claims no new compiler capability.

The shared host now bundles supported source files independently of family directories and binds each asset’s original manifest licence evidence before catalogue normalization discards that extension metadata. Focused positive/refusal controls pass, including mismatched source bytes refused before evaluation with document/redo history intact. A missing or substituted declared notice is refused. Both real Chromium and iPad WebKit workflows pass exact CC0 text, editable code insertion, program/source/mesh SHA and complete canonical provenance, undo/redo, actual page restart and zero offline/external requests. The final browser-only continuation uses the identical 41 built files; prior failures remain preserved, including the raw-versus-canonical file assertion corrected by checking the full canonical asset and upstream URL separately.

Local qualification FIRST107 adds one record, one unique STL and one preview: 168/163/207 from delivered 167/162/206. All 334 previous source/mesh SHA entries and 206 previous preview values remain exact. Normal owner delivery is a separate event for this same cohort. The next 43 source-reviewed roots contain 34 byte bounds, eight missing reviewed dependencies and one necessary authored-default array bound; they are not geometry outcomes or archive-exhaustion proof. See [qualification and tested commit binding](evidence/smooth-prim-qualification-2026-11-15.json).


### Circuit Cubes authored pin, 2026-11-16

Philippe Hurbain’s original CC-BY-4.0 `parts/t1098.dat` and complete unchanged 12-file closure qualify with 140 triangles, closed positive volume and 2020/16384 work. The retained native result was not replayed. Four focused checks, one actual preview, final changed-asset build and both Chromium/iPad WebKit offline insertion, exact attribution, undo/redo and restart workflows pass. A general reviewed-source loader reads only declared, hash-verified library paths, with escape, collision and substituted-byte refusals. All 336 prior asset hashes and 207 previews remain exact.

Local qualification FIRST114 adds one record, one unique mesh and one preview: 169/164/208; normal owner delivery is the same cohort. The earlier RAM refusal and two other native NotManifold outcomes remain preserved; the latter are A/B unresolved. The target is 300 genuine editor-usable records. The expanded index is not qualification: full licence and dependency screening precede bounded headless conversion, and only geometry survivors enter editor/browser gates. Experimental outputs never count. See [exact tested source/runtime and gate evidence](evidence/ldraw-expanded-t1098-qualification-2026-11-16.json).
