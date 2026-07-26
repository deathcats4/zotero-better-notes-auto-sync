# Codex project context

This repository is the long-term GitHub development checkout for the Zotero Better Notes Obsidian sync skill.

## Repository identity

- GitHub remote: https://github.com/deathcats4/zotero-better-notes-auto-sync
- Local development path: `D:\zotero-better-notes-auto-sync`
- Installed Codex skill copy: `C:\Users\Dqm\.codex\skills\zotero-better-notes-obsidian-sync`
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

## Local user project values used in testing

Do not hardcode these into generic documentation unless explicitly asked, but they are useful context for local testing:

- Project ID: `axi-gold`
- Better Notes / Obsidian sync root: `D:\科研知识库\BetterNotesSync\阿希金矿`
- Common template name: `[item]阿希金矿阅读卡`
- Zotero data directory: `D:\Zotero\ZoteroData`
- Zotero profile prefs path: `C:\Users\Dqm\AppData\Roaming\Zotero\Zotero\Profiles\o1onaen4.default\prefs.js`

Only edit Zotero `prefs.js` when Zotero is closed, and back it up first.

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
