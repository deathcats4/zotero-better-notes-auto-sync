/**
 * Codex: create/reuse Better Notes reading notes and register Markdown auto-sync.
 *
 * Actions & Tags setup:
 * - Operation: Custom script / 自定义脚本
 * - Menu label: Codex: BN auto-sync selected to Obsidian
 * - Item menu: enabled
 *
 * Tested plugin surfaces:
 * - Actions & Tags injects `item`, `items`, and `collection`.
 * - Better Notes exposes:
 *   Zotero.BetterNotes.api.template.runItemTemplate
 *   Zotero.BetterNotes.api.note.insert
 *   Zotero.BetterNotes.api.$export.syncMDBatch
 *   Zotero.BetterNotes.api.sync.isSyncNote
 *   Zotero.BetterNotes.api.sync.getSyncStatus
 */

// Edit these before pasting the script into Actions & Tags.
// Use Windows native backslashes, not D:/forward/slashes.
const PROJECT_ID = "PROJECT_NAME";
const ROOT_DIR = "D:\\ObsidianVault\\BetterNotesSync\\PROJECT_NAME";
const TEMPLATE_NAME = ""; // Optional Better Notes item template name, e.g. "[item]Project Reading Card".

// Project-scoped status tags avoid collisions between multiple vaults/projects.
const QUEUE_TAG = `Codex/Queue/BN-Sync/${PROJECT_ID}`;
const NOTE_TAG = `Codex/BN-Note/${PROJECT_ID}`;
const SYNC_TAG = `Codex/BN-Synced/${PROJECT_ID}`;
const ERROR_TAG = `Codex/BN-Sync-Error/${PROJECT_ID}`;
const REVIEW_TAG = "review/needs-review";
const CODEX_MARKER_PREFIX = `codex-bn-sync:${PROJECT_ID}:`;
const ERROR_MARKER_PREFIX = `codex-bn-sync-error:${PROJECT_ID}:`;
const BN_AUTOSYNC_PREF = "extensions.zotero.Knowledge4Zotero.sync.autoSyncLinkedNotes";

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

function sanitizeComment(value) {
  return String(value || "")
    .replaceAll("--", "—")
    .replaceAll("<", "‹")
    .replaceAll(">", "›")
    .slice(0, 700);
}

function uniqById(values) {
  const seen = new Set();
  const out = [];
  for (const value of values || []) {
    if (!value || seen.has(value.id)) continue;
    seen.add(value.id);
    out.push(value);
  }
  return out;
}

