# Excluded and blocked source audit

Capture date: 2026-11-13; admission review: 2026-11-14. This audit records admission decisions, not a blanket
legal opinion about a site or repository. External access is read-only.

The owner's November 14 outcome brief supersedes the earlier whole-corpus hold.
Independently reviewed permissive subsets are admitted immediately; unresolved
files remain excluded individually. See [actual counts and sizes](admission-report.md)
and the [pinned per-file manifest](../corpus/manifest.json).

The owner explicitly excluded dotSCAD, NopSCADlib, Constructive Library, BOLTS,
Mark's Enclosure Helper, Tray Library, STEMFIE, and Wooden doll house from this
corpus. They are not fetched or admitted by the ingest configuration. This list
is a scope exclusion; it does not assert that every file has the same licence.

Thingiverse and Hugging Face datasets are blocked from bulk ingestion. Neither a
platform's terms nor a dataset loader's software licence proves the rights of
every model. Admission requires individually verified content grants, attribution,
exact source/evidence URLs and captured file hashes. No dataset has been mirrored.

Nine of the 1,415 staged source files remain quarantined:

| Library | Excluded paths | Evidence boundary |
| --- | --- | --- |
| BOSL | `involute_gears.scad` | Public-domain wording differs from the root BSD grant; no explicit allowlisted CC0 grant captured. |
| BOSL2 | `joiners.scad` | Embedded snap-pin code has an unspecified-version Attribution Share-Alike grant; keep outside this permissive collection. |
| BOSL2 | `isosurface.scad` | Adapted lookup tables have no captured upstream grant. |
| UB.scad | `libraries/ub.scad`, `UBscadDoku/ub22.212Doxy.scad` | Wikibooks LineORG provenance remains unresolved; these files also contain separately attributed MIT material. |
| Asset Collection | `Asset_SCAD/Pipe_45.scad` | Contradictory GPL-2.0 and MIT notices. |
| Board Game Toolkit | `shapes.scad` | Embedded Thingiverse cloud code has an unresolved upstream grant. |
| Technic.scad | `customizers/Beam.scad`, `customizers/Connector Hub.scad` | Embedded LGPL-3.0 dotSCAD code; Connector Hub also has unresolved strings.scad lineage. |

LEGO.scad was not staged: its root MIT notice does not resolve the licence of
its credited Thingiverse-derived content. Technic's `lib/gears` submodule has an
NC-SA grant and is excluded. Other unreviewed submodules are excluded too.
SCON's `scon_from_json.js` is a conversion utility, not a JSCAD model; the staged
corpus contains no JSCAD `.js` models. Existing separately reviewed JSCAD seeds
are unchanged.

Repository-specific skips, source identity mappings and per-file evidence are
recorded with the reviewed corpus configuration and its generated manifest.
Quarantined dependencies may make archival sources unsuitable for direct use;
this collection is not a claim that source programs compile, render, or qualify
for insertion, printing or collision simulation.
