# Actions & Tags setup

Use this reference when installing or repairing the Zotero-side bridge.

## Preconditions

- Zotero desktop is installed and syncs the target library.
- Better Notes / Knowledge4Zotero is installed and enabled.
- Actions & Tags is installed and enabled.
- The Obsidian target folder exists or can be created.
- If editing `prefs.js` directly, close Zotero first and back up `prefs.js`.

## Script choices

Use `scripts/actions-tags-bn-autosync-selected.js` for a manual menu action:

- Event: `none`
- Operation: `custom script`
- Menu: `Codex: BN auto-sync selected to Obsidian`
- Item menu: enabled

Use `scripts/actions-tags-bn-queue-daemon.js` for the lightweight automatic queue:

- Event: `mainWindowLoad`
- Operation: `custom script`
- Enabled: true
- Menu: blank or hidden

The daemon scans for `Codex/Queue/BN-Sync`, calls `Zotero.BetterNotes.api.$export.syncMDBatch`, removes the queue tag, and adds `Codex/BN-Synced`.

## Required script edits

Edit constants near the top of each JS script before installing:

```js
const ROOT_DIR = "D:\\ObsidianVault\\BetterNotesSync\\PROJECT_NAME";
const TEMPLATE_NAME = "";
```

Use Windows native backslashes in `ROOT_DIR`. Avoid `D:/...` paths because Zotero's Firefox runtime can reject them with `NS_ERROR_FILE_UNRECOGNIZED_PATH`.

## Verification

After running the manual action or daemon:

- Zotero note has `Codex/BN-Synced`.
- Zotero note no longer has `Codex/Queue/BN-Sync`.
- A Markdown file exists under `ROOT_DIR`.
- The Markdown YAML contains `$itemKey` matching the Zotero note key.

If a note is already synced, the selected action should report `alreadySynced=1` rather than creating another note.
