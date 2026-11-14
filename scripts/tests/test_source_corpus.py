"""Focused offline provenance and admission boundary checks (stdlib only)."""

import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


spec = importlib.util.spec_from_file_location("source_corpus", Path(__file__).parents[1] / "source-corpus.py")
corpus = importlib.util.module_from_spec(spec)
spec.loader.exec_module(corpus)


class CorpusTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.stage = self.root / "stage"
        self.stage.mkdir()
        self.destination = self.root / "corpus"
        self.files = {"LICENSE": b"MIT License; Copyright Example", "nested/model.scad": b"cube(3);\n"}
        entries = []
        for path, data in self.files.items():
            staged = self.stage / path
            staged.parent.mkdir(parents=True, exist_ok=True)
            staged.write_bytes(data)
            entries.append(dict(path=path, staged_path=path, kind="license" if path == "LICENSE" else "source", spdx="MIT", author_attribution="Example", license_evidence=["LICENSE"], sha256=corpus.digest(data), size_bytes=len(data)))
        self.config = dict(schema_version=1, repositories=[dict(id="example", url="https://github.com/example/cad", commit="a" * 40, license="MIT", reviewed_by="Reviewer", reviewed_at="2026-11-14", captured_at="2026-11-13", usage_notes="Archival only; unqualified.", license_evidence=[dict(path="LICENSE", spdx="MIT", scope="repository", note="Full source and grant reviewed")], files=entries, skipped_files=[dict(path="excluded.scad", reason="Conflicting grant")])])

    def load(self, config=None):
        path = self.root / "config.json"
        path.write_text(json.dumps(config or self.config))
        return corpus.load_config(path)

    def ingest(self, config=None, limit=10000):
        config, config_hash = self.load(config)
        result = corpus.ingest(config, config_hash, self.destination, self.stage, limit, limit)
        corpus.validate(config, config_hash, self.destination)
        return result

    def test_offline_import_retains_paths_bytes_and_provenance(self):
        result = self.ingest()
        source = result["repositories"][0]["files"][1]
        self.assertEqual((self.destination / "repos/example/nested/model.scad").read_bytes(), self.files["nested/model.scad"])
        self.assertEqual(source["render_status"], "unqualified")
        self.assertEqual(source["source_url"], "https://raw.githubusercontent.com/example/cad/" + "a" * 40 + "/nested/model.scad")
        self.assertNotIn("staged_path", source)
        self.assertEqual(source["author_attribution"], "Example")
        self.assertEqual(source["format"], "openscad")
        self.assertEqual(source["captured_at"], "2026-11-13")
        self.assertEqual(source["commit"], "a" * 40)
        self.assertEqual(source["evidence_urls"], ["https://raw.githubusercontent.com/example/cad/" + "a" * 40 + "/LICENSE"])
        self.assertEqual(corpus.report(result)["totals"]["source_files"], 1)
        self.assertEqual(corpus.report(result)["totals"]["evidence_files"], 1)
        self.assertFalse((self.destination / "repos/example/excluded.scad").exists())

    def test_rejects_changed_staged_bytes_before_publication(self):
        (self.stage / "nested/model.scad").write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "mismatch"):
            self.ingest()
        self.assertFalse(self.destination.exists())

    def test_rejects_nonpermissive_license_missing_evidence_and_traversal(self):
        for key, value in (("spdx", "GPL-3.0"), ("spdx", "MIT OR GPL-3.0"), ("license_evidence", ["missing"]), ("path", "../escape.scad"), ("staged_path", "../escape.scad")):
            with self.subTest(key=key, value=value):
                config = copy.deepcopy(self.config)
                config["repositories"][0]["files"][1][key] = value
                with self.assertRaises(ValueError):
                    self.load(config)

    def test_byte_limit_and_symlink_prevent_admission(self):
        with self.assertRaisesRegex(ValueError, "byte limit"):
            self.ingest(limit=1)
        (self.stage / "nested/model.scad").unlink()
        (self.stage / "nested/model.scad").symlink_to(self.stage / "LICENSE")
        with self.assertRaisesRegex(ValueError, "symlink"):
            self.ingest()

    def test_validation_rejects_tamper_and_extra_files(self):
        self.ingest()
        config, config_hash = self.load()
        extra = self.destination / "unreviewed.js"
        extra.write_text("throw Error('never executed')")
        with self.assertRaisesRegex(ValueError, "Unexpected"):
            corpus.validate(config, config_hash, self.destination)
        extra.unlink()
        (self.destination / "repos/example/nested/model.scad").write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "mismatch"):
            corpus.validate(config, config_hash, self.destination)

    def test_additive_update_preserves_existing_sources_and_rejects_removal(self):
        self.ingest()
        updated = copy.deepcopy(self.config)
        entry = copy.deepcopy(updated["repositories"][0]["files"][1])
        entry.update(path="second.js", staged_path="second.js")
        (self.stage / "second.js").write_bytes(self.files["nested/model.scad"])
        updated["repositories"][0]["files"].append(entry)
        self.ingest(updated)
        self.assertTrue((self.destination / "repos/example/second.js").is_file())
        manifest = (self.destination / "manifest.json").read_bytes()
        with self.assertRaisesRegex(ValueError, "remove or change"):
            self.ingest(self.config)
        self.assertEqual((self.destination / "manifest.json").read_bytes(), manifest)

    def test_cross_repository_license_evidence_and_allowed_expression(self):
        config = copy.deepcopy(self.config)
        auxiliary = copy.deepcopy(config["repositories"][0])
        auxiliary.update(id="upstream-notice", role="license-evidence")
        auxiliary["files"] = auxiliary["files"][:1]
        auxiliary["skipped_files"] = []
        config["repositories"].append(auxiliary)
        config["repositories"][0]["files"][1].update(spdx="MIT AND BSD-2-Clause", license_evidence=["LICENSE", "upstream-notice:LICENSE"])
        result = self.ingest(config)
        self.assertEqual(len(result["repositories"][0]["files"][1]["evidence_urls"]), 2)
        self.assertEqual(corpus.report(result)["totals"]["evidence_only_repositories"], 1)

    def test_exclusive_lock_rejects_a_second_writer(self):
        lock = self.root / ".corpus.ingest.lock"
        lock.write_text("another writer")
        with self.assertRaises(FileExistsError):
            self.ingest()
        self.assertEqual(lock.read_text(), "another writer")
        self.assertFalse(self.destination.exists())


if __name__ == "__main__":
    unittest.main()
