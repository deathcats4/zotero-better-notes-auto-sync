#!/usr/bin/env python
"""Queue Zotero items or notes for the Actions & Tags Better Notes daemon.

Credentials are read from:
  ZOTERO_LIBRARY_ID
  ZOTERO_LIBRARY_TYPE  (default: user)
  ZOTERO_API_KEY

Project scoping:
  By default the queue tag is Codex/Queue/BN-Sync/<PROJECT_ID>.
  Set ZOTERO_BN_PROJECT_ID or pass --project-id so it matches the Zotero-side JS.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any

from pyzotero import zotero


DEFAULT_PROJECT_ID = os.environ.get("ZOTERO_BN_PROJECT_ID", "PROJECT_NAME")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Add a project-scoped queue tag to Zotero item/note keys so the Zotero-side daemon syncs them with Better Notes."
    )
    parser.add_argument("keys", nargs="*", help="Zotero item or note keys to queue.")
    parser.add_argument("--collection-key", help="Queue top-level regular items from this collection.")
    parser.add_argument(
        "--project-id",
        default=DEFAULT_PROJECT_ID,
        help=f"Project identifier used in default queue tags. Default: {DEFAULT_PROJECT_ID}",
    )
    parser.add_argument(
        "--tag",
        default=None,
        help="Queue tag to add. Overrides --project-id. Default: Codex/Queue/BN-Sync/<PROJECT_ID>",
    )
    parser.add_argument("--limit", type=int, default=0, help="Limit collection items processed. 0 means no limit.")
    parser.add_argument("--include-notes", action="store_true", help="When using --collection-key, include note items too.")
    parser.add_argument("--dry-run", action="store_true", help="Report what would change without updating Zotero.")
    return parser.parse_args()


def queue_tag(args: argparse.Namespace) -> str:
    return args.tag or f"Codex/Queue/BN-Sync/{args.project_id}"


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
        collection_added = 0
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
            collection_added += 1
            if args.limit and collection_added >= args.limit:
                break

    return items


def main() -> int:
    args = parse_args()
    if not args.keys and not args.collection_key:
        raise SystemExit("Pass item/note keys or --collection-key.")

    zot = client()
    items = collect_items(zot, args)
    tag = queue_tag(args)
    results: list[dict[str, Any]] = []

    for item in items:
        data = item["data"]
        changed = add_tag(data, tag)
        updated = False
        error = None
        if changed and not args.dry_run:
            try:
                zot.update_item(item)
                updated = True
            except Exception as exc:  # noqa: BLE001 - keep batch queueing best-effort.
                error = str(exc)
        results.append(
            {
                "key": item["key"],
                "title": item_title(item),
                "itemType": data.get("itemType"),
                "queued": changed,
                "updated": updated,
                "dry_run": args.dry_run,
                "error": error,
            }
        )

    failed = sum(1 for item in results if item["error"])
    print(
        json.dumps(
            {"queue_tag": tag, "project_id": args.project_id, "count": len(results), "failed": failed, "items": results},
            ensure_ascii=False,
            indent=2,
        )
    )
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
