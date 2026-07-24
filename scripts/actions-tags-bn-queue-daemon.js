/**
 * Codex: Better Notes queue daemon for Zotero Actions & Tags
 *
 * Intended Actions & Tags setup:
 * - Event: mainWindowLoad
 * - Operation: custom script
 * - Enabled: true
 * - Menu: optional/blank
 *
 * How it works:
 * - Codex/pyzotero adds QUEUE_TAG to a Zotero item or note.
 * - This script runs inside Zotero, scans the user library every POLL_SECONDS.
 * - For regular items, it creates/reuses one child note.
 * - For notes, it syncs the selected/queued note directly.
 * - It calls Better Notes syncMDBatch(ROOT_DIR, noteIds).
 * - On success it removes QUEUE_TAG and adds SYNC_TAG.
 */

// Edit these before pasting the script into Actions & Tags.
// Use Windows native backslashes, not D:/forward/slashes.
const ROOT_DIR = "D:\\ObsidianVault\\BetterNotesSync\\PROJECT_NAME";
const QUEUE_TAG = "Codex/Queue/BN-Sync";
const SYNC_TAG = "Codex/BN-Synced";
const ERROR_TAG = "Codex/BN-Sync-Error";
const REVIEW_TAG = "review/needs-review";
const CODEX_MARKER_PREFIX = "codex-bn-sync:";
const BN_AUTOSYNC_PREF = "extensions.zotero.Knowledge4Zotero.sync.autoSyncLinkedNotes";
const POLL_SECONDS = 8;
const MAX_PER_TICK = 8;

