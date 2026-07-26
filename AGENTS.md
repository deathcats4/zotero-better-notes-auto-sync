# Codex project context

This repository is the long-term GitHub development checkout for the Zotero Better Notes Obsidian sync skill.

## Repository identity

- GitHub remote: https://github.com/deathcats4/zotero-better-notes-auto-sync
- Local development checkout: use this repository, not an installed skill copy.
- Installed Codex skill copy: keep machine-specific install paths in `AGENTS.local.md`.
- Do not use the installed skill copy as the development workspace. Develop here, then update the installed copy only after review/merge or explicit user approval.

## Current workflow policy

- Do not commit directly to `main` for logic, sync, Zotero, Better Notes, Obsidian, or safety changes.
- Use a feature branch such as `codex/<short-description>`.
- Run local tests before pushing.
- Push the branch and open a draft PR for review.
- Merge to `main` only after the user approves the PR/review result.
- For new functionality, do local testing first; do not rush-push or install into Zotero before the user confirms.

## Project background

The workflow connects:

```text
Zotero item/PDF
  -> Codex-created Zotero child-note reading card
  -> Zotero Actions & Tags script
  -> Better Notes sync/register
  -> Obsidian Markdown in the project sync folder
```

The core goal is to let Codex read papers, write templated Zotero child-note reading cards, queue them with pyzotero or local Zotero-side scripts, and let Better Notes manage Markdown sync to Obsidian.

Important safety choices already made:

- Success tags are added only after Better Notes sync status and Markdown file existence are verified.
- A bad note should not block the whole queue.
- Existing synced Markdown is not force-exported by default, to avoid overwriting newer Obsidian edits.
- Unknown Better Notes sync status fails closed.
- Markdown filename and path are checked before and after export.
- One Zotero note belongs to one project by default; cross-project migration is explicit.
- Zotero backlink blocks are project-scoped and should be idempotent.
- `ENABLE_PROJECT_LINKED_NOTE_AUTOSYNC` is experimental and defaults to `false`; queue processing must stay higher priority than linked-note rechecks.

## Local machine notes

- Keep personal project IDs, Better Notes roots, Zotero data directories, profile paths, and template names in `AGENTS.local.md`.
- `AGENTS.local.md` is ignored by git and should not be committed.
- Only edit Zotero `prefs.js` when Zotero is closed, and back it up first.

## Validation commands

Run from this repository root:

```powershell
python tests\static_checks.py
node tests\safety_logic_checks.js
node -e "const fs=require('fs'); const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor; for (const f of ['scripts/actions-tags-bn-autosync-selected.js','scripts/actions-tags-bn-queue-daemon.js']) { new AsyncFunction(fs.readFileSync(f,'utf8')); console.log('syntax ok', f); }"
git diff --check
```

## User communication preference

The user prefers concise Chinese explanations, concrete file paths, and paper titles before Zotero keys. Avoid too much English terminology when explaining flags or sync behavior.
