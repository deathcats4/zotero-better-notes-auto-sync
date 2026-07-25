# Compatibility

This workflow depends on internal Zotero plugin APIs, so compatibility should be treated as a tested surface rather than a stable public contract.

## Locally verified environment

The current scripts were reviewed against this local environment:

| Component | Version / status |
| --- | --- |
| Zotero desktop | 9.0.6 |
| Better Notes for Zotero / Knowledge4Zotero | 3.3.0-beta.4, active |
| Actions and Tags for Zotero | 2.5.2, active |
| pyzotero | 1.11.0 |
| OS | Windows |

`requirements.txt` pins `pyzotero>=1.11.0,<1.14.0`: 1.11.0 is the locally verified version, and the upper bound avoids silently installing future incompatible API changes.

## Better Notes APIs used

The scripts expect these APIs to exist inside the Zotero desktop process:

```js
Zotero.BetterNotes.api.$export.syncMDBatch(saveDir, noteIds, metaList)
Zotero.BetterNotes.api.sync.isSyncNote(noteId)
Zotero.BetterNotes.api.sync.getSyncStatus(noteId)
Zotero.BetterNotes.api.sync.getMDFileName(noteId, saveDir)
Zotero.BetterNotes.api.template.runItemTemplate(...)
Zotero.BetterNotes.api.note.insert(...)
```

`syncMDBatch`, `isSyncNote`, `getSyncStatus`, and `getMDFileName` are required for safe core Markdown sync registration. `getMDFileName` is used as a pre-write filename safety check before Better Notes writes any Markdown. Template APIs are optional; the scripts fall back to built-in HTML reading-card content when no template is configured.

## Actions & Tags behavior assumed

The manual selected-item script assumes Actions & Tags may call custom scripts twice during multi-select:

1. one bulk call with `items=[all selected]` and `item=undefined`;
2. one per-item callback with `items=[]` and `item=<single item>`.

The manual script intentionally ignores the per-item callback when both `items` and `item` are injected, to avoid duplicate note creation and duplicate Better Notes calls.

## Caveat

If Better Notes or Actions & Tags changes these internal APIs, this skill may need updates. For large libraries or long-running unattended automation, a dedicated Zotero bridge plugin with notifier-based processing is a more robust architecture.
