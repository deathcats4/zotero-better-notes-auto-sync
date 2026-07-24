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
- Better Notes API is unavailable inside Zotero.
- The queued object is an attachment rather than a regular item or note.

Checks:

- Confirm the item/note has `Codex/Queue/BN-Sync` in Zotero desktop.
- Restart Zotero so `mainWindowLoad` fires.
- Watch for `Codex/BN-Sync-Error`.
- Try the manual selected action on the same note.

## Markdown exists but does not update immediately

Better Notes uses its own sync period, commonly `syncPeriodSeconds = 30`. For testing, a project can lower it to 5-10 seconds. Avoid 1 second for large note sets.

## What pyzotero can and cannot do

Pyzotero can create/update Zotero items and notes and add queue tags. It cannot call `Zotero.BetterNotes.api` directly because that API exists only inside the Zotero desktop process. Use Actions & Tags or a Zotero plugin as the Zotero-side bridge.
