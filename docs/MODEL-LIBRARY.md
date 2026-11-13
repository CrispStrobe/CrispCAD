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
is for user-provided geometry and does not yet implement catalogue provenance.

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
(see below). Records for the 34 editable examples and a small CC0 calibration
set remain to be implemented. Preserve original files and derived meshes with their respective
hashes. Before catalogue insertion or attributed STL export, implement project
provenance and attribution sidecars. These later steps are not provided by the
catalogue contract alone.


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
qualification. No STL importer, saved project definition or history revision is
changed; insertion and attributed export still require project provenance and
sidecar support.

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
is produced. Source rights, project provenance, attributed exports and Jolt
qualification remain separate requirements.
