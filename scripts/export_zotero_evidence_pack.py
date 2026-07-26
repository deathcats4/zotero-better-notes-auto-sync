#!/usr/bin/env python
"""Export Zotero child notes and PDF annotations as AI-readable evidence packs.

Credentials are read from:
  ZOTERO_LIBRARY_ID
  ZOTERO_LIBRARY_TYPE  (default: user)
  ZOTERO_API_KEY

Examples:
  python scripts/export_zotero_evidence_pack.py ITEMKEY --format markdown
  python scripts/export_zotero_evidence_pack.py --collection-key COLLECTIONKEY --only-annotated --summary
  python scripts/export_zotero_evidence_pack.py --all-top --limit 20 --only-annotated
"""

from __future__ import annotations

import argparse
import html
import json
import os
import re
import sys
from pathlib import Path
from typing import Any
from urllib.parse import urlencode


DEFAULT_LIBRARY_TYPE = os.environ.get("ZOTERO_LIBRARY_TYPE", "user")
BLOCK_TAG_RE = re.compile(r"</?(p|div|li|tr|h[1-6]|br|blockquote|table|thead|tbody|th|td)[^>]*>", re.IGNORECASE)
TAG_RE = re.compile(r"<[^>]+>")
WHITESPACE_RE = re.compile(r"[ \t\r\f\v]+")
PAGE_NUMBER_RE = re.compile(r"\d+")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Export Zotero metadata, child notes, and PDF annotations into a JSON or Markdown evidence pack "
            "that an AI agent can read and cite."
        )
    )
    parser.add_argument("keys", nargs="*", help="Zotero item, attachment, note, or annotation keys to export.")
    parser.add_argument("--collection-key", help="Export regular items from this Zotero collection.")
    parser.add_argument("--all-top", action="store_true", help="Scan top-level library items. Use --limit for testing.")
    parser.add_argument("--limit", type=int, default=0, help="Limit collection/all-top source items. 0 means no limit.")
    parser.add_argument("--only-annotated", action="store_true", help="Skip items with no PDF annotations after filtering.")
    parser.add_argument("--summary", action="store_true", help="Output one compact summary record per item instead of full evidence.")
    parser.add_argument("--query", action="append", default=[], help="Keep notes/annotations containing this text. Repeat to require more terms.")
    parser.add_argument("--format", choices=["json", "markdown"], default="json", help="Output format. Default: json.")
    parser.add_argument("--output", help="Write output to this file instead of stdout.")
    parser.add_argument("--max-note-chars", type=int, default=12000, help="Truncate each note text/html field to this many chars. 0 disables.")
    parser.add_argument(
        "--max-annotation-chars",
        type=int,
        default=4000,
        help="Truncate each annotation text/comment field to this many chars. 0 disables.",
    )
    return parser.parse_args()


def client() -> Any:
    library_id = os.environ.get("ZOTERO_LIBRARY_ID")
    api_key = os.environ.get("ZOTERO_API_KEY")
    library_type = os.environ.get("ZOTERO_LIBRARY_TYPE", "user")
    if not library_id or not api_key:
        raise SystemExit("Missing ZOTERO_LIBRARY_ID or ZOTERO_API_KEY.")

    from pyzotero import zotero

    return zotero.Zotero(library_id, library_type, api_key)


def library_segment(library_id: str | int | None = None, library_type: str | None = None) -> str:
    lib_type = library_type or DEFAULT_LIBRARY_TYPE
    if lib_type == "group":
        group_id = str(library_id or os.environ.get("ZOTERO_LIBRARY_ID") or "").strip()
        return f"groups/{group_id}" if group_id else "groups"
    return "library"


def item_data(item: dict[str, Any] | None) -> dict[str, Any]:
    return item.get("data", {}) if item else {}


def item_type(item: dict[str, Any] | None) -> str:
    return str(item_data(item).get("itemType") or "")


def tags_from_data(data: dict[str, Any]) -> list[str]:
    tags: list[str] = []
    for tag in data.get("tags") or []:
        value = tag.get("tag") if isinstance(tag, dict) else tag
        if value:
            tags.append(str(value))
    return tags


