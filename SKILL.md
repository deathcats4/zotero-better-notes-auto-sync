---
name: zotero-better-notes-obsidian-sync
description: Build and operate a Zotero Better Notes to Obsidian workflow where Codex reads papers, writes Zotero child-note reading cards, queues notes/items with pyzotero, and lets Zotero Actions & Tags call Better Notes auto-sync to create bidirectional Markdown files in Obsidian. Use when setting up or repairing Actions & Tags scripts, queue daemons, Better Notes Markdown auto-sync, Zotero child notes, Obsidian literature notes, or batch processing one Zotero collection into synced Markdown.
---

# Zotero Better Notes Obsidian Sync

## Core model

Use this source chain:

```text
Zotero item/PDF
  -> Codex-created Zotero child note
  -> Actions & Tags queue/manual script inside Zotero
  -> Better Notes syncMDBatch
  -> Obsidian Markdown with Better Notes auto-sync
```

Do not treat a directly written Markdown file as the source note. For this workflow, Codex writes or updates the Zotero child note first, then the Zotero-side bridge asks Better Notes to export/register the Markdown file.

Use paper titles in user-facing messages. Keep Zotero keys as machine identifiers in parentheses, e.g. `《Paper Title》（item: ABCD1234; note: EFGH5678）`.

## Setup workflow

When installing or repairing the Zotero-side bridge, read `references/actions-tags-setup.md`.

1. Confirm Zotero desktop, Better Notes, and Actions & Tags are installed.
2. Choose one bridge:
   - Manual selected action: `scripts/actions-tags-bn-autosync-selected.js`.
   - Lightweight automatic queue: `scripts/actions-tags-bn-queue-daemon.js`.
3. Edit each JS script's constants before installing:
   - `ROOT_DIR`
   - optional `TEMPLATE_NAME`
   - queue/sync tags only if the project needs custom names.
4. Install the script through Actions & Tags, or edit Zotero `prefs.js` only when Zotero is closed and after backing it up.
5. Keep Better Notes auto-sync enabled:
   - `extensions.zotero.Knowledge4Zotero.sync.autoSyncLinkedNotes = true`

Prefer the queue daemon for hands-off Codex workflows. It runs on `mainWindowLoad`, scans `Codex/Queue/BN-Sync`, calls Better Notes, removes the queue tag, and adds `Codex/BN-Synced`.

## Processing workflow

For one paper or a small batch:

1. Resolve the Zotero source from a collection, title, or key.
2. Fetch metadata, existing child notes, annotations, and local PDF/full text where available.
3. Reuse an existing Codex/Better Notes reading note if one exists; otherwise create one child note under the parent item.
4. Write a concise reading card in the Zotero note:
   - metadata
   - one-sentence positioning
   - paper overview
   - your interpretation
   - dated reading pass
   - candidate evidence table
   - review limitations and next checks
5. Keep automatically generated claims at `review/needs-review`.
6. Add `Codex/Queue/BN-Sync` to the note or parent item.
7. Let the Zotero-side queue daemon register it with Better Notes.
8. Verify the queue tag disappeared, `Codex/BN-Synced` appeared, and an `.md` exists in `ROOT_DIR`.

Use `scripts/queue_zotero_items.py` when Codex only needs to add queue tags:

```bash
python scripts/queue_zotero_items.py NOTE_OR_ITEM_KEY
python scripts/queue_zotero_items.py --collection-key COLLECTION_KEY --limit 5
```

The script reads `ZOTERO_LIBRARY_ID`, `ZOTERO_LIBRARY_TYPE`, and `ZOTERO_API_KEY` from the environment.

## Writing rules

Use Chinese for Chinese research projects unless the user asks otherwise. Preserve original English titles, journal names, DOI, citekeys, and quoted terminology where useful.

Do not fabricate page numbers, DOI, methods, isotope values, sample IDs, temperatures, salinities, or figure/table references. If OCR or full text is noisy, say so in the note and keep the evidence at `needs_review`.

Prefer one evolving note per Zotero item. On reread, append a dated reading pass rather than creating another summary note.

Do not promote a generated note into formal evidence, claims, or manuscript text without source review.

## Verification

After processing, check:

- The Zotero child note exists under the correct parent title.
- The note has `Codex/BN-Synced`.
- The note no longer has `Codex/Queue/BN-Sync`.
- The Obsidian Markdown exists under `ROOT_DIR`.
- The Markdown YAML contains `$itemKey` for the Zotero note key.
- The first visible heading matches the paper/note title.

If anything fails, read `references/troubleshooting.md`.

## Bundled resources

- `scripts/actions-tags-bn-autosync-selected.js`: manual selected item/note sync action.
- `scripts/actions-tags-bn-queue-daemon.js`: automatic queue consumer for Zotero startup.
- `scripts/queue_zotero_items.py`: pyzotero helper to add queue tags.
- `references/actions-tags-setup.md`: install and configuration details.
- `references/troubleshooting.md`: common failure modes and fixes.
