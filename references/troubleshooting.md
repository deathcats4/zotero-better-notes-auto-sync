# Troubleshooting

Use this reference when the Zotero-to-Obsidian Better Notes bridge does not behave as expected.

## `could not parse path`

Symptom:

```text
Script Error: Could not make directory ... could not parse path
NS_ERROR_FILE_UNRECOGNIZED_PATH
```

Cause: `ROOT_DIR` uses a forward-slash Windows path such as `D:/Vault/...`.

Fix: use a native Windows path:

```js
const ROOT_DIR = "D:\\ObsidianVault\\BetterNotesSync\\PROJECT_NAME";
```

Create the folder once from Windows or PowerShell if needed.

## The action is missing after editing `prefs.js`

Cause: Zotero was open and overwrote `prefs.js` on exit, or the Actions & Tags rules array does not include the action key.

Fix:

1. Close Zotero.
2. Back up `prefs.js`.
3. Confirm `extensions.actionsTags.rules` includes the action key.
4. Confirm `extensions.actionsTags.rules.<key>` contains valid JSON-in-a-string.
5. Reopen Zotero.

## Queue tag does not disappear

Possible causes:

- Zotero desktop has not synced the pyzotero change yet.
- The daemon action is not installed with `event = mainWindowLoad`.
- The queue tag project ID does not match between Python and JS.
- Better Notes API is unavailable inside Zotero.
- The queued object is an attachment rather than a regular item or note.
- The item has `Codex/BN-Sync-Error/<PROJECT_ID>` and is being skipped until the error tag is cleared.

Checks:

- Confirm the item/note has `Codex/Queue/BN-Sync/<PROJECT_ID>` in Zotero desktop.
- Confirm the JS script uses the same `PROJECT_ID`.
- Restart Zotero so `mainWindowLoad` fires.
- Watch for `Codex/BN-Sync-Error/<PROJECT_ID>`.
- Try the manual selected action on the same note.

## Error tag is present

The daemon leaves the queue tag in place and adds `Codex/BN-Sync-Error/<PROJECT_ID>` when registration fails. This avoids false success and prevents a bad note from blocking the rest of the queue.

Default behavior:

- error-tagged items are skipped on later polling ticks;
- the note, if available, receives an HTML comment with a redacted short error message;
- clear the error tag after fixing the cause to retry.
- a later successful retry removes the project error marker before sync verification, so Markdown does not keep the old error marker.

Common causes:

- `ROOT_DIR` does not exist or is not writable.
- Better Notes failed to convert the note to Markdown.
- The note was already linked to a different root and Better Notes did not update the sync status.
- Better Notes auto-sync is disabled globally.
- Zotero state saving failed after Markdown sync succeeded; this is reported as `sync_succeeded_state_save_failed`.

## `sync_succeeded_state_save_failed`

This means Better Notes export/registration succeeded, but saving Zotero tags or note content failed afterward.

Expected recovery behavior:

- the script restores the original `Codex/Queue/BN-Sync/<PROJECT_ID>` tag placement in memory before writing error state;
- the item receives `Codex/BN-Sync-Error/<PROJECT_ID>`;
- the success tag is removed;
- after fixing the Zotero save issue, clear the error tag and let the queue daemon retry.

## Markdown exists but is in the wrong project folder

Cause: the note may already be a Better Notes sync note for another project/root.

Fix:

1. Use a project-specific `PROJECT_ID`.
2. Confirm the note has `Codex/BN-Note/<PROJECT_ID>` and `Codex/BN-Synced/<PROJECT_ID>`, not a generic success tag.
3. Confirm `getSyncStatus(noteID).path + filename` resolves to an existing file under the configured `ROOT_DIR`.
4. Re-run the manual action; the script attempts to re-register notes whose sync status points to a different root.
5. Review the old Markdown copy in the previous folder. The script does not delete or move it automatically because it may belong to another project.

## Template note keeps duplicating after sync errors

The current scripts use `Codex/BN-Initializing/<PROJECT_ID>` while creating/recovering a note, then switch to `Codex/BN-Note/<PROJECT_ID>` only after content and marker are saved. If duplicates still appear, check whether the installed Actions & Tags script is an older copy that does not include `INITIALIZING_TAG`.

Fix:

1. Update the installed Actions & Tags script from this repository.
2. Keep one intended child note.
3. Add `Codex/BN-Note/<PROJECT_ID>` to that note.
4. Remove duplicate generated notes after confirming they are not needed.

## Re-queued note does not rewrite Markdown

This is expected for already-linked notes. If `getSyncStatus(noteID).path + filename` points to an existing Markdown file under `ROOT_DIR`, the scripts default to `already_linked` and do not call `syncMDBatch`. This avoids overwriting Obsidian edits that Better Notes has not yet synced back to Zotero.

Use one of these safer options:

1. Wait for Better Notes auto-sync to settle, then check Zotero note content.
2. Delete or move the stale Markdown file if you want the script to recreate it.
3. Temporarily set `FORCE_EXPORT_EXISTING = true` only when you intentionally want Zotero note content to overwrite Markdown.

## Markdown exists but does not update immediately

Better Notes uses its own sync period, commonly `syncPeriodSeconds = 30`. For testing, a project can lower it to 5-10 seconds. Avoid 1 second for large note sets.

The scripts do not silently enable Better Notes auto-sync. If auto-sync is disabled, initial export/register may still work, but future bidirectional updates may not run automatically.

## Personal library vs group library

The Python helper can target `user` or `group` libraries through `ZOTERO_LIBRARY_TYPE`.

The Zotero-side daemon defaults to personal library only:

```js
const LIBRARY_IDS = [];
```

To process group libraries, set `LIBRARY_IDS` to Zotero internal library IDs. If Python queues a group library item but the daemon scans only the personal library, the queue tag will remain unprocessed.

## What pyzotero can and cannot do

Pyzotero can create/update Zotero items and notes and add queue tags. It cannot call `Zotero.BetterNotes.api` directly because that API exists only inside the Zotero desktop process. Use Actions & Tags or a Zotero plugin as the Zotero-side bridge.