function selectedItemsFromActionContext() {
  const hasItemsArray = typeof items !== "undefined" && Array.isArray(items);
  const hasSingleItem = typeof item !== "undefined" && !!item;

  // Actions & Tags calls once with `items=[all selected]`, then may call again
  // per selected item as `items=[]; item=<one item>`. Ignore the per-item
  // callback to avoid duplicate note creation and duplicate sync calls.
  if (hasItemsArray && hasSingleItem) {
    return { selected: [], ignoredPerItemCallback: true };
  }

  const source = hasItemsArray ? items : hasSingleItem ? [item] : [];
  return { selected: uniqById(source), ignoredPerItemCallback: false };
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
      Zotero.debug("[Codex BN Sync] saveTx failed for " + (changed.key || changed.id) + ": " + e);
      failures.push(`${changed.key || changed.id}: ${e?.message || e}`);
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

function checkBetterNotesAutoSyncPref() {
  try {
    return Zotero.Prefs.get(BN_AUTOSYNC_PREF, true) === true ? "enabled" : "disabled_warning";
  } catch (e) {
    Zotero.debug("[Codex BN Sync] Could not read Better Notes auto-sync pref: " + e);
    return "unknown_warning";
  }
}

function normalizePath(path) {
  return String(path || "")
    .replaceAll("/", "\\")
    .replace(/\\+$/g, "")
    .toLowerCase();
}

function extractStatusPath(status) {
  if (!status) return "";
  if (typeof status === "string") return status;
  for (const key of ["path", "dir", "saveDir", "folder", "folderPath", "mdPath", "filePath"]) {
    if (status[key]) return String(status[key]);
  }
  if (status.sync && typeof status.sync === "object") return extractStatusPath(status.sync);
  if (status.data && typeof status.data === "object") return extractStatusPath(status.data);
  return "";
}

function isPathInRoot(statusPath) {
  const root = normalizePath(ROOT_DIR);
  const candidate = normalizePath(statusPath);
  return candidate === root || candidate.startsWith(root + "\\");
}

async function getRootSyncState(noteId) {
  let status = null;
  let statusPath = "";
  let isAnySyncNote = false;

  try {
    status = await Zotero.BetterNotes.api.sync?.getSyncStatus?.(noteId);
    statusPath = extractStatusPath(status);
  } catch (e) {
    Zotero.debug("[Codex BN Sync] getSyncStatus failed for noteID=" + noteId + ": " + e);
  }

  try {
    isAnySyncNote = !!Zotero.BetterNotes.api.sync?.isSyncNote?.(noteId);
  } catch (e) {
    Zotero.debug("[Codex BN Sync] isSyncNote failed for noteID=" + noteId + ": " + e);
  }

  return {
    isAnySyncNote,
    statusPath,
    isCorrectRoot: !!statusPath && isPathInRoot(statusPath),
  };
}

async function syncNoteToRoot(noteItem) {
  await ensureDir(ROOT_DIR);

  const before = await getRootSyncState(noteItem.id);

  await Zotero.BetterNotes.api.$export.syncMDBatch(ROOT_DIR, [noteItem.id]);

  const after = await getRootSyncState(noteItem.id);
  if (!after.isCorrectRoot) {
    const observed = after.statusPath || "unavailable";
    throw new Error(`syncMDBatch completed but note ${noteItem.key} is not registered under ROOT_DIR; observed=${observed}`);
  }

  if (before.isCorrectRoot) return "refreshed";
  return before.isAnySyncNote ? "reregistered" : "registered";
}

function getParentRegularItem(rawItem) {
  if (rawItem?.isRegularItem && rawItem.isRegularItem()) return rawItem;

  if (rawItem?.parentID) {
    const parent = Zotero.Items.get(rawItem.parentID);
    if (parent?.isRegularItem && parent.isRegularItem()) return parent;
  }

  try {
    const top = Zotero.Items.getTopLevel([rawItem])[0];
    if (top?.isRegularItem && top.isRegularItem()) return top;
  } catch (e) {
    Zotero.debug("[Codex BN Sync] getTopLevel failed: " + e);
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
<p><strong>Codex 状态：</strong>由 Actions & Tags 创建/复用，并通过 Better Notes Markdown Sync 绑定到 Obsidian。</p>

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

<h2>方法与材料</h2>
<p>待补充。</p>

<h2>关键认识</h2>
<p>待补充。</p>

<h2>候选证据</h2>
<table>
<thead><tr><th>candidate_id</th><th>候选论点</th><th>位置</th><th>审核状态</th></tr></thead>
<tbody><tr><td>CAND-${parentItem.key}-001</td><td>待补充</td><td>待核对页码/图表</td><td>needs_review</td></tr></tbody>
</table>

<h2>待人工核对</h2>
<ul>
<li>补页码、图号或表号。</li>
<li>区分作者结论、数据证据和自己的解释。</li>
<li>不要直接把本 note 升级为正式 Evidence Matrix。</li>
</ul>

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
    Zotero.debug("[Codex BN Sync] Template failed; fallback will be used: " + e);
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
      hasTag(noteItem, NOTE_TAG) ||
      hasTag(noteItem, SYNC_TAG) ||
      hasTag(noteItem, ERROR_TAG) ||
      noteHTML.includes(`${CODEX_MARKER_PREFIX}${parentItem.key}`)
    );
  });
}

async function getOrCreateReadingNote(parentItem) {
  const existing = findExistingCodexNote(parentItem);
  if (existing) {
    addTagOnce(existing, NOTE_TAG);
    addTagOnce(existing, REVIEW_TAG);
    return { noteItem: existing, created: false, contentSource: "existing" };
  }

  const noteItem = new Zotero.Item("note");
  noteItem.libraryID = parentItem.libraryID;
  noteItem.parentID = parentItem.id;
  addTagOnce(noteItem, NOTE_TAG);
  addTagOnce(noteItem, REVIEW_TAG);
  await noteItem.saveTx();

  const contentSource = await applyTemplateOrFallback(parentItem, noteItem);
  return { noteItem, created: true, contentSource };
}

