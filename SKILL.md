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
   - `PROJECT_ID`
   - `ROOT_DIR`
   - `TEMPLATE_NAME`, preferably `[item]Codex 中英文献精读卡` after importing `templates/codex-literature-reading-card.better-notes.yml`
   - optional `LIBRARY_IDS` in the daemon for group libraries or multiple libraries.
4. Install the script through Actions & Tags, or edit Zotero `prefs.js` only when Zotero is closed and after backing it up.
5. Ask the user to manually confirm Better Notes linked-note auto-sync is enabled. Do not silently set `extensions.zotero.Knowledge4Zotero.sync.autoSyncLinkedNotes` from a script.

Prefer the queue daemon for hands-off Codex workflows. It runs on `mainWindowLoad`, searches for `Codex/Queue/BN-Sync/<PROJECT_ID>`, calls Better Notes one note at a time only when registration/export is needed, removes the queue tag only after sync verification, and adds `Codex/BN-Synced/<PROJECT_ID>` only on verified success. The optional already-linked-note autosync layer is experimental, default-off, queue-empty-only, throttled per note, and must keep Better Notes `skipActive: true`; if a Better Notes promise times out, the daemon keeps the note lock and suspends further linked-note autosync in that Zotero session until the original promise settles. Daemon timer and busy state are keyed by `PROJECT_ID`, so multiple projects can stay resident at the same time; re-running the same `PROJECT_ID` daemon clears and replaces the old timer so configuration changes take effect.

## Processing workflow

For one paper or a small batch:

1. Resolve the Zotero source from a collection, title, or key.
2. Fetch metadata, existing child notes, annotations, and local PDF/full text where available.
3. Reuse an existing project-scoped Codex/Better Notes reading note if one exists; otherwise create one child note under the parent item.
4. Write or revise the reading card using the `[item]Codex 中英文献精读卡` structure:
   - 文献信息
   - 一句话定位
   - 摘要与研究问题
   - 方法与数据
   - 核心结论
   - 证据候选表
   - 标注与摘录整理
   - 我的判断
   - 待人工复核
   - Codex 状态
5. Keep automatically generated claims at `review/needs-review`.
6. Add `Codex/Queue/BN-Sync/<PROJECT_ID>` to the note or parent item.
7. Let the Zotero-side queue daemon register it with Better Notes.
8. Verify the queue tag disappeared, `Codex/BN-Synced/<PROJECT_ID>` appeared, no error tag remains, Better Notes sync status `path` exactly equals `ROOT_DIR`, and its safe `filename` points to an existing Markdown file under `ROOT_DIR`.

Use `scripts/queue_zotero_items.py` when Codex only needs to add queue tags:

```bash
python scripts/queue_zotero_items.py NOTE_OR_ITEM_KEY --project-id PROJECT_ID
python scripts/queue_zotero_items.py --collection-key COLLECTION_KEY --limit 5 --project-id PROJECT_ID
```

The script reads `ZOTERO_LIBRARY_ID`, `ZOTERO_LIBRARY_TYPE`, `ZOTERO_API_KEY`, and optionally `ZOTERO_BN_PROJECT_ID` from the environment.

Use `scripts/export_zotero_evidence_pack.py` when Codex needs to read existing Zotero child notes and PDF annotations before writing or revising a reading card. It exports AI-readable JSON/Markdown evidence with stable `evidence_id` values and Zotero PDF deep links, but it does not write Zotero, call Better Notes, or modify Obsidian files.

```bash
python scripts/export_zotero_evidence_pack.py ITEM_KEY --format markdown
python scripts/export_zotero_evidence_pack.py --all-top --limit 50 --only-annotated --summary
```

## State rules

