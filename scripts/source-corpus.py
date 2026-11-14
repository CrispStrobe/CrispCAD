#!/usr/bin/env python3
"""Import explicitly reviewed staged CAD files offline; never execute source files."""

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import sys
import tempfile
from urllib.parse import quote


LICENSES = {"MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "0BSD", "CC0-1.0", "CC-BY-3.0", "CC-BY-4.0"}
DEFAULT_CONFIG = "library/corpus-reviewed-sources.json"
DEFAULT_DESTINATION = "library/corpus"
DEFAULT_STAGING = "/mnt/storage"


def fail(message):
    raise ValueError(message)


def relative_path(value):
    if not isinstance(value, str) or not value or "\\" in value:
        fail(f"Invalid repository path: {value!r}")
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in ("", ".", "..") for part in value.split("/")):
        fail(f"Unsafe repository path: {value!r}")
    return value


def digest(data):
    return hashlib.sha256(data).hexdigest()


def allowed_license(value):
    return isinstance(value, str) and all(part in LICENSES for part in re.split(r" (?:AND|OR) ", value))


def load_config(path):
    raw = Path(path).read_bytes()
    config = json.loads(raw)
    if config.get("schema_version") != 1 or not isinstance(config.get("repositories"), list):
        fail("Expected schema_version 1 and repositories array")
    ids = set()
    for repo in config["repositories"]:
        ident = repo.get("id", "")
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", ident) or ident in ids:
            fail(f"Invalid or duplicate repository id: {ident!r}")
        ids.add(ident)
        if not re.fullmatch(r"https://(?:github\.com|codeberg\.org)/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo.get("url", "")):
            fail(f"{ident}: expected an HTTPS GitHub or Codeberg repository URL without .git suffix")
        if repo["url"].endswith(".git"):
            fail(f"{ident}: omit .git URL suffix")
        if not re.fullmatch(r"[0-9a-f]{40}", repo.get("commit", "")):
            fail(f"{ident}: full lowercase 40-character commit required")
        if not allowed_license(repo.get("license")):
            fail(f"{ident}: license is outside the reviewed permissive allowlist")
        for key in ("reviewed_by", "reviewed_at", "captured_at", "usage_notes"):
            if not isinstance(repo.get(key), str) or not repo[key].strip():
                fail(f"{ident}: {key} required")
        evidence = repo.get("license_evidence", [])
        if not evidence:
            fail(f"{ident}: license evidence required")
        evidence_paths = set()
        for entry in evidence:
            relative_path(entry["path"])
            if entry["path"] in evidence_paths:
                fail(f"{ident}: duplicate license evidence path")
            evidence_paths.add(entry["path"])
            if not allowed_license(entry.get("spdx")) or not entry.get("scope") or not entry.get("note"):
                fail(f"{ident}: evidence requires permissive spdx, scope, and review note")
        files = repo.get("files", [])
        paths = set()
        for entry in files:
            path = relative_path(entry["path"])
            if path in paths:
                fail(f"{ident}: duplicate file {path}")
            paths.add(path)
            kind = entry.get("kind")
            if kind not in ("source", "license", "readme"):
                fail(f"{ident}/{path}: invalid file kind")
            if kind == "source" and PurePosixPath(path).suffix.lower() not in (".scad", ".js"):
                fail(f"{ident}/{path}: source must be .scad or .js")
            if not allowed_license(entry.get("spdx")) or not isinstance(entry.get("author_attribution"), str) or not entry["author_attribution"].strip():
                fail(f"{ident}/{path}: explicit permissive spdx and author_attribution required")
            refs = entry.get("license_evidence", [])
            if not refs:
                fail(f"{ident}/{path}: explicit license evidence references required")
            relative_path(entry["staged_path"])
            if not re.fullmatch(r"[0-9a-f]{64}", entry.get("sha256", "")):
                fail(f"{ident}/{path}: invalid expected sha256")
            if type(entry.get("size_bytes")) is not int or entry["size_bytes"] < 0:
                fail(f"{ident}/{path}: invalid expected size_bytes")
        if repo.get("role") != "license-evidence" and not any(entry["kind"] == "source" for entry in files):
            fail(f"{ident}: at least one source file required")
        if not evidence_paths <= paths:
            fail(f"{ident}: every license evidence file must be retained")
        skipped = set()
        for entry in repo.get("skipped_files", []):
            path = relative_path(entry["path"])
            if path in paths or path in skipped or not entry.get("reason"):
                fail(f"{ident}: skipped file must be unique, excluded, and have a reason")
            skipped.add(path)
    all_evidence = {f"{repo['id']}:{entry['path']}" for repo in config["repositories"] for entry in repo["license_evidence"]}
    for repo in config["repositories"]:
        for entry in repo["files"]:
            for ref in entry["license_evidence"]:
                qualified = ref if ":" in ref else f"{repo['id']}:{ref}"
                if qualified not in all_evidence:
                    fail(f"{repo['id']}/{entry['path']}: unknown license evidence {ref}")
    return config, digest(raw)


def raw_url(repo, path):
    if repo["url"].startswith("https://codeberg.org/"):
        return f"{repo['url']}/raw/commit/{repo['commit']}/{quote(path, safe='/')}"
    return f"https://raw.githubusercontent.com/{repo['url'].removeprefix('https://github.com/')}/{repo['commit']}/{quote(path, safe='/')}"


def safe_target(root, relative):
    relative_path(relative)
    target = root / relative
    for candidate in (root, *target.parents, target):
        if candidate.is_symlink():
            fail(f"Refusing symlink: {candidate}")
    return target


def file_record(repo, entry, data):
    result = {key: value for key, value in entry.items() if key != "staged_path"}
    if entry["kind"] == "source":
        result["render_status"] = "unqualified"
    result.update(sha256=digest(data), size_bytes=len(data), source_url=raw_url(repo, entry["path"]))
    for key in ("sha256", "size_bytes"):
        if key in entry and entry[key] != result[key]:
            fail(f"{repo['id']}/{entry['path']}: expected {key} mismatch")
    return result


def make_manifest(config, config_hash, read):
    evidence_urls = {f"{repo['id']}:{entry['path']}": raw_url(repo, entry['path']) for repo in config["repositories"] for entry in repo["license_evidence"]}
    repos = []
    for repo in config["repositories"]:
        result = dict(repo)
        result["files"] = [file_record(repo, entry, read(repo, entry)) for entry in repo["files"]]
        for entry in result["files"]:
            entry["evidence_urls"] = [evidence_urls[ref if ":" in ref else f"{repo['id']}:{ref}"] for ref in entry["license_evidence"]]
            entry.update(repository_url=repo["url"], commit=repo["commit"], captured_at=repo["captured_at"])
            if entry["kind"] == "source":
                entry["format"] = "openscad" if PurePosixPath(entry["path"]).suffix.lower() == ".scad" else "jscad"
        repos.append(result)
    return {"schema_version": 1, "config_sha256": config_hash, "repositories": repos}


def report(manifest):
    libraries = []
    for repo in manifest["repositories"]:
        sources = [entry for entry in repo["files"] if entry["kind"] == "source"]
        evidence = [entry for entry in repo["files"] if entry["kind"] != "source"]
        libraries.append(dict(id=repo["id"], repository_url=repo["url"], commit=repo["commit"], captured_at=repo["captured_at"], source_files=len(sources), source_bytes=sum(entry["size_bytes"] for entry in sources), evidence_files=len(evidence), evidence_bytes=sum(entry["size_bytes"] for entry in evidence), sources_with_dependency_blockers=sum(bool(entry.get("dependency_blockers")) for entry in sources), skipped_files=repo.get("skipped_files", [])))
    totals = {key: sum(library[key] for library in libraries) for key in ("source_files", "source_bytes", "evidence_files", "evidence_bytes", "sources_with_dependency_blockers")}
    totals.update(source_libraries=sum(bool(library["source_files"]) for library in libraries), evidence_only_repositories=sum(not library["source_files"] for library in libraries))
    return dict(schema_version=1, config_sha256=manifest["config_sha256"], render_status="unqualified", totals=totals, libraries=libraries)


def validate(config, config_hash, destination):
    def read(repo, entry):
        return safe_target(destination, f"repos/{repo['id']}/{entry['path']}").read_bytes()
    expected = make_manifest(config, config_hash, read)
    manifest_path = safe_target(destination, "manifest.json")
    if json.loads(manifest_path.read_bytes()) != expected:
        fail("Manifest differs from reviewed configuration or retained file bytes")
    paths = {"manifest.json"}
    for repo in config["repositories"]:
        paths.update(f"repos/{repo['id']}/{entry['path']}" for entry in repo["files"])
    actual = set()
    for path in destination.rglob("*"):
        if path.is_symlink():
            fail(f"Refusing symlink: {path}")
        if path.is_file():
            actual.add(path.relative_to(destination).as_posix())
    if actual != paths:
        fail(f"Unexpected or missing corpus files: {sorted(actual.symmetric_difference(paths))}")
    return expected


def ingest(config, config_hash, destination, staging, max_file_bytes, max_total_bytes):
    destination.parent.mkdir(parents=True, exist_ok=True)
    lock = safe_target(destination.parent, f".{destination.name}.ingest.lock")
    # Exclusive creation serializes local writers; a crash leaves a visible stale lock.
    with lock.open("x") as handle:
        handle.write(f"pid={os.getpid()}\n")
    try:
        return _ingest(config, config_hash, destination, staging, max_file_bytes, max_total_bytes)
    finally:
        lock.unlink()


def _ingest(config, config_hash, destination, staging, max_file_bytes, max_total_bytes):
    # Never check out repositories, run package managers, or evaluate CAD scripts.
    if max_file_bytes <= 0 or max_total_bytes <= 0:
        fail("Byte limits must be positive")
    staging.mkdir(parents=True, exist_ok=True)
    total = 0
    with tempfile.TemporaryDirectory(prefix="ingest-", dir=staging) as work:
        work = Path(work)

        def fetch(repo, entry):
            nonlocal total
            source = safe_target(staging, entry["staged_path"])
            size = source.stat().st_size
            if size > max_file_bytes or total + size > max_total_bytes:
                fail(f"{repo['id']}/{entry['path']}: staged byte limit exceeded")
            with source.open("rb") as handle:
                data = handle.read(min(max_file_bytes, max_total_bytes - total) + 1)
            if len(data) != size:
                fail("Staged file changed while reading")
            total += len(data)
            file_record(repo, entry, data)
            path = work / f"repos/{repo['id']}/{entry['path']}"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            return data

        manifest = make_manifest(config, config_hash, fetch)
        (work / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
        validate(config, config_hash, work)
        # Publish only after all pinned files and evidence have been read and verified.
        destination.parent.mkdir(parents=True, exist_ok=True)
        safe_target(destination.parent, destination.name)
        if destination.exists():
            old = json.loads(safe_target(destination, "manifest.json").read_bytes())
            old_paths = {"manifest.json"}
            for repo in old["repositories"]:
                for entry in repo["files"]:
                    path = f"repos/{repo['id']}/{relative_path(entry['path'])}"
                    old_paths.add(path)
                    retained = safe_target(destination, path).read_bytes()
                    if digest(retained) != entry["sha256"] or len(retained) != entry["size_bytes"]:
                        fail(f"Existing corpus has modified bytes: {path}")
                    candidate = safe_target(work, path)
                    if not candidate.is_file() or candidate.read_bytes() != retained:
                        fail(f"Reviewed update would remove or change retained bytes: {path}")
            actual = {p.relative_to(destination).as_posix() for p in destination.rglob("*") if p.is_file()}
            if actual != old_paths or any(p.is_symlink() for p in destination.rglob("*")):
                fail("Existing corpus has unexpected files or symlinks")
            added = []
            try:
                for source in work.rglob("*"):
                    if not source.is_file() or source == work / "manifest.json":
                        continue
                    relative = source.relative_to(work).as_posix()
                    if relative in old_paths:
                        continue
                    target = safe_target(destination, relative)
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with target.open("xb") as output:
                        added.append(target)
                        with source.open("rb") as input_file:
                            shutil.copyfileobj(input_file, output)
                # Replace the manifest only after all additional files are present.
                with tempfile.NamedTemporaryFile(dir=destination, prefix=".manifest-", delete=False) as handle:
                    temporary_manifest = Path(handle.name)
                    handle.write((work / "manifest.json").read_bytes())
                os.replace(temporary_manifest, destination / "manifest.json")
            except BaseException:
                for path in added:
                    path.unlink(missing_ok=True)
                if "temporary_manifest" in locals():
                    temporary_manifest.unlink(missing_ok=True)
                raise
            validate(config, config_hash, destination)
            return manifest
        # A sibling temporary directory keeps publication on one filesystem.
        with tempfile.TemporaryDirectory(prefix=".corpus-", dir=destination.parent) as publish:
            ready = Path(publish) / "ready"
            shutil.copytree(work, ready)
            os.rename(ready, destination)
        return manifest


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("ingest", "validate", "report"))
    parser.add_argument("--config", default=DEFAULT_CONFIG)
    parser.add_argument("--destination", default=DEFAULT_DESTINATION)
    parser.add_argument("--staging", default=DEFAULT_STAGING)
    parser.add_argument("--max-file-bytes", type=int, default=2_000_000)
    parser.add_argument("--max-total-bytes", type=int, default=25_000_000)
    args = parser.parse_args(argv)
    try:
        config, config_hash = load_config(args.config)
        destination = Path(args.destination).absolute()
        if args.command == "ingest":
            manifest = ingest(config, config_hash, destination, Path(args.staging).resolve(), args.max_file_bytes, args.max_total_bytes)
        else:
            manifest = validate(config, config_hash, destination)
        if args.command == "report":
            print(json.dumps(report(manifest), indent=2, ensure_ascii=False))
            return 0
        files = [entry for repo in manifest["repositories"] for entry in repo["files"]]
        print(f"{args.command}: {len(manifest['repositories'])} repositories, {len(files)} files, {sum(entry['size_bytes'] for entry in files)} bytes verified")
        return 0
    except (ValueError, OSError, KeyError, TypeError) as error:
        print(f"source-corpus: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