function escapeHTML(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function hasTag(zoteroItem, tag) {
  return zoteroItem.getTags().some((t) => t.tag === tag);
}

async function ensureDir(path) {
  if (typeof IOUtils !== "undefined" && IOUtils.makeDirectory) {
    await IOUtils.makeDirectory(path, { ignoreExisting: true });
    return;
  }
  const { OS } = ChromeUtils.importESModule("chrome://zotero/content/osfile.mjs");
  await OS.File.makeDir(path, { from: null, ignoreExisting: true });
}

function enableBetterNotesAutoSyncPref() {
  try {
    if (Zotero.Prefs.get(BN_AUTOSYNC_PREF, true) !== true) {
      Zotero.Prefs.set(BN_AUTOSYNC_PREF, true, true);
    }
  } catch (e) {
    Zotero.debug("[Codex BN Queue] Could not set Better Notes auto-sync pref: " + e);
  }
}

function getParentRegularItem(rawItem) {
  if (rawItem?.isRegularItem && rawItem.isRegularItem()) return rawItem;
  if (rawItem?.parentID) {
    const parent = Zotero.Items.get(rawItem.parentID);
    if (parent?.isRegularItem && parent.isRegularItem()) return parent;
  }
  return null;
}

function getCreatorsText(parentItem) {
  return parentItem
    .getCreators()
    .map((creator) => [creator.firstName, creator.lastName].filter(Boolean).join(" "))
    .filter(Boolean)
    .join("; ");
}

function buildFallbackHTML(parentItem) {
  const title = parentItem.getField("title") || "Untitled";
  const year = parentItem.getField("date") || "";
  const doi = parentItem.getField("DOI") || "";
  const creators = getCreatorsText(parentItem);

  return `
<h1>Better Notes 阅读卡 - ${escapeHTML(title)}</h1>
<p><strong>Codex 状态：</strong>由 Codex 队列守护脚本创建/复用，并通过 Better Notes Markdown Sync 绑定到 Obsidian。</p>

<h2>Zotero 元数据</h2>
<ul>
<li><strong>Zotero key：</strong>${parentItem.key}</li>
<li><strong>作者：</strong>${escapeHTML(creators)}</li>
<li><strong>年份：</strong>${escapeHTML(year)}</li>
<li><strong>DOI：</strong>${escapeHTML(doi)}</li>
<li><strong>Review status：</strong>needs_review</li>
</ul>

<h2>一句话定位</h2>
<p>待 Codex 结合 PDF / 批注 / 已有笔记补充。</p>

<h2>研究问题</h2>
<ul>
<li>这篇文献回答了什么问题？</li>
<li>它对当前项目的作用是什么？</li>
<li>哪些结论可以转化为证据矩阵？</li>
</ul>

<h2>候选证据</h2>
<table>
<thead><tr><th>candidate_id</th><th>候选论点</th><th>位置</th><th>审核状态</th></tr></thead>
<tbody><tr><td>CAND-${parentItem.key}-001</td><td>待补充</td><td>待核对页码/图表</td><td>needs_review</td></tr></tbody>
</table>

<p><!-- ${CODEX_MARKER_PREFIX}${parentItem.key} --></p>
`;
}

function findExistingCodexNote(parentItem) {
  const noteIDs = parentItem.getNotes ? parentItem.getNotes() : [];
  const noteItems = Zotero.Items.get(noteIDs || []);
  return noteItems.find((noteItem) => {
    const noteHTML = noteItem.getNote?.() || "";
    return hasTag(noteItem, SYNC_TAG) || noteHTML.includes(`${CODEX_MARKER_PREFIX}${parentItem.key}`);
  });
}

async function getOrCreateReadingNote(parentItem) {
  const existing = findExistingCodexNote(parentItem);
  if (existing) return { noteItem: existing, created: false };

  const noteItem = new Zotero.Item("note");
  noteItem.libraryID = parentItem.libraryID;
  noteItem.parentID = parentItem.id;
  noteItem.addTag(REVIEW_TAG, 0);
  noteItem.setNote(buildFallbackHTML(parentItem));
  await noteItem.saveTx();
  return { noteItem, created: true };
}

function markDone(rawItem, noteItem) {
  if (rawItem && hasTag(rawItem, QUEUE_TAG)) rawItem.removeTag(QUEUE_TAG);
  if (rawItem && hasTag(rawItem, ERROR_TAG)) rawItem.removeTag(ERROR_TAG);
  if (rawItem && !hasTag(rawItem, SYNC_TAG)) rawItem.addTag(SYNC_TAG, 0);

  if (noteItem && hasTag(noteItem, QUEUE_TAG)) noteItem.removeTag(QUEUE_TAG);
  if (noteItem && hasTag(noteItem, ERROR_TAG)) noteItem.removeTag(ERROR_TAG);
  if (noteItem && !hasTag(noteItem, SYNC_TAG)) noteItem.addTag(SYNC_TAG, 0);
}

async function saveChangedItems(itemsToSave) {
  for (const changed of itemsToSave) {
    try {
      await changed.saveTx();
    } catch (e) {
      Zotero.debug("[Codex BN Queue] saveTx failed for " + (changed.key || changed.id) + ": " + e);
    }
  }
}

async function getQueuedItems() {
  const libraryID = Zotero.Libraries.userLibraryID;
  const allItems = await Zotero.Items.getAll(libraryID, false, false, false);
  return allItems
    .filter((it) => it && !it.deleted && hasTag(it, QUEUE_TAG))
    .slice(0, MAX_PER_TICK);
}

async function processQueueOnce() {
  if (!Zotero.BetterNotes?.api?.$export?.syncMDBatch) {
    Zotero.debug("[Codex BN Queue] Better Notes API unavailable.");
    return;
  }
  if (globalThis.__codexBNQueueBusy) return;
  globalThis.__codexBNQueueBusy = true;

  try {
    enableBetterNotesAutoSyncPref();
    await ensureDir(ROOT_DIR);

    const queued = await getQueuedItems();
    if (!queued.length) return;

    const toRegister = [];
    const changedItems = [];

    for (const rawItem of queued) {
      try {
        let noteItem = null;
        if (rawItem.isNote && rawItem.isNote()) {
          noteItem = rawItem;
        } else {
          const parentItem = getParentRegularItem(rawItem);
          if (!parentItem) {
            rawItem.removeTag(QUEUE_TAG);
            rawItem.addTag(ERROR_TAG, 0);
            changedItems.push(rawItem);
            continue;
          }
          noteItem = (await getOrCreateReadingNote(parentItem)).noteItem;
        }

        if (!Zotero.BetterNotes.api.sync?.isSyncNote?.(noteItem.id)) {
          toRegister.push(noteItem.id);
        }
        markDone(rawItem, noteItem);
        changedItems.push(rawItem, noteItem);
      } catch (e) {
        Zotero.debug("[Codex BN Queue] Failed item " + (rawItem.key || rawItem.id) + ": " + e);
        rawItem.removeTag(QUEUE_TAG);
        rawItem.addTag(ERROR_TAG, 0);
        changedItems.push(rawItem);
      }
    }

    if (toRegister.length) {
      await Zotero.BetterNotes.api.$export.syncMDBatch(ROOT_DIR, toRegister);
    }
    await saveChangedItems(Array.from(new Set(changedItems)));
    Zotero.debug(`[Codex BN Queue] processed=${queued.length}; registered=${toRegister.length}; root=${ROOT_DIR}`);
  } finally {
    globalThis.__codexBNQueueBusy = false;
  }
}

if (!globalThis.__codexBNQueueTimer) {
  globalThis.__codexBNQueueTimer = setInterval(processQueueOnce, POLL_SECONDS * 1000);
  Zotero.debug(`[Codex BN Queue] daemon started, interval=${POLL_SECONDS}s`);
}

await processQueueOnce();
return `[Codex BN Queue] daemon active. interval=${POLL_SECONDS}s; queueTag=${QUEUE_TAG}; root=${ROOT_DIR}`;
