# Actions & Tags setup

Use this reference when installing or repairing the Zotero-side bridge.

## Preconditions

- Zotero desktop is installed and syncs the target library.
- Better Notes / Knowledge4Zotero is installed and enabled.
- Actions & Tags is installed and enabled.
- The Obsidian target folder exists or can be created.
- Better Notes linked-note auto-sync is manually enabled if you want ongoing bidirectional sync.
- If editing `prefs.js` directly, close Zotero first and back up `prefs.js`.

The scripts intentionally do not turn on Better Notes auto-sync automatically, because that preference is global and can affect unrelated Better Notes linked notes.

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

The daemon searches for `Codex/Queue/BN-Sync/<PROJECT_ID>`, clears stale project error markers before sync verification, calls `Zotero.BetterNotes.api.$export.syncMDBatch` one note at a time only when registration/export is needed, removes the queue tag only after verified success, and adds `Codex/BN-Synced/<PROJECT_ID>`. It also stores timers and busy locks by `PROJECT_ID`, so multiple project daemons can run in one Zotero session. Re-running the same `PROJECT_ID` daemon clears and replaces the previous timer so config changes take effect without restarting Zotero.

## Required script edits

Edit constants near the top of each JS script before installing:

```js
const PROJECT_ID = "axi-gold";
const ROOT_DIR = "D:\\ObsidianVault\\BetterNotesSync\\axi-gold";
const TEMPLATE_NAME = "";
```

Keep this default unless you intentionally want Zotero note content to overwrite an existing Markdown file:

```js
const FORCE_EXPORT_EXISTING = false;
```

For the daemon, personal library is the default. To scan group libraries or multiple libraries, edit:

```js
const LIBRARY_IDS = [];
```

Use Zotero internal library IDs, not web group IDs, when configuring `LIBRARY_IDS`.

Use Windows native backslashes in `ROOT_DIR`. Avoid `D:/...` paths because Zotero's Firefox runtime can reject them with `NS_ERROR_FILE_UNRECOGNIZED_PATH`.

## Queue tags

The default pyzotero helper tag must match the JS `PROJECT_ID`:

```powershell
$env:ZOTERO_BN_PROJECT_ID="axi-gold"
python scripts/queue_zotero_items.py NOTE_OR_ITEM_KEY
```

or:

```powershell
python scripts/queue_zotero_items.py NOTE_OR_ITEM_KEY --project-id axi-gold
```

## Verification

After running the manual action or daemon:

- Zotero note has `Codex/BN-Synced/<PROJECT_ID>`.
- Zotero note has `Codex/BN-Note/<PROJECT_ID>`.
- Zotero note no longer has `Codex/Queue/BN-Sync/<PROJECT_ID>`.
- Zotero note does not have `Codex/BN-Sync-Error/<PROJECT_ID>`.
- Better Notes `getSyncStatus(noteID).path + filename` resolves to an existing file under `ROOT_DIR`.
- A Markdown file exists under `ROOT_DIR`.
- The Markdown YAML contains `$itemKey` matching the Zotero note key.

If a note is already synced to this project root and its Markdown file exists, the selected action should report `alreadyLinked` and should not call `syncMDBatch`. If the Markdown file is missing, the script re-exports it. If it is synced to a different root, the script attempts to re-register it under the current `ROOT_DIR` and leaves any old Markdown copy for the user to review.

If Markdown sync succeeds but Zotero state saving fails, the script restores the original queue tag placement and reports `sync_succeeded_state_save_failed` so the item can be retried after the save problem is fixed.
