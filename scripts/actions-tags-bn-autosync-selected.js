/**
 * Codex: create/reuse Better Notes reading notes and register Markdown auto-sync
 *
 * Actions & Tags setup:
 * - Operation: Custom script / 自定义脚本
 * - Menu label: Codex: BN auto-sync selected to Obsidian
 * - Item menu: enabled
 *
 * Tested against local plugin surfaces:
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
const ROOT_DIR = "D:\\ObsidianVault\\BetterNotesSync\\PROJECT_NAME";
const TEMPLATE_NAME = ""; // Optional Better Notes item template name, e.g. "[item]Project Reading Card".
const SYNC_TAG = "Codex/BN-Synced";
const REVIEW_TAG = "review/needs-review";
const CODEX_MARKER_PREFIX = "codex-bn-sync:";
const BN_AUTOSYNC_PREF = "extensions.zotero.Knowledge4Zotero.sync.autoSyncLinkedNotes";

function escapeHTML(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
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
  const direct = [];
  if (Array.isArray(items)) direct.push(...items);
  if (item) direct.push(item);
  return uniqById(direct);
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
      return "enabled";
    }
    return "already_enabled";
  } catch (e) {
    Zotero.debug("[Codex BN Sync] Could not set Better Notes auto-sync pref: " + e);
    return "pref_set_failed";
  }
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

async function applyTemplateOrFallback(parentItem, noteItem) {
  const templateAPI = Zotero.BetterNotes?.api?.template;
  const noteAPI = Zotero.BetterNotes?.api?.note;

  try {
    const hasTemplate = !!templateAPI?.getTemplateText?.(TEMPLATE_NAME);
    if (hasTemplate && templateAPI?.runItemTemplate && noteAPI?.insert) {
      const renderedHTML = await templateAPI.runItemTemplate(TEMPLATE_NAME, {
        itemIds: [parentItem.id],
        targetNoteId: noteItem.id,
      });
      if (renderedHTML) {
        await noteAPI.insert(noteItem, renderedHTML, -1);
        return "template";
      }
    }
  } catch (e) {
    Zotero.debug("[Codex BN Sync] Template failed; fallback will be used: " + e);
  }

  noteItem.setNote(buildFallbackHTML(parentItem));
  await noteItem.saveTx();
  return "fallback";
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
  if (existing) {
    if (!hasTag(existing, SYNC_TAG)) existing.addTag(SYNC_TAG, 0);
    if (!hasTag(existing, REVIEW_TAG)) existing.addTag(REVIEW_TAG, 0);
    await existing.saveTx();
    return { noteItem: existing, created: false, contentSource: "existing" };
  }

  const noteItem = new Zotero.Item("note");
  noteItem.libraryID = parentItem.libraryID;
  noteItem.parentID = parentItem.id;
  noteItem.addTag(SYNC_TAG, 0);
  noteItem.addTag(REVIEW_TAG, 0);
  await noteItem.saveTx();

  const contentSource = await applyTemplateOrFallback(parentItem, noteItem);
  return { noteItem, created: true, contentSource };
}

if (!Zotero.BetterNotes?.api?.$export?.syncMDBatch) {
  return "[Codex BN Sync] Better Notes API not available. Check Better Notes is installed/enabled.";
}

const selected = selectedItemsFromActionContext();
if (!selected.length) {
  return "[Codex BN Sync] No selected items/notes. Select one or more Zotero items or child notes.";
}

await ensureDir(ROOT_DIR);
const autoSyncPrefStatus = enableBetterNotesAutoSyncPref();

const targetNotes = [];
const stats = {
  selected: selected.length,
  created: 0,
  existing: 0,
  syncedAlready: 0,
  syncRegistered: 0,
  skipped: 0,
  template: 0,
  fallback: 0,
};

for (const raw of selected) {
  try {
    if (raw.isNote && raw.isNote()) {
      targetNotes.push(raw);
      continue;
    }

    const parent = getParentRegularItem(raw);
    if (!parent) {
      stats.skipped += 1;
      continue;
    }

    const { noteItem, created, contentSource } = await getOrCreateReadingNote(parent);
    targetNotes.push(noteItem);
    if (created) stats.created += 1;
    else stats.existing += 1;
    if (contentSource === "template") stats.template += 1;
    if (contentSource === "fallback") stats.fallback += 1;
  } catch (e) {
    Zotero.debug("[Codex BN Sync] Failed on selected item " + (raw?.key || raw?.id) + ": " + e);
    stats.skipped += 1;
  }
}

const uniqueNotes = uniqById(targetNotes);
const toRegister = [];
for (const noteItem of uniqueNotes) {
  if (Zotero.BetterNotes.api.sync?.isSyncNote?.(noteItem.id)) {
    stats.syncedAlready += 1;
  } else {
    toRegister.push(noteItem.id);
  }
}

if (toRegister.length) {
  await Zotero.BetterNotes.api.$export.syncMDBatch(ROOT_DIR, toRegister);
  stats.syncRegistered = toRegister.length;
}

const noteKeys = uniqueNotes.map((n) => n.key).join(", ");
return `[Codex BN Sync] Done. selected=${stats.selected}; notes=${uniqueNotes.length}; created=${stats.created}; existing=${stats.existing}; registered=${stats.syncRegistered}; alreadySynced=${stats.syncedAlready}; template=${stats.template}; fallback=${stats.fallback}; skipped=${stats.skipped}; autoSyncPref=${autoSyncPrefStatus}; root=${ROOT_DIR}; noteKeys=${noteKeys}`;