def creators_from_data(data: dict[str, Any]) -> list[dict[str, str]]:
    creators: list[dict[str, str]] = []
    for creator in data.get("creators") or []:
        if not isinstance(creator, dict):
            continue
        name = creator.get("name") or " ".join(
            part for part in [creator.get("firstName"), creator.get("lastName")] if part
        )
        if name:
            creators.append({"name": str(name), "creatorType": str(creator.get("creatorType") or "")})
    return creators


def html_to_text(value: str | None) -> str:
    if not value:
        return ""
    with_breaks = BLOCK_TAG_RE.sub("\n", value)
    without_tags = TAG_RE.sub("", with_breaks)
    unescaped = html.unescape(without_tags)
    compact_lines = [WHITESPACE_RE.sub(" ", line).strip() for line in unescaped.splitlines()]
    return "\n".join(line for line in compact_lines if line)


def clip(value: Any, max_chars: int) -> str:
    text = "" if value is None else str(value)
    if max_chars and len(text) > max_chars:
        return text[: max_chars - 1].rstrip() + "…"
    return text


def title_for_item(item: dict[str, Any]) -> str:
    data = item_data(item)
    title = data.get("title") or data.get("shortTitle")
    if title:
        return str(title)
    note_text = html_to_text(data.get("note"))
    if note_text:
        return note_text.splitlines()[0][:100]
    return str(item.get("key") or "")


def zotero_select_uri(item_key: str, segment: str) -> str:
    return f"zotero://select/{segment}/items/{item_key}"


def zotero_open_pdf_uri(attachment_key: str, segment: str, page_label: str | None = None, annotation_key: str | None = None) -> str:
    params: dict[str, str] = {}
    if page_label:
        params["page"] = page_label
    if annotation_key:
        params["annotation"] = annotation_key
    suffix = f"?{urlencode(params)}" if params else ""
    return f"zotero://open-pdf/{segment}/items/{attachment_key}{suffix}"


def fetch_children(zot: Any, key: str) -> list[dict[str, Any]]:
    return list(zot.everything(zot.children(key)))


def fetch_attachment_annotations(zot: Any, attachment: dict[str, Any], warnings: list[dict[str, str]]) -> list[dict[str, Any]]:
    key = str(attachment.get("key") or "")
    if not key:
        return []
    try:
        return [child for child in fetch_children(zot, key) if item_type(child) == "annotation"]
    except Exception as exc:  # noqa: BLE001 - non-PDF supplementary files cannot have annotation children.
        warnings.append({"attachment_key": key, "message": str(exc).splitlines()[-1] if str(exc).splitlines() else str(exc)})
        return []


def iter_limited_query(zot: Any, query_result: Any, limit: int = 0) -> list[dict[str, Any]]:
    if limit:
        return list(query_result)[:limit]
    return list(zot.everything(query_result))


def resolve_regular_item(zot: Any, key: str) -> dict[str, Any]:
    item = zot.item(key)
    data = item_data(item)
    if data.get("itemType") not in {"attachment", "note", "annotation"}:
        return item
    parent_key = data.get("parentItem")
    if not parent_key:
        return item
    return resolve_regular_item(zot, str(parent_key))


def query_matches(text: str, queries: list[str]) -> bool:
    if not queries:
        return True
    haystack = text.lower()
    return all(query.lower() in haystack for query in queries if query)


def annotation_sort_key(annotation: dict[str, Any], attachment_key: str) -> tuple[str, int, str, str]:
    data = item_data(annotation)
    page_label = str(data.get("annotationPageLabel") or "")
    page_match = PAGE_NUMBER_RE.search(page_label)
    page_number = int(page_match.group(0)) if page_match else 10**9
    sort_index = str(data.get("annotationSortIndex") or "")
    return (attachment_key, page_number, sort_index, str(annotation.get("key") or ""))