- Use `Codex/BN-Initializing/<PROJECT_ID>` while a newly created project note is being populated. For existing nonempty notes, never overwrite content just because the marker is missing or the text is short; treat images, tables, links, citations, annotations, and embedded media as content; add the project marker and tags in place. Only truly empty notes may be initialized with template/fallback content.
- Add `Codex/BN-Synced/<PROJECT_ID>` only after Better Notes reports `path === ROOT_DIR`, a safe filename, and an existing Markdown file under `ROOT_DIR`.
- On explicit queue/manual sync, clear stale project error comments and save the note before sync verification. If the note is already registered under `ROOT_DIR` and the Markdown file exists, do not call `syncMDBatch` by default; let Better Notes handle normal bidirectional sync to avoid overwriting Obsidian edits. Re-export only when the Markdown file is confirmed missing and `RECREATE_MISSING_MARKDOWN = true`, or when `FORCE_EXPORT_EXISTING = true`. If file existence cannot be checked, fail with `sync_file_check_failed` and keep the queue. If missing-file recreation is disabled, fail and keep the queue rather than marking success.
- Fail closed with `sync_status_check_failed` when Better Notes `getSyncStatus()` or `isSyncNote()` is unavailable or throws. Unknown sync status must never be treated as an unsynced note.
- Before calling `syncMDBatch`, use Better Notes `getMDFileName(noteID, ROOT_DIR)` and fail closed when the API is missing, throws, or returns an unsafe/non-`.md` filename. Keep the post-write `path + filename` verification as a second defense.
- Treat one Zotero note as owned by one sync project by default. If a note has another project's queue/success/note/error/initializing tags, marker, or Better Notes status under another root, fail with `cross_project_note_conflict`; use a separate child note per project unless the user explicitly enables migration. When migration is explicitly enabled and succeeds, remove other-project ownership tags and markers from the note while leaving old Markdown files untouched.
- On failure, keep or restore `Codex/Queue/BN-Sync/<PROJECT_ID>`, add `Codex/BN-Sync-Error/<PROJECT_ID>`, remove the success tag, and preserve only a redacted short error message in the note comment if a note exists. Detailed local paths belong in `Zotero.debug`, not synced note content.
- If Markdown sync succeeds but Zotero state save fails, restore the original queue-tag placement and surface `sync_succeeded_state_save_failed`.
- On success, leave stale project error comments removed before export so Markdown does not receive old error markers.
- In the queue daemon, `ENABLE_PROJECT_LINKED_NOTE_AUTOSYNC` is experimental and defaults to `false`. If explicitly enabled, it may call Better Notes `hooks.onSyncing()` only when the new queue is empty, one note at a time, with `skipActive: true`, timeout/cooldown/recheck protection, and candidate rotation. A timeout does not cancel Better Notes' internal promise; keep the local note lock and suspend further linked-note autosync until that promise settles. This is not a forced `syncMDBatch` export; it uses Better Notes' bidirectional compare/import/export logic and must not bypass active visible note protection.
- Do not use `isSyncNote(noteID)` alone as proof of success; it does not prove the note is synced to this project's `ROOT_DIR`, and it does not validate the Markdown filename.
- Process queued notes one at a time so one bad note does not block the rest of the batch.
- Use the shared in-process item/note locks in both manual and daemon scripts to avoid duplicate child-note creation when both entry points process the same item.
- Avoid Actions & Tags duplicate multi-select execution by ignoring per-item callbacks when both `items` and `item` are injected.
- Do not silently mutate global Better Notes preferences.

## Writing rules

Use Chinese for Chinese research projects unless the user asks otherwise. Preserve original English titles, journal names, DOI, citekeys, and quoted terminology where useful.

Do not fabricate page numbers, DOI, methods, isotope values, sample IDs, temperatures, salinities, or figure/table references. If OCR or full text is noisy, say so in the note and keep the evidence at `needs_review`.

Prefer one evolving note per Zotero item. On reread, append a dated reading pass rather than creating another summary note.

Do not promote a generated note into formal evidence, claims, or manuscript text without source review.

## Verification

After processing, check:

- The Zotero child note exists under the correct parent title.
- The note has `Codex/BN-Note/<PROJECT_ID>`.
- The note has `Codex/BN-Synced/<PROJECT_ID>`.
- The note no longer has `Codex/Queue/BN-Sync/<PROJECT_ID>`.
- The note does not have `Codex/BN-Sync-Error/<PROJECT_ID>`.
- Better Notes `getSyncStatus(noteID).path` exactly equals `ROOT_DIR`, the filename is safe, and the combined file exists under `ROOT_DIR`.
- The Obsidian Markdown exists under `ROOT_DIR`.
- The Markdown YAML contains `$itemKey` for the Zotero note key.
- The first visible heading matches the paper/note title.

Do not treat the success tag alone as sufficient verification.

If anything fails, read `references/troubleshooting.md`.

## Bundled resources

- `scripts/actions-tags-bn-autosync-selected.js`: manual selected item/note sync action.
- `scripts/actions-tags-bn-queue-daemon.js`: automatic queue consumer for Zotero startup.
- `scripts/queue_zotero_items.py`: pyzotero helper to add project-scoped queue tags.
- `scripts/export_zotero_evidence_pack.py`: pyzotero helper to read metadata, child notes, and PDF annotations for AI evidence retrieval.
- `templates/codex-literature-reading-card.better-notes.yml`: Better Notes item template for `[item]Codex 中英文献精读卡`.
- `references/actions-tags-setup.md`: install and configuration details.
- `references/better-notes-reading-card-template.md`: reading-card template import and usage instructions.
- `references/troubleshooting.md`: common failure modes and fixes.
- `COMPATIBILITY.md`: locally verified Zotero/plugin/pyzotero versions and API assumptions.
- `tests/static_checks.py`: lightweight static regression checks for critical state-machine invariants.
