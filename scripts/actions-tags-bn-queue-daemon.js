/**
 * Codex: Better Notes queue daemon for Zotero Actions & Tags.
 *
 * Intended Actions & Tags setup:
 * - Event: mainWindowLoad
 * - Operation: custom script
 * - Enabled: true
 * - Menu: optional/blank
 *
 * How it works:
 * - Codex/pyzotero adds QUEUE_TAG to a Zotero item or note.
 * - This script runs inside Zotero and searches configured libraries for QUEUE_TAG.
 * - For regular items, it creates/reuses one project-scoped child note.
 * - For notes, it syncs the queued note directly.
 * - It calls Better Notes syncMDBatch(ROOT_DIR, [noteId]) one note at a time.
 * - It adds SYNC_TAG only after Better Notes reports the note is linked under ROOT_DIR.
 */

// Edit these before pasting the script into Actions & Tags.
// Use Windows native backslashes, not D:/forward/slashes.
const PROJECT_ID = "PROJECT_NAME";
const ROOT_DIR = "D:\\ObsidianVault\\BetterNotesSync\\PROJECT_NAME";
const TEMPLATE_NAME = ""; // Optional Better Notes item template name, e.g. "[item]Project Reading Card".

// Empty means personal library only. For group support, put Zotero internal library IDs here.
// Example: const LIBRARY_IDS = [Zotero.Libraries.userLibraryID, 1234567];
const LIBRARY_IDS = [];

const QUEUE_TAG = `Codex/Queue/BN-Sync/${PROJECT_ID}`;
const NOTE_TAG = `Codex/BN-Note/${PROJECT_ID}`;
const SYNC_TAG = `Codex/BN-Synced/${PROJECT_ID}`;
const ERROR_TAG = `Codex/BN-Sync-Error/${PROJECT_ID}`;
const REVIEW_TAG = "review/needs-review";
const CODEX_MARKER_PREFIX = `codex-bn-sync:${PROJECT_ID}:`;
const ERROR_MARKER_PREFIX = `codex-bn-sync-error:${PROJECT_ID}:`;
const BN_AUTOSYNC_PREF = "extensions.zotero.Knowledge4Zotero.sync.autoSyncLinkedNotes";
const FORCE_EXPORT_EXISTING = false; // Keep false unless you explicitly want Zotero note -> Markdown overwrite.
const RECREATE_MISSING_MARKDOWN = true; // Safe repair: export only when the linked Markdown file is gone.
const INITIALIZING_TAG = `Codex/BN-Initializing/${PROJECT_ID}`;
const POLL_SECONDS = 30;
const MAX_PER_TICK = 8;
const SKIP_ERROR_TAGGED_ITEMS = true;
const DAEMON_KEY = `codexBNQueue:${PROJECT_ID}`;