def build_metadata(item: dict[str, Any], segment: str) -> dict[str, Any]:
    data = item_data(item)
    key = str(item.get("key") or "")
    return {
        "key": key,
        "itemType": data.get("itemType"),
        "title": title_for_item(item),
        "creators": creators_from_data(data),
        "date": data.get("date"),
        "publicationTitle": data.get("publicationTitle") or data.get("proceedingsTitle") or data.get("bookTitle"),
        "DOI": data.get("DOI"),
        "url": data.get("url"),
        "abstractNote": data.get("abstractNote"),
        "tags": tags_from_data(data),
        "dateAdded": data.get("dateAdded"),
        "dateModified": data.get("dateModified"),
        "zotero_select_uri": zotero_select_uri(key, segment) if key else "",
    }


def build_note_record(note: dict[str, Any], parent: dict[str, Any], segment: str, max_chars: int) -> dict[str, Any]:
    data = item_data(note)
    key = str(note.get("key") or "")
    note_html = str(data.get("note") or "")
    note_text = html_to_text(note_html)
    return {
        "kind": "note",
        "note_key": key,
        "parent_item_key": parent.get("key"),
        "title": title_for_item(note),
        "note_text": clip(note_text, max_chars),
        "note_html": clip(note_html, max_chars),
        "tags": tags_from_data(data),
        "dateAdded": data.get("dateAdded"),
        "dateModified": data.get("dateModified"),
        "zotero_select_uri": zotero_select_uri(key, segment) if key else "",
        "review_status": "needs_review",
    }


def build_annotation_record(
    annotation: dict[str, Any],
    attachment: dict[str, Any],
    parent: dict[str, Any],
    evidence_id: str,
    segment: str,
    max_chars: int,
) -> dict[str, Any]:
    data = item_data(annotation)
    attachment_data = item_data(attachment)
    annotation_key = str(annotation.get("key") or "")
    attachment_key = str(attachment.get("key") or data.get("parentItem") or "")
    page_label = data.get("annotationPageLabel")
    text = data.get("annotationText") or ""
    comment = data.get("annotationComment") or ""
    title = title_for_item(parent)
    citation_bits = [f"《{title}》"]
    if page_label:
        citation_bits.append(f"p. {page_label}")
    citation_bits.append(f"[{evidence_id}]")

    return {
        "kind": "annotation",
        "evidence_id": evidence_id,
        "parent_item_key": parent.get("key"),
        "parent_title": title,
        "attachment_key": attachment_key,
        "attachment_title": attachment_data.get("title"),
        "annotation_key": annotation_key,
        "annotation_type": data.get("annotationType"),
        "annotation_text": clip(text, max_chars),
        "annotation_comment": clip(comment, max_chars),
        "annotation_color": data.get("annotationColor"),
        "page_label": page_label,
        "sort_index": data.get("annotationSortIndex"),
        "position": data.get("annotationPosition"),
        "tags": tags_from_data(data),
        "dateAdded": data.get("dateAdded"),
        "dateModified": data.get("dateModified"),
        "zotero_open_pdf_uri": zotero_open_pdf_uri(attachment_key, segment, str(page_label) if page_label else None, annotation_key),
        "citation_hint": " ".join(citation_bits),
        "review_status": "needs_review",
    }


