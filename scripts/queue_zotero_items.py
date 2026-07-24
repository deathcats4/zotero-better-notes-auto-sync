#!/usr/bin/env python
"""Queue Zotero items or notes for the Actions & Tags Better Notes daemon.

Credentials are read from:
  ZOTERO_LIBRARY_ID
  ZOTERO_LIBRARY_TYPE  (default: user)
  ZOTERO_API_KEY
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any

from pyzotero import zotero


DEFAULT_QUEUE_TAG = "Codex/Queue/BN-Sync"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Add a queue tag to Zotero item/note keys so the Zotero-side daemon syncs them with Better Notes."
    )
    parser.add_argument("keys", nargs="*", help="Zotero item or note keys to queue.")
    parser.add_argument("--collection-key", help="Queue top-level regular items from this collection.")
    parser.add_argument("--tag", default=DEFAULT_QUEUE_TAG, help=f"Queue tag to add. Default: {DEFAULT_QUEUE_TAG}")
    parser.add_argument("--limit", type=int, default=0, help="Limit collection items processed. 0 means no limit.")
    parser.add_argument("--include-notes", action="store_true", help="When using --collection-key, include note items too.")
    parser.add_argument("--dry-run", action="store_true", help="Report what would change without updating Zotero.")
    return parser.parse_args()


def client() -> zotero.Zotero:
    library_id = os.environ.get("ZOTERO_LIBRARY_ID")
    api_key = os.environ.get("ZOTERO_API_KEY")
    library_type = os.environ.get("ZOTERO_LIBRARY_TYPE", "user")
    if not library_id or not api_key:
        raise SystemExit("Missing ZOTERO_LIBRARY_ID or ZOTERO_API_KEY.")
    return zotero.Zotero(library_id, library_type, api_key)


def item_title(item: dict[str, Any]) -> str:
    data = item.get("data", {})
    title = data.get("title")
    if title:
        return title
    note = data.get("note") or ""
    if note:
        return note.replace("\n", " ")[:80]
    return item.get("key", "")


def add_tag(data: dict[str, Any], tag: str) -> bool:
    tags = data.setdefault("tags", [])
    if any(t.get("tag") == tag for t in tags):
        return False
    tags.append({"tag": tag})
    return True


def collect_items(zot: zotero.Zotero, args: argparse.Namespace) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    seen: set[str] = set()

    for key in args.keys:
        item = zot.item(key)
        if item["key"] not in seen:
            items.append(item)
            seen.add(item["key"])

    if args.collection_key:
        collection_items = zot.everything(zot.collection_items(args.collection_key))
        for item in collection_items:
            data = item.get("data", {})
            item_type = data.get("itemType")
            if item_type == "attachment":
                continue
            if item_type == "note" and not args.include_notes:
                continue
            if item["key"] in seen:
                continue
            items.append(item)
            seen.add(item["key"])
            if args.limit and len(items) >= args.limit:
                break

    return items


def main() -> int:
    args = parse_args()
    if not args.keys and not args.collection_key:
        raise SystemExit("Pass item/note keys or --collection-key.")

    zot = client()
    items = collect_items(zot, args)
    results: list[dict[str, Any]] = []

    for item in items:
        data = item["data"]
        changed = add_tag(data, args.tag)
        if changed and not args.dry_run:
            zot.update_item(item)
        results.append(
            {
                "key": item["key"],
                "title": item_title(item),
                "itemType": data.get("itemType"),
                "queued": changed,
                "dry_run": args.dry_run,
            }
        )

    print(json.dumps({"queue_tag": args.tag, "count": len(results), "items": results}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