function escapeHTML(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function redactLocalPaths(value) {
  let message = String(value || "");
  for (const rootVariant of [ROOT_DIR, ROOT_DIR.replaceAll("\\", "/")]) {
    if (rootVariant) message = message.replaceAll(rootVariant, "<ROOT_DIR>");
  }
  return message
    .replace(/[A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/][^<>"'\s)]+/gi, "<USER_DIR>")
    .replace(/\/(?:Users|home)\/[^<>"'\s)]+/gi, "<HOME_DIR>")
    .replace(/[A-Za-z]:[\\/][^<>"'\n\r]*/g, "<PATH>");
}

function sanitizeComment(value) {
  return redactLocalPaths(value)
    .replaceAll("--", "—")
    .replaceAll("<", "‹")
    .replaceAll(">", "›")
    .slice(0, 700);
}

function shortErrorMessage(error) {
  return sanitizeComment(error?.message ?? String(error || "unknown_error"));
}

function hasTag(zoteroItem, tag) {
  return zoteroItem?.getTags?.().some((t) => t.tag === tag) || false;
}

function addTagOnce(zoteroItem, tag) {
  if (zoteroItem && !hasTag(zoteroItem, tag)) zoteroItem.addTag(tag, 0);
}

function removeTagIfPresent(zoteroItem, tag) {
  if (zoteroItem && hasTag(zoteroItem, tag)) zoteroItem.removeTag(tag);
}

async function saveChangedItems(itemsToSave) {
  const seen = new Set();
  const failures = [];
  for (const changed of itemsToSave || []) {
    if (!changed || seen.has(changed.id)) continue;
    seen.add(changed.id);
    try {
      await changed.saveTx();
    } catch (e) {
      Zotero.debug("[Codex BN Queue] saveTx failed for " + (changed.key || changed.id) + ": " + e);
      failures.push(`${changed.key || changed.id}: ${shortErrorMessage(e)}`);
    }
  }
  if (failures.length) {
    throw new Error(`state_save_failed: ${failures.join("; ")}`);
  }
}

async function ensureDir(path) {
  if (typeof IOUtils !== "undefined" && IOUtils.makeDirectory) {
    await IOUtils.makeDirectory(path, { ignoreExisting: true });
    return;
  }
  const { OS } = ChromeUtils.importESModule("chrome://zotero/content/osfile.mjs");
  await OS.File.makeDir(path, { from: null, ignoreExisting: true });
}

async function pathExists(path) {
  if (!path) return false;
  try {
    if (typeof IOUtils !== "undefined" && IOUtils.exists) {
      return await IOUtils.exists(path);
    }
    const { OS } = ChromeUtils.importESModule("chrome://zotero/content/osfile.mjs");
    return await OS.File.exists(path);
  } catch (e) {
    Zotero.debug("[Codex BN Queue] Could not check Markdown path existence: " + shortErrorMessage(e));
    return false;
  }
}

function checkBetterNotesAutoSyncPref() {
  try {
    const enabled = Zotero.Prefs.get(BN_AUTOSYNC_PREF, true) === true;
    if (!enabled) {
      Zotero.debug("[Codex BN Queue] Better Notes auto-sync pref is disabled; syncMDBatch can register/export, but future bidirectional auto-sync may not run.");
    }
    return enabled ? "enabled" : "disabled_warning";
  } catch (e) {
    Zotero.debug("[Codex BN Queue] Could not read Better Notes auto-sync pref: " + e);
    return "unknown_warning";
  }
}

function normalizePath(path) {
  return String(path || "")
    .replaceAll("/", "\\")
    .replace(/\\+$/g, "")
    .toLowerCase();
}

function extractStatusField(status, keys) {
  if (!status) return "";
  if (typeof status === "string") return keys.includes("path") ? status : "";
  for (const key of keys) {
    if (status[key]) return String(status[key]);
  }
  if (status.sync && typeof status.sync === "object") return extractStatusField(status.sync, keys);
  if (status.data && typeof status.data === "object") return extractStatusField(status.data, keys);
  return "";
}

function extractStatusPath(status) {
  return extractStatusField(status, ["path", "dir", "saveDir", "folder", "folderPath", "mdPath", "filePath"]);
}

function extractStatusFilename(status) {
  return extractStatusField(status, ["filename", "fileName", "name", "mdFilename", "mdName"]);
}

function isPathInRoot(statusPath) {
  const root = normalizePath(ROOT_DIR);
  const candidate = normalizePath(statusPath);
  return candidate === root;
}

function isFilePathInRoot(filePath) {
  const root = normalizePath(ROOT_DIR);
  const candidate = normalizePath(filePath);
  return candidate.startsWith(root + "\\");
}

function hasUnsafeFilename(filename) {
  const value = String(filename || "");
  return (
    !value ||
    value.includes("..") ||
    value.includes("/") ||
    value.includes("\\") ||
    /^[A-Za-z]:/.test(value) ||
    value.startsWith(".")
  );
}

function joinPath(dir, filename) {
  return String(dir || "").replaceAll("/", "\\").replace(/\\+$/g, "") + "\\" + filename;
}

function statusFullPath(status) {
  const statusPath = extractStatusPath(status);
  const filename = extractStatusFilename(status);
  if (!statusPath || hasUnsafeFilename(filename)) return "";
  return joinPath(statusPath, filename);
}

function isStatusFileInRoot(status) {
  const statusPath = extractStatusPath(status);
  const fullPath = statusFullPath(status);
  return !!statusPath && !!fullPath && isPathInRoot(statusPath) && isFilePathInRoot(fullPath);
}

async function getRootSyncState(noteId) {
  let status = null;
  let statusPath = "";
  let statusFilename = "";
  let fullPath = "";
  let isAnySyncNote = false;

  try {
    status = await Zotero.BetterNotes.api.sync?.getSyncStatus?.(noteId);
    statusPath = extractStatusPath(status);
    statusFilename = extractStatusFilename(status);
    fullPath = statusFullPath(status);
  } catch (e) {
    Zotero.debug("[Codex BN Queue] getSyncStatus failed for noteID=" + noteId + ": " + e);
  }

  try {
    isAnySyncNote = !!Zotero.BetterNotes.api.sync?.isSyncNote?.(noteId);
  } catch (e) {
    Zotero.debug("[Codex BN Queue] isSyncNote failed for noteID=" + noteId + ": " + e);
  }

  return {
    isAnySyncNote,
    statusPath,
    statusFilename,
    fullPath,
    fileExists: await pathExists(fullPath),
    isCorrectRoot: isStatusFileInRoot(status),
  };
}

async function syncNoteToRoot(noteItem) {
  await ensureDir(ROOT_DIR);

  const before = await getRootSyncState(noteItem.id);
  if (before.isCorrectRoot && before.fileExists && !FORCE_EXPORT_EXISTING) {
    return "already_linked";
  }
  if (before.isCorrectRoot && !before.fileExists && !RECREATE_MISSING_MARKDOWN) {
    throw new Error("sync_file_missing_recreate_disabled");
  }
  if (before.isAnySyncNote && !before.isCorrectRoot) {
    Zotero.debug("[Codex BN Queue] Note " + noteItem.key + " is linked outside this project root; re-registering without deleting the old Markdown copy.");
  }

  await Zotero.BetterNotes.api.$export.syncMDBatch(ROOT_DIR, [noteItem.id]);

  const after = await getRootSyncState(noteItem.id);
  if (!after.isCorrectRoot) {
    Zotero.debug("[Codex BN Queue] sync status outside ROOT_DIR after export for note " + noteItem.key + ": path=" + redactLocalPaths(after.statusPath) + "; filename=" + after.statusFilename);
    throw new Error("sync_status_wrong_root");
  }
  if (!after.fileExists) {
    Zotero.debug("[Codex BN Queue] sync status points to missing Markdown after export for note " + noteItem.key + ": " + redactLocalPaths(after.fullPath));
    throw new Error("sync_file_missing_after_export");
  }

  if (before.isCorrectRoot && !before.fileExists) return "recreated_missing_file";
  if (before.isCorrectRoot && FORCE_EXPORT_EXISTING) return "forced_refreshed";
  return before.isAnySyncNote ? "reregistered" : "registered";
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

function ensureProjectMarker(noteItem, parentKey) {
  if (!noteItem?.isNote?.()) return;
  const marker = `${CODEX_MARKER_PREFIX}${parentKey}`;
  const html = noteItem.getNote?.() || "";
  if (html.includes(marker)) return;
  noteItem.setNote(`${html}\n<p><!-- ${marker} --></p>`);
}

function clearErrorComment(noteItem) {
  if (!noteItem?.isNote?.()) return;
  const html = noteItem.getNote?.() || "";
  const markerRegex = new RegExp(`<p><!--\\s*${escapeRegExp(ERROR_MARKER_PREFIX)}[\\s\\S]*?--></p>\\s*`, "g");
  const cleaned = html.replace(markerRegex, "");
  if (cleaned !== html) {
    noteItem.setNote(cleaned);
    return true;
  }
  return false;
}

async function applyTemplateOrFallback(parentItem, noteItem) {
  const templateAPI = Zotero.BetterNotes?.api?.template;
  const noteAPI = Zotero.BetterNotes?.api?.note;

  try {
    const hasTemplate = !!TEMPLATE_NAME && !!templateAPI?.getTemplateText?.(TEMPLATE_NAME);
    if (hasTemplate && templateAPI?.runItemTemplate && noteAPI?.insert) {
      const renderedHTML = await templateAPI.runItemTemplate(TEMPLATE_NAME, {
        itemIds: [parentItem.id],
        targetNoteId: noteItem.id,
      });
      if (renderedHTML) {
        await noteAPI.insert(noteItem, renderedHTML, -1);
        if (!renderedHTML.includes(`${CODEX_MARKER_PREFIX}${parentItem.key}`)) {
          await noteAPI.insert(noteItem, `<p><!-- ${CODEX_MARKER_PREFIX}${parentItem.key} --></p>`, -1);
        }
        await noteItem.saveTx();
        return "template";
      }
    }
  } catch (e) {
    Zotero.debug("[Codex BN Queue] Template failed; fallback will be used: " + e);
  }

  noteItem.setNote(buildFallbackHTML(parentItem));
  ensureProjectMarker(noteItem, parentItem.key);
  await noteItem.saveTx();
  return "fallback";
}

function findExistingCodexNote(parentItem) {
  const noteIDs = parentItem.getNotes ? parentItem.getNotes() : [];
  const noteItems = Zotero.Items.get(noteIDs || []);
  return noteItems.find((noteItem) => {
    const noteHTML = noteItem.getNote?.() || "";
    return (
      hasTag(noteItem, INITIALIZING_TAG) ||
      hasTag(noteItem, NOTE_TAG) ||
      hasTag(noteItem, SYNC_TAG) ||
      hasTag(noteItem, ERROR_TAG) ||
      noteHTML.includes(`${CODEX_MARKER_PREFIX}${parentItem.key}`)
    );
  });
}

function hasMinimumReadingContent(noteItem, parentKey) {
  const html = noteItem?.getNote?.() || "";
  const marker = `${CODEX_MARKER_PREFIX}${parentKey}`;
  const text = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return html.includes(marker) && text.length > 40;
}

function hasAnyNoteContent(noteItem) {
  const html = noteItem?.getNote?.() || "";
  const text = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 0;
}

async function getOrCreateReadingNote(parentItem) {
  const existing = findExistingCodexNote(parentItem);
  if (existing) {
    addTagOnce(existing, REVIEW_TAG);
    if (!hasMinimumReadingContent(existing, parentItem.key)) {
      if (hasAnyNoteContent(existing)) {
        ensureProjectMarker(existing, parentItem.key);
        removeTagIfPresent(existing, INITIALIZING_TAG);
        addTagOnce(existing, NOTE_TAG);
        await existing.saveTx();
        return { noteItem: existing, created: false, contentSource: "preserved_existing" };
      }
      addTagOnce(existing, INITIALIZING_TAG);
      await applyTemplateOrFallback(parentItem, existing);
      removeTagIfPresent(existing, INITIALIZING_TAG);
      addTagOnce(existing, NOTE_TAG);
      await existing.saveTx();
      return { noteItem: existing, created: false, contentSource: "reinitialized" };
    }
    removeTagIfPresent(existing, INITIALIZING_TAG);
    addTagOnce(existing, NOTE_TAG);
    return { noteItem: existing, created: false, contentSource: "existing" };
  }

  const noteItem = new Zotero.Item("note");
  noteItem.libraryID = parentItem.libraryID;
  noteItem.parentID = parentItem.id;
  addTagOnce(noteItem, INITIALIZING_TAG);
  addTagOnce(noteItem, REVIEW_TAG);
  await noteItem.saveTx();
  const contentSource = await applyTemplateOrFallback(parentItem, noteItem);
  removeTagIfPresent(noteItem, INITIALIZING_TAG);
  addTagOnce(noteItem, NOTE_TAG);
  await noteItem.saveTx();
  return { noteItem, created: true, contentSource };
}

function replaceErrorComment(noteItem, error) {
  if (!noteItem?.isNote?.()) return;
  const html = noteItem.getNote?.() || "";
  const markerRegex = new RegExp(`<p><!--\\s*${escapeRegExp(ERROR_MARKER_PREFIX)}[\\s\\S]*?--></p>\\s*`, "g");
  const cleaned = html.replace(markerRegex, "");
  const message = shortErrorMessage(error);
  noteItem.setNote(`${cleaned}\n<p><!-- ${ERROR_MARKER_PREFIX}${new Date().toISOString()} ${message} --></p>`);
}

function markDone(rawItem, noteItem) {
  for (const zoteroItem of [rawItem, noteItem]) {
    if (!zoteroItem) continue;
    removeTagIfPresent(zoteroItem, QUEUE_TAG);
    removeTagIfPresent(zoteroItem, ERROR_TAG);
    addTagOnce(zoteroItem, SYNC_TAG);
    if (zoteroItem.isNote?.()) {
      addTagOnce(zoteroItem, NOTE_TAG);
      addTagOnce(zoteroItem, REVIEW_TAG);
      clearErrorComment(zoteroItem);
    }
  }
}

function markError(rawItem, noteItem, error) {
  for (const zoteroItem of [rawItem, noteItem]) {
    if (!zoteroItem) continue;
    removeTagIfPresent(zoteroItem, SYNC_TAG);
    addTagOnce(zoteroItem, ERROR_TAG);
    if (zoteroItem.isNote?.()) {
      addTagOnce(zoteroItem, NOTE_TAG);
      addTagOnce(zoteroItem, REVIEW_TAG);
    }
  }
  if (noteItem?.isNote?.()) replaceErrorComment(noteItem, error);
}

function captureQueueState(rawItem, noteItem) {
  return {
    rawWasQueued: hasTag(rawItem, QUEUE_TAG),
    noteWasQueued: hasTag(noteItem, QUEUE_TAG),
  };
}

function restoreQueueState(rawItem, noteItem, queueState) {
  if (queueState?.rawWasQueued) addTagOnce(rawItem, QUEUE_TAG);
  if (queueState?.noteWasQueued) addTagOnce(noteItem, QUEUE_TAG);
}

async function queuedItemsFromSearch(libraryID) {
  const search = new Zotero.Search();
  search.libraryID = libraryID;
  search.addCondition("tag", "is", QUEUE_TAG);
  const ids = await search.search();
  if (!ids?.length) return [];
  return Zotero.Items.get(ids).filter((it) => it && !it.deleted && hasTag(it, QUEUE_TAG));
}

async function queuedItemsFromFallbackScan(libraryID) {
  const allItems = await Zotero.Items.getAll(libraryID, false, false, false);
  return allItems.filter((it) => it && !it.deleted && hasTag(it, QUEUE_TAG));
}

async function getQueuedItems() {
  const libraryIDs = LIBRARY_IDS.length ? LIBRARY_IDS : [Zotero.Libraries.userLibraryID];
  const queued = [];

  for (const libraryID of libraryIDs) {
    let libraryItems = [];
    try {
      libraryItems = await queuedItemsFromSearch(libraryID);
    } catch (e) {
      Zotero.debug("[Codex BN Queue] Tag search failed for libraryID=" + libraryID + "; using fallback scan: " + e);
      libraryItems = await queuedItemsFromFallbackScan(libraryID);
    }

    for (const candidate of libraryItems) {
      if (SKIP_ERROR_TAGGED_ITEMS && hasTag(candidate, ERROR_TAG)) continue;
      queued.push(candidate);
      if (queued.length >= MAX_PER_TICK) return queued;
    }
  }

  return queued;
}

async function processOneQueuedItem(rawItem) {
  let noteItem = null;

  try {
    if (rawItem.isNote && rawItem.isNote()) {
      noteItem = rawItem;
      addTagOnce(noteItem, NOTE_TAG);
      addTagOnce(noteItem, REVIEW_TAG);
    } else {
      const parentItem = getParentRegularItem(rawItem);
      if (!parentItem) {
        throw new Error("Queued object is not a regular Zotero item or child note.");
      }
      noteItem = (await getOrCreateReadingNote(parentItem)).noteItem;
    }

    if (clearErrorComment(noteItem)) {
      await saveChangedItems([noteItem]);
    }

    const queueState = captureQueueState(rawItem, noteItem);
    const syncAction = await syncNoteToRoot(noteItem);
    try {
      markDone(rawItem, noteItem);
      await saveChangedItems([rawItem, noteItem]);
    } catch (stateError) {
      restoreQueueState(rawItem, noteItem, queueState);
      throw new Error(`sync_succeeded_state_save_failed: ${shortErrorMessage(stateError)}`);
    }
    return { ok: true, action: syncAction, noteKey: noteItem.key };
  } catch (e) {
    Zotero.debug("[Codex BN Queue] Failed item " + (rawItem.key || rawItem.id) + ": " + e);
    markError(rawItem, noteItem, e);
    try {
      await saveChangedItems([rawItem, noteItem]);
    } catch (stateError) {
      Zotero.debug("[Codex BN Queue] Failed to save error state for " + (rawItem.key || rawItem.id) + ": " + stateError);
    }
    return { ok: false, error: shortErrorMessage(e), noteKey: noteItem?.key || "" };
  }
}

function ensureDaemonStateContainers() {
  if (globalThis.__codexBNQueueTimer) {
    try {
      clearInterval(globalThis.__codexBNQueueTimer);
    } catch (e) {
      Zotero.debug("[Codex BN Queue] Could not clear legacy single-project timer: " + e);
    }
    delete globalThis.__codexBNQueueTimer;
  }

  if (!globalThis.__codexBNQueueTimers || typeof globalThis.__codexBNQueueTimers.has !== "function") {
    globalThis.__codexBNQueueTimers = new Map();
  }

  if (!globalThis.__codexBNQueueBusy || typeof globalThis.__codexBNQueueBusy.has !== "function") {
    globalThis.__codexBNQueueBusy = new Set();
  }
}

async function processQueueOnce() {
  if (!Zotero.BetterNotes?.api?.$export?.syncMDBatch) {
    Zotero.debug("[Codex BN Queue] Better Notes API unavailable.");
    return;
  }
  ensureDaemonStateContainers();
  if (globalThis.__codexBNQueueBusy.has(DAEMON_KEY)) return;
  globalThis.__codexBNQueueBusy.add(DAEMON_KEY);

  try {
    const autoSyncPrefStatus = checkBetterNotesAutoSyncPref();
    const queued = await getQueuedItems();
    if (!queued.length) return;

    const stats = { processed: 0, alreadyLinked: 0, registered: 0, reregistered: 0, recreatedMissing: 0, refreshed: 0, failed: 0 };
    for (const rawItem of queued) {
      const result = await processOneQueuedItem(rawItem);
      stats.processed += 1;
      if (!result.ok) stats.failed += 1;
      if (result.action === "already_linked") stats.alreadyLinked += 1;
      if (result.action === "registered") stats.registered += 1;
      if (result.action === "reregistered") stats.reregistered += 1;
      if (result.action === "recreated_missing_file") stats.recreatedMissing += 1;
      if (result.action === "forced_refreshed") stats.refreshed += 1;
    }

    Zotero.debug(
      `[Codex BN Queue] processed=${stats.processed}; alreadyLinked=${stats.alreadyLinked}; registered=${stats.registered}; reregistered=${stats.reregistered}; recreatedMissing=${stats.recreatedMissing}; refreshed=${stats.refreshed}; failed=${stats.failed}; autoSyncPref=${autoSyncPrefStatus}; project=${PROJECT_ID}; root=${ROOT_DIR}`,
    );
  } catch (e) {
    Zotero.debug("[Codex BN Queue] processQueueOnce failed: " + shortErrorMessage(e));
  } finally {
    globalThis.__codexBNQueueBusy.delete(DAEMON_KEY);
  }
}

ensureDaemonStateContainers();
if (globalThis.__codexBNQueueTimers.has(DAEMON_KEY)) {
  try {
    clearInterval(globalThis.__codexBNQueueTimers.get(DAEMON_KEY));
  } catch (e) {
    Zotero.debug("[Codex BN Queue] Could not clear existing project timer: " + e);
  }
}
globalThis.__codexBNQueueTimers.set(DAEMON_KEY, setInterval(processQueueOnce, POLL_SECONDS * 1000));
Zotero.debug(`[Codex BN Queue] daemon (re)started, interval=${POLL_SECONDS}s; project=${PROJECT_ID}`);

await processQueueOnce();
return `[Codex BN Queue] daemon active. interval=${POLL_SECONDS}s; queueTag=${QUEUE_TAG}; errorTag=${ERROR_TAG}; project=${PROJECT_ID}; root=${ROOT_DIR}`;