def collect_evidence_pack(zot: Any, item_key: str, args: argparse.Namespace) -> dict[str, Any]:
    parent = resolve_regular_item(zot, item_key)
    segment = library_segment(item_data(parent).get("libraryID") or parent.get("library", {}).get("id"), os.environ.get("ZOTERO_LIBRARY_TYPE"))
    parent_key = str(parent.get("key") or item_key)

    children = fetch_children(zot, parent_key)
    child_notes = [child for child in children if item_type(child) == "note"]
    attachments = [child for child in children if item_type(child) == "attachment"]
    direct_annotations = [child for child in children if item_type(child) == "annotation"]
    warnings: list[dict[str, str]] = []

    notes = [build_note_record(note, parent, segment, args.max_note_chars) for note in child_notes]
    annotations_by_attachment: list[tuple[dict[str, Any], dict[str, Any]]] = []

    for attachment in attachments:
        attachment_key = str(attachment.get("key") or "")
        for annotation in fetch_attachment_annotations(zot, attachment, warnings):
            annotations_by_attachment.append((attachment, annotation))

    for annotation in direct_annotations:
        attachment_key = item_data(annotation).get("parentItem")
        attachment = next((candidate for candidate in attachments if candidate.get("key") == attachment_key), None)
        if attachment is None:
            attachment = {"key": attachment_key or "", "data": {"itemType": "attachment", "title": attachment_key or ""}}
        annotations_by_attachment.append((attachment, annotation))

    seen_annotation_keys: set[str] = set()
    unique_annotations: list[tuple[dict[str, Any], dict[str, Any]]] = []
    for attachment, annotation in annotations_by_attachment:
        key = str(annotation.get("key") or "")
        if key and key in seen_annotation_keys:
            continue
        if key:
            seen_annotation_keys.add(key)
        unique_annotations.append((attachment, annotation))

    unique_annotations.sort(key=lambda pair: annotation_sort_key(pair[1], str(pair[0].get("key") or "")))
    annotations = [
        build_annotation_record(
            annotation,
            attachment,
            parent,
            f"ANN-{parent_key}-{index:03d}",
            segment,
            args.max_annotation_chars,
        )
        for index, (attachment, annotation) in enumerate(unique_annotations, start=1)
    ]

    pack = {
        "schema": "codex.zotero-evidence-pack.v1",
        "metadata": build_metadata(parent, segment),
        "counts": {
            "child_notes": len(notes),
            "attachments": len(attachments),
            "annotations": len(annotations),
        },
        "child_notes": notes,
        "annotations": annotations,
        "warnings": warnings,
    }
    return filter_pack(pack, args.query)


def record_text(record: dict[str, Any]) -> str:
    return "\n".join(
        str(value)
        for value in [
            record.get("title"),
            record.get("note_text"),
            record.get("note_html"),
            record.get("annotation_text"),
            record.get("annotation_comment"),
            " ".join(record.get("tags") or []),
            record.get("citation_hint"),
        ]
        if value
    )


def filter_pack(pack: dict[str, Any], queries: list[str]) -> dict[str, Any]:
    if not queries:
        return pack
    notes = [note for note in pack["child_notes"] if query_matches(record_text(note), queries)]
    annotations = [annotation for annotation in pack["annotations"] if query_matches(record_text(annotation), queries)]
    filtered = dict(pack)
    filtered["child_notes"] = notes
    filtered["annotations"] = annotations
    filtered["counts"] = dict(pack["counts"])
    filtered["counts"]["child_notes"] = len(notes)
    filtered["counts"]["annotations"] = len(annotations)
    return filtered


def pack_summary(pack: dict[str, Any]) -> dict[str, Any]:
    metadata = pack["metadata"]
    samples = []
    for annotation in pack["annotations"][:3]:
        samples.append(
            {
                "evidence_id": annotation["evidence_id"],
                "page_label": annotation.get("page_label"),
                "text": clip(annotation.get("annotation_text"), 220),
                "zotero_open_pdf_uri": annotation.get("zotero_open_pdf_uri"),
            }
        )
    return {
        "key": metadata.get("key"),
        "title": metadata.get("title"),
        "itemType": metadata.get("itemType"),
        "annotation_count": pack["counts"]["annotations"],
        "child_note_count": pack["counts"]["child_notes"],
        "zotero_select_uri": metadata.get("zotero_select_uri"),
        "sample_annotations": samples,
    }


def collect_source_keys(zot: Any, args: argparse.Namespace) -> list[str]:
    source_keys: list[str] = []
    seen: set[str] = set()
    query_kwargs = {"limit": args.limit} if args.limit else {}

    def add_key(key: Any) -> None:
        key_text = str(key or "").strip()
        if key_text and key_text not in seen:
            seen.add(key_text)
            source_keys.append(key_text)

    for key in args.keys:
        add_key(key)

    if args.collection_key:
        count = 0
        for item in iter_limited_query(zot, zot.collection_items_top(args.collection_key, **query_kwargs), args.limit):
            if item_type(item) == "attachment":
                continue
            add_key(item.get("key"))
            count += 1
            if args.limit and count >= args.limit:
                break

    if args.all_top:
        count = 0
        for item in iter_limited_query(zot, zot.top(**query_kwargs), args.limit):
            add_key(item.get("key"))
            count += 1
            if args.limit and count >= args.limit:
                break

    return source_keys