function replaceErrorComment(noteItem, error) {
  if (!noteItem?.isNote?.()) return;
  const html = noteItem.getNote?.() || "";
  const markerRegex = new RegExp(`<p><!--\\s*${escapeRegExp(ERROR_MARKER_PREFIX)}[\\s\\S]*?--></p>\\s*`, "g");
  const cleaned = html.replace(markerRegex, "");
  const message = sanitizeComment(error?.message || error);
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

if (!Zotero.BetterNotes?.api?.$export?.syncMDBatch) {
  return "[Codex BN Sync] Better Notes API not available. Check Better Notes is installed/enabled.";
}

const { selected, ignoredPerItemCallback } = selectedItemsFromActionContext();
if (ignoredPerItemCallback) {
  return "[Codex BN Sync] Ignored Actions & Tags per-item callback to avoid duplicate multi-select execution.";
}
if (!selected.length) {
  return "[Codex BN Sync] No selected items/notes. Select one or more Zotero items or child notes.";
}

const autoSyncPrefStatus = checkBetterNotesAutoSyncPref();

const stats = {
  selected: selected.length,
  notes: 0,
  created: 0,
  existing: 0,
  registered: 0,
  reregistered: 0,
  refreshed: 0,
  failed: 0,
  skipped: 0,
  template: 0,
  fallback: 0,
};
const noteKeys = [];
const failures = [];

for (const raw of selected) {
  let noteItem = null;
  try {
    if (raw.isNote && raw.isNote()) {
      noteItem = raw;
      addTagOnce(noteItem, NOTE_TAG);
      addTagOnce(noteItem, REVIEW_TAG);
    } else {
      const parent = getParentRegularItem(raw);
      if (!parent) {
        stats.skipped += 1;
        continue;
      }

      const result = await getOrCreateReadingNote(parent);
      noteItem = result.noteItem;
      if (result.created) stats.created += 1;
      else stats.existing += 1;
      if (result.contentSource === "template") stats.template += 1;
      if (result.contentSource === "fallback") stats.fallback += 1;
    }

    if (clearErrorComment(noteItem)) {
      await saveChangedItems([noteItem]);
    }

    const queueState = captureQueueState(raw, noteItem);
    const syncAction = await syncNoteToRoot(noteItem);
    try {
      markDone(raw, noteItem);
      await saveChangedItems([raw, noteItem]);
    } catch (stateError) {
      restoreQueueState(raw, noteItem, queueState);
      throw new Error(`sync_succeeded_state_save_failed: ${stateError?.message || stateError}`);
    }

    if (syncAction === "refreshed") stats.refreshed += 1;
    if (syncAction === "registered") stats.registered += 1;
    if (syncAction === "reregistered") stats.reregistered += 1;
    stats.notes += 1;
    noteKeys.push(noteItem.key);
  } catch (e) {
    Zotero.debug("[Codex BN Sync] Failed on selected item " + (raw?.key || raw?.id) + ": " + e);
    markError(raw, noteItem, e);
    try {
      await saveChangedItems([raw, noteItem]);
    } catch (stateError) {
      Zotero.debug("[Codex BN Sync] Failed to save error state for " + (raw?.key || raw?.id) + ": " + stateError);
    }
    stats.failed += 1;
    failures.push(`${raw?.key || raw?.id}: ${String(e?.message || e).slice(0, 160)}`);
  }
}

const failureText = failures.length ? `; failures=${failures.join(" | ")}` : "";
return `[Codex BN Sync] Done. selected=${stats.selected}; notes=${stats.notes}; created=${stats.created}; existing=${stats.existing}; registered=${stats.registered}; reregistered=${stats.reregistered}; refreshed=${stats.refreshed}; template=${stats.template}; fallback=${stats.fallback}; skipped=${stats.skipped}; failed=${stats.failed}; autoSyncPref=${autoSyncPrefStatus}; project=${PROJECT_ID}; root=${ROOT_DIR}; noteKeys=${noteKeys.join(", ")}${failureText}`;
