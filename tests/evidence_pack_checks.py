#!/usr/bin/env python
"""Offline checks for Zotero evidence-pack export helpers."""

from __future__ import annotations

import importlib.util
from pathlib import Path
from types import SimpleNamespace


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "export_zotero_evidence_pack.py"


def load_module():
    spec = importlib.util.spec_from_file_location("export_zotero_evidence_pack", SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError("Could not load export_zotero_evidence_pack.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FakeZotero:
    def __init__(self) -> None:
        self.items = {
            "ITEM1": {
                "key": "ITEM1",
                "data": {
                    "itemType": "journalArticle",
                    "title": "Pyrite Sulfur Isotopes in a Test Deposit",
                    "creators": [{"firstName": "Ada", "lastName": "Lovelace", "creatorType": "author"}],
                    "publicationTitle": "Journal of Test Geology",
                    "DOI": "10.0000/test",
                    "tags": [{"tag": "axi-gold"}],
                },
            },
            "NOTE1": {
                "key": "NOTE1",
                "data": {
                    "itemType": "note",
                    "parentItem": "ITEM1",
                    "note": "<h1>Reading card</h1><p>Useful sulfur isotope context.</p>",
                },
            },
            "ATT1": {
                "key": "ATT1",
                "data": {"itemType": "attachment", "parentItem": "ITEM1", "title": "Full Text PDF"},
            },
            "ANN1": {
                "key": "ANN1",
                "data": {
                    "itemType": "annotation",
                    "parentItem": "ATT1",
                    "annotationType": "highlight",
                    "annotationText": "Sulfur isotope values indicate a mixed source.",
                    "annotationComment": "Candidate evidence for source discussion.",
                    "annotationPageLabel": "2",
                    "annotationSortIndex": "00002|00001",
                },
            },
            "ANN2": {
                "key": "ANN2",
                "data": {
                    "itemType": "annotation",
                    "parentItem": "ATT1",
                    "annotationType": "note",
                    "annotationComment": "Alteration assemblage note.",
                    "annotationPageLabel": "5",
                    "annotationSortIndex": "00005|00001",
                },
            },
        }
        self.children_map = {
            "ITEM1": [self.items["NOTE1"], self.items["ATT1"], self.items["ANN1"]],
            "ATT1": [self.items["ANN1"], self.items["ANN2"]],
        }

    def item(self, key: str):
        return self.items[key]

    def children(self, key: str):
        return self.children_map.get(key, [])

    def everything(self, query):
        return list(query)

    def collection_items(self, _key: str):
        return [self.items["ITEM1"], self.items["ATT1"]]

    def collection_items_top(self, _key: str):
        return [self.items["ITEM1"]]

    def top(self):
        return [self.items["ITEM1"]]


def make_args(**overrides):
    values = {
        "max_note_chars": 12000,
        "max_annotation_chars": 4000,
        "query": [],
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def test_html_to_text(module) -> None:
    assert module.html_to_text("<h1>Title</h1><p>Hello<br>world</p>") == "Title\nHello\nworld"


def test_collect_evidence_pack(module) -> None:
    pack = module.collect_evidence_pack(FakeZotero(), "ITEM1", make_args())
    assert pack["metadata"]["title"] == "Pyrite Sulfur Isotopes in a Test Deposit"
    assert pack["counts"]["child_notes"] == 1
    assert pack["counts"]["annotations"] == 2
    assert [annotation["annotation_key"] for annotation in pack["annotations"]] == ["ANN1", "ANN2"]
    first = pack["annotations"][0]
    assert first["evidence_id"] == "ANN-ITEM1-001"
    assert first["citation_hint"] == "《Pyrite Sulfur Isotopes in a Test Deposit》 p. 2 [ANN-ITEM1-001]"
    assert first["zotero_open_pdf_uri"] == "zotero://open-pdf/library/items/ATT1?page=2&annotation=ANN1"
    assert "sulfur isotope context" in pack["child_notes"][0]["note_text"]


def test_query_filter(module) -> None:
    pack = module.collect_evidence_pack(FakeZotero(), "ITEM1", make_args(query=["mixed source"]))
    assert pack["counts"]["annotations"] == 1
    assert pack["annotations"][0]["annotation_key"] == "ANN1"
    assert pack["counts"]["child_notes"] == 0


def test_source_key_collection(module) -> None:
    args = make_args(keys=[], collection_key="COLL1", all_top=False, limit=0)
    assert module.collect_source_keys(FakeZotero(), args) == ["ITEM1"]


def main() -> int:
    module = load_module()
    test_html_to_text(module)
    test_collect_evidence_pack(module)
    test_query_filter(module)
    test_source_key_collection(module)
    print("Evidence pack checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