def render_markdown(packs: list[dict[str, Any]], summary: bool = False) -> str:
    lines = ["# Zotero Evidence Pack", ""]
    for pack in packs:
        if summary:
            item = pack_summary(pack)
            lines.append(f"## {item['title']}")
            lines.append(f"- Zotero: {item['zotero_select_uri']}")
            lines.append(f"- Annotations: {item['annotation_count']}; child notes: {item['child_note_count']}")
            for sample in item["sample_annotations"]:
                page = f"p. {sample['page_label']}" if sample.get("page_label") else "page unknown"
                lines.append(f"- {sample['evidence_id']} ({page}): {sample['text']} [{sample['zotero_open_pdf_uri']}]")
            lines.append("")
            continue

        metadata = pack["metadata"]
        lines.append(f"## {metadata.get('title')}")
        lines.append(f"- Zotero: {metadata.get('zotero_select_uri')}")
        if metadata.get("DOI"):
            lines.append(f"- DOI: {metadata.get('DOI')}")
        if metadata.get("publicationTitle"):
            lines.append(f"- Source: {metadata.get('publicationTitle')}")
        lines.append(f"- Counts: annotations={pack['counts']['annotations']}; child_notes={pack['counts']['child_notes']}")
        lines.append("")

        if pack["child_notes"]:
            lines.append("### Child Notes")
            for note in pack["child_notes"]:
                lines.append(f"#### {note['title']}")
                lines.append(f"- Zotero: {note['zotero_select_uri']}")
                if note["note_text"]:
                    lines.append("")
                    lines.append(note["note_text"])
                lines.append("")

        if pack["annotations"]:
            lines.append("### Annotations")
            for annotation in pack["annotations"]:
                page = f"p. {annotation['page_label']}" if annotation.get("page_label") else "page unknown"
                lines.append(f"#### {annotation['evidence_id']} ({page})")
                if annotation.get("annotation_text"):
                    lines.append(f"> {annotation['annotation_text']}")
                if annotation.get("annotation_comment"):
                    lines.append(f"- Comment: {annotation['annotation_comment']}")
                lines.append(f"- Zotero: {annotation['zotero_open_pdf_uri']}")
                lines.append(f"- Citation hint: {annotation['citation_hint']}")
                lines.append("")

    return "\n".join(lines).rstrip() + "\n"


def write_output(payload: Any, args: argparse.Namespace) -> None:
    if args.format == "markdown":
        text = render_markdown(payload, summary=args.summary)
    else:
        text = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"

    if args.output:
        Path(args.output).write_text(text, encoding="utf-8")
    else:
        print(text, end="")


def main() -> int:
    args = parse_args()
    if not args.keys and not args.collection_key and not args.all_top:
        raise SystemExit("Pass item keys, --collection-key, or --all-top.")

    zot = client()
    source_keys = collect_source_keys(zot, args)
    packs: list[dict[str, Any]] = []
    seen_parent_keys: set[str] = set()
    errors: list[dict[str, str]] = []

    for key in source_keys:
        try:
            parent = resolve_regular_item(zot, key)
            parent_key = str(parent.get("key") or key)
            if parent_key in seen_parent_keys:
                continue
            seen_parent_keys.add(parent_key)
            pack = collect_evidence_pack(zot, parent_key, args)
            if args.only_annotated and pack["counts"]["annotations"] == 0:
                continue
            packs.append(pack)
        except Exception as exc:  # noqa: BLE001 - keep batch export best-effort.
            errors.append({"key": key, "error": str(exc)})

    payload: Any
    if args.summary:
        payload = {
            "schema": "codex.zotero-evidence-summary.v1",
            "source_count": len(source_keys),
            "item_count": len(packs),
            "failed": len(errors),
            "items": [pack_summary(pack) for pack in packs],
            "errors": errors,
        }
    else:
        payload = {
            "schema": "codex.zotero-evidence-export.v1",
            "source_count": len(source_keys),
            "item_count": len(packs),
            "failed": len(errors),
            "items": packs,
            "errors": errors,
        }

    write_output(payload if args.format == "json" else packs, args)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
