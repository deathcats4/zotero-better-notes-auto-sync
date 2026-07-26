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
 *   Zotero.BetterNotes.api.sync.getMDFileName
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
const LINKS_MARKER_PREFIX = `codex-zotero-links:${PROJECT_ID}:`;
const BN_AUTOSYNC_PREF = "extensions.zotero.Knowledge4Zotero.sync.autoSyncLinkedNotes";
const FORCE_EXPORT_EXISTING = false; // Keep false unless you explicitly want Zotero note -> Markdown overwrite.
const RECREATE_MISSING_MARKDOWN = true; // Safe repair: export only when the linked Markdown file is gone.
const INITIALIZING_TAG = `Codex/BN-Initializing/${PROJECT_ID}`;
const ALLOW_CROSS_PROJECT_MIGRATION = false; // Set true only when intentionally moving a note to this ROOT_DIR.
const CODEX_QUEUE_TAG_PREFIX = "Codex/Queue/BN-Sync/";
const CODEX_SYNC_TAG_PREFIX = "Codex/BN-Synced/";
const CODEX_NOTE_TAG_PREFIX = "Codex/BN-Note/";
const CODEX_ERROR_TAG_PREFIX = "Codex/BN-Sync-Error/";
const CODEX_INITIALIZING_TAG_PREFIX = "Codex/BN-Initializing/";
const CODEX_MARKER_PROJECT_RE = /codex-bn-sync:([^:\s<>]+):/g;
const LINKS_MARKER_PROJECT_RE = /codex-zotero-links:([^:\s<>]+):/g;
const LINKS_BLOCK_PROJECT_RE = /data-codex-zotero-links="([^"]+)"/g;

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

function isTransientLockError(error) {
  return String(error?.message || error || "").includes("codex_bn_lock_busy");
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

function ensureSharedLockContainers() {
  if (!globalThis.__codexBNItemLocks || typeof globalThis.__codexBNItemLocks.has !== "function") {
    globalThis.__codexBNItemLocks = new Set();
  }
  if (!globalThis.__codexBNNoteLocks || typeof globalThis.__codexBNNoteLocks.has !== "function") {
    globalThis.__codexBNNoteLocks = new Set();
  }
}

async function withSharedLock(lockSetName, lockKey, callback) {
  ensureSharedLockContainers();
  const locks = globalThis[lockSetName];
  if (locks.has(lockKey)) {
    throw new Error(`codex_bn_lock_busy: ${lockKey}`);
  }
  locks.add(lockKey);
  try {
    return await callback();
  } finally {
    locks.delete(lockKey);
  }
}

async function withItemLock(parentItem, callback) {
  const key = `item:${PROJECT_ID}:${parentItem.libraryID}:${parentItem.id}`;
  return withSharedLock("__codexBNItemLocks", key, callback);
}

async function withNoteLock(noteItem, callback) {
  const key = `note:${noteItem.libraryID}:${noteItem.id}`;
  return withSharedLock("__codexBNNoteLocks", key, callback);
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
  if (!path) return { state: "missing" };
  try {
    let exists = false;
    if (typeof IOUtils !== "undefined" && IOUtils.exists) {
      exists = await IOUtils.exists(path);
    } else {
      const { OS } = ChromeUtils.importESModule("chrome://zotero/content/osfile.mjs");
      exists = await OS.File.exists(path);
    }
    return { state: exists ? "exists" : "missing" };
  } catch (e) {
    Zotero.debug("[Codex BN Sync] Could not check Markdown path existence: " + shortErrorMessage(e));
    return { state: "error", error: e };
  }
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

function hasUnsafeMarkdownFilename(filename) {
  return hasUnsafeFilename(filename) || !/\.md$/i.test(String(filename || ""));
}

function joinPath(dir, filename) {
  return String(dir || "").replaceAll("/", "\\").replace(/\\+$/g, "") + "\\" + filename;
}

function statusFullPath(status) {
  const statusPath = extractStatusPath(status);
  const filename = extractStatusFilename(status);
  if (!statusPath || hasUnsafeMarkdownFilename(filename)) return "";
  return joinPath(statusPath, filename);
}

function isStatusFileInRoot(status) {
  const statusPath = extractStatusPath(status);
  const fullPath = statusFullPath(status);
  return !!statusPath && !!fullPath && isPathInRoot(statusPath) && isFilePathInRoot(fullPath);
}

function otherProjectOwnershipTokens(noteItem) {
  const conflicts = [];
  const tags = noteItem?.getTags?.() || [];
  for (const tagObject of tags) {
    const tag = tagObject?.tag || "";
    if (tag.startsWith(CODEX_QUEUE_TAG_PREFIX) && tag !== QUEUE_TAG) conflicts.push(tag);
    if (tag.startsWith(CODEX_SYNC_TAG_PREFIX) && tag !== SYNC_TAG) conflicts.push(tag);
    if (tag.startsWith(CODEX_NOTE_TAG_PREFIX) && tag !== NOTE_TAG) conflicts.push(tag);
    if (tag.startsWith(CODEX_ERROR_TAG_PREFIX) && tag !== ERROR_TAG) conflicts.push(tag);
    if (tag.startsWith(CODEX_INITIALIZING_TAG_PREFIX) && tag !== INITIALIZING_TAG) conflicts.push(tag);
  }

  const html = noteItem?.getNote?.() || "";
  for (const match of html.matchAll(CODEX_MARKER_PROJECT_RE)) {
    const markerProject = match[1];
    if (markerProject && markerProject !== PROJECT_ID) conflicts.push(`marker:${markerProject}`);
  }
  for (const match of html.matchAll(LINKS_MARKER_PROJECT_RE)) {
    const markerProject = match[1];
    if (markerProject && markerProject !== PROJECT_ID) conflicts.push(`links:${markerProject}`);
  }
  for (const match of html.matchAll(LINKS_BLOCK_PROJECT_RE)) {
    const blockProject = match[1];
    if (blockProject && blockProject !== PROJECT_ID) conflicts.push(`links:${blockProject}`);
  }
  return [...new Set(conflicts)];
}

function assertNoCrossProjectConflict(noteItem) {
  const conflicts = otherProjectOwnershipTokens(noteItem);
  if (conflicts.length && !ALLOW_CROSS_PROJECT_MIGRATION) {
    throw new Error(`cross_project_note_conflict: ${conflicts.slice(0, 4).join(", ")}`);
  }
}

function removeOtherProjectTagPrefixes(zoteroItem) {
  for (const tagObject of zoteroItem?.getTags?.() || []) {
    const tag = tagObject?.tag || "";
    if (tag.startsWith(CODEX_QUEUE_TAG_PREFIX) && tag !== QUEUE_TAG) removeTagIfPresent(zoteroItem, tag);
    if (tag.startsWith(CODEX_SYNC_TAG_PREFIX) && tag !== SYNC_TAG) removeTagIfPresent(zoteroItem, tag);
    if (tag.startsWith(CODEX_NOTE_TAG_PREFIX) && tag !== NOTE_TAG) removeTagIfPresent(zoteroItem, tag);
    if (tag.startsWith(CODEX_ERROR_TAG_PREFIX) && tag !== ERROR_TAG) removeTagIfPresent(zoteroItem, tag);
    if (tag.startsWith(CODEX_INITIALIZING_TAG_PREFIX) && tag !== INITIALIZING_TAG) removeTagIfPresent(zoteroItem, tag);
  }
}

function stripOtherProjectZoteroLinksBlocks(html) {
  return String(html || "").replace(
    /<div\b[^>]*data-codex-zotero-links="([^"]+)"[^>]*>[\s\S]*?<\/div>\s*/g,
    (block, blockProject) => {
      const hasOtherProjectMarker = [...block.matchAll(LINKS_MARKER_PROJECT_RE)].some((match) => match[1] && match[1] !== PROJECT_ID);
      return blockProject === PROJECT_ID && !hasOtherProjectMarker ? block : "";
    },
  );
}

function clearOtherProjectOwnership(noteItem) {
  if (!noteItem?.isNote?.()) return false;
  removeOtherProjectTagPrefixes(noteItem);

  const html = noteItem.getNote?.() || "";
  const markerRegex = new RegExp(`<p>\\s*<!--\\s*codex-bn-sync:(?!${escapeRegExp(PROJECT_ID)}:)[\\s\\S]*?-->\\s*</p>\\s*`, "g");
  const bareMarkerRegex = new RegExp(`<!--\\s*codex-bn-sync:(?!${escapeRegExp(PROJECT_ID)}:)[\\s\\S]*?-->\\s*`, "g");
  const bareLinksMarkerRegex = new RegExp(`<!--\\s*codex-zotero-links:(?!${escapeRegExp(PROJECT_ID)}:)[\\s\\S]*?-->\\s*`, "g");
  const cleaned = stripOtherProjectZoteroLinksBlocks(html)
    .replace(markerRegex, "")
    .replace(bareMarkerRegex, "")
    .replace(bareLinksMarkerRegex, "");
  if (cleaned !== html) {
    noteItem.setNote(cleaned);
    return true;
  }
  return false;
}

function markdownFilenameFromValue(value) {
  if (typeof value === "string") return value;
  return extractStatusFilename(value);
}

async function preflightMarkdownFilename(noteId) {
  const getMDFileName = Zotero.BetterNotes?.api?.sync?.getMDFileName;
  if (typeof getMDFileName !== "function") {
    throw new Error("markdown_filename_precheck_unavailable");
  }

  let filename = "";
  try {
    filename = markdownFilenameFromValue(await getMDFileName(noteId, ROOT_DIR));
  } catch (e) {
    Zotero.debug("[Codex BN Sync] Better Notes getMDFileName failed for noteID=" + noteId + ": " + e);
    throw new Error("markdown_filename_precheck_failed");
  }

  if (hasUnsafeMarkdownFilename(filename)) {
    Zotero.debug("[Codex BN Sync] Unsafe Markdown filename before export for noteID=" + noteId + ": " + redactLocalPaths(filename));
    throw new Error("unsafe_markdown_filename");
  }
  return filename;
}

async function getRootSyncState(noteId) {
  let status = null;
  let statusPath = "";
  let statusFilename = "";
  let fullPath = "";
  let isAnySyncNote = false;
  let statusCheckState = "ok";
  const statusCheckErrors = [];
  const syncAPI = Zotero.BetterNotes?.api?.sync;

  if (typeof syncAPI?.getSyncStatus !== "function") {
    statusCheckState = "error";
    statusCheckErrors.push("getSyncStatus_unavailable");
  } else {
    try {
      status = await syncAPI.getSyncStatus(noteId);
      statusPath = extractStatusPath(status);
      statusFilename = extractStatusFilename(status);
      fullPath = statusFullPath(status);
    } catch (e) {
      statusCheckState = "error";
      statusCheckErrors.push("getSyncStatus_failed");
      Zotero.debug("[Codex BN Sync] getSyncStatus failed for noteID=" + noteId + ": " + e);
    }
  }

  if (typeof syncAPI?.isSyncNote !== "function") {
    statusCheckState = "error";
    statusCheckErrors.push("isSyncNote_unavailable");
  } else {
    try {
      isAnySyncNote = !!(await syncAPI.isSyncNote(noteId));
    } catch (e) {
      statusCheckState = "error";
      statusCheckErrors.push("isSyncNote_failed");
      Zotero.debug("[Codex BN Sync] isSyncNote failed for noteID=" + noteId + ": " + e);
    }
  }

  const fileCheck = statusCheckState === "ok" ? await pathExists(fullPath) : { state: "missing" };
  return {
    isAnySyncNote,
    statusCheckState,
    statusCheckError: statusCheckErrors.join("; "),
    statusPath,
    statusFilename,
    fullPath,
    fileCheckState: fileCheck.state,
    fileCheckError: fileCheck.error ? shortErrorMessage(fileCheck.error) : "",
    fileExists: fileCheck.state === "exists",
    isCorrectRoot: isStatusFileInRoot(status),
  };
}

async function syncNoteToRoot(noteItem) {
  await ensureDir(ROOT_DIR);
  assertNoCrossProjectConflict(noteItem);

  const before = await getRootSyncState(noteItem.id);
  if (before.statusCheckState === "error") {
    throw new Error(`sync_status_check_failed: ${before.statusCheckError}`);
  }
  if (before.isCorrectRoot && before.fileCheckState === "error") {
    throw new Error("sync_file_check_failed");
  }
  if (before.isCorrectRoot && before.fileExists && !FORCE_EXPORT_EXISTING) {
    return "already_linked";
  }
  if (before.isCorrectRoot && !before.fileExists && !RECREATE_MISSING_MARKDOWN) {
    throw new Error("sync_file_missing_recreate_disabled");
  }
  if (before.isAnySyncNote && !before.isCorrectRoot && !ALLOW_CROSS_PROJECT_MIGRATION) {
    throw new Error("cross_project_note_conflict: note is already registered to another Better Notes root");
  }
  if (before.isAnySyncNote && !before.isCorrectRoot) {
    Zotero.debug("[Codex BN Sync] Cross-project migration is enabled for note " + noteItem.key + "; re-registering without deleting the old Markdown copy.");
  }

  await preflightMarkdownFilename(noteItem.id);
  await Zotero.BetterNotes.api.$export.syncMDBatch(ROOT_DIR, [noteItem.id]);

  const after = await getRootSyncState(noteItem.id);
  if (after.statusCheckState === "error") {
    throw new Error(`sync_status_check_failed: ${after.statusCheckError}`);
  }
  if (!after.isCorrectRoot) {
    Zotero.debug("[Codex BN Sync] sync status outside ROOT_DIR after export for note " + noteItem.key + ": path=" + redactLocalPaths(after.statusPath) + "; filename=" + after.statusFilename);
    throw new Error("sync_status_wrong_root");
  }
  if (after.fileCheckState === "error") {
    throw new Error("sync_file_check_failed");
  }
  if (!after.fileExists) {
    Zotero.debug("[Codex BN Sync] sync status points to missing Markdown after export for note " + noteItem.key + ": " + redactLocalPaths(after.fullPath));
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
  if (!noteItem?.isNote?.()) return false;
  const marker = `${CODEX_MARKER_PREFIX}${parentKey}`;
  const html = noteItem.getNote?.() || "";
  if (html.includes(marker)) return false;
  noteItem.setNote(`${html}\n<p><!-- ${marker} --></p>`);
  return true;
}

function getLibrarySegment(zoteroItem) {
  const library = Zotero.Libraries.get(zoteroItem.libraryID);
  if (library?.libraryType === "user") return "library";
  const groupID = library?.groupID || library?.id;
  return groupID ? `groups/${groupID}` : "library";
}

function zoteroSelectLink(zoteroItem) {
  return `zotero://select/${getLibrarySegment(zoteroItem)}/items/${zoteroItem.key}`;
}

function zoteroNoteLink(noteItem) {
  return zoteroSelectLink(noteItem);
}

async function getBestPDFAttachment(parentItem) {
  if (!parentItem?.isRegularItem?.()) return null;
  try {
    const bestAttachments = (await parentItem.getBestAttachments?.()) || [];
    const bestPDF = bestAttachments.find((att) => att?.isPDFAttachment?.() || att?.attachmentContentType === "application/pdf");
    if (bestPDF) return bestPDF;
  } catch (e) {
    Zotero.debug("[Codex BN Sync] getBestAttachments failed for " + (parentItem.key || parentItem.id) + ": " + e);
  }

  try {
    const attachments = Zotero.Items.get(parentItem.getAttachments?.() || []);
    return attachments.find((att) => att?.isPDFAttachment?.() || att?.attachmentContentType === "application/pdf") || null;
  } catch (e) {
    Zotero.debug("[Codex BN Sync] PDF attachment fallback failed for " + (parentItem.key || parentItem.id) + ": " + e);
    return null;
  }
}

function zoteroPDFLink(pdfAttachment) {
  return `zotero://open-pdf/${getLibrarySegment(pdfAttachment)}/items/${pdfAttachment.key}`;
}

function zoteroLinksBlockRegex(markerKey) {
  const marker = `${LINKS_MARKER_PREFIX}${markerKey}`;
  return new RegExp(
    `<div\\s+data-codex-zotero-links="${escapeRegExp(PROJECT_ID)}"[\\s\\S]*?<!--\\s*${escapeRegExp(marker)}\\s*-->[\\s\\S]*?</div>\\s*`,
    "g",
  );
}

function insertBeforeProjectMarker(html, parentKey, block) {
  const projectMarker = `${CODEX_MARKER_PREFIX}${parentKey}`;
  const markerRegex = new RegExp(`\\s*<p><!--\\s*${escapeRegExp(projectMarker)}\\s*--></p>\\s*$`);
  if (markerRegex.test(html)) {
    return html.replace(markerRegex, `\n${block}\n<p><!-- ${projectMarker} --></p>`);
  }
  return `${html.trimEnd()}\n${block}`;
}

async function buildZoteroLinksBlock(parentItem, noteItem) {
  const markerKey = parentItem?.key || noteItem.key;
  const title = parentItem?.getField?.("title") || noteItem.getNoteTitle?.() || noteItem.key;
  const links = [];

  if (parentItem) {
    links.push(`<li><strong>Zotero 条目：</strong><a href="${escapeHTML(zoteroSelectLink(parentItem))}">${escapeHTML(title)}</a></li>`);
  }

  links.push(`<li><strong>阅读卡 Note：</strong><a href="${escapeHTML(zoteroNoteLink(noteItem))}">${escapeHTML(noteItem.key)}</a></li>`);

  const pdfAttachment = parentItem ? await getBestPDFAttachment(parentItem) : null;
  if (pdfAttachment) {
    links.push(`<li><strong>PDF：</strong><a href="${escapeHTML(zoteroPDFLink(pdfAttachment))}">${escapeHTML(pdfAttachment.getField?.("title") || "打开 PDF")}</a></li>`);
  }

  return `
<div data-codex-zotero-links="${escapeHTML(PROJECT_ID)}">
<h2>Zotero 链接</h2>
<ul>
${links.join("\n")}
</ul>
<p><!-- ${LINKS_MARKER_PREFIX}${markerKey} --></p>
</div>
`.trim();
}

async function ensureZoteroLinksBlock(parentItem, noteItem) {
  if (!noteItem?.isNote?.()) return false;
  const ownerItem = parentItem || getParentRegularItem(noteItem);
  const markerKey = ownerItem?.key || noteItem.key;
  const block = await buildZoteroLinksBlock(ownerItem, noteItem);
  const html = noteItem.getNote?.() || "";
  const blockRegex = zoteroLinksBlockRegex(markerKey);
  const withoutOldBlock = html.replace(blockRegex, "").trimEnd();
  const nextHTML = insertBeforeProjectMarker(withoutOldBlock, markerKey, block);
  if (nextHTML === html) return false;
  noteItem.setNote(nextHTML);
  return true;
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
  const candidates = noteItems
    .map((noteItem) => ({ noteItem, score: codexNoteMatchScore(noteItem, parentItem.key) }))
    .filter((candidate) => candidate.score >= 0)
    .sort((a, b) => b.score - a.score);
  return candidates[0]?.noteItem || null;
}

function codexNoteMatchScore(noteItem, parentKey) {
  const noteHTML = noteItem.getNote?.() || "";
  let score = 0;
  if (noteHTML.includes(`${CODEX_MARKER_PREFIX}${parentKey}`)) score += 100;
  if (hasTag(noteItem, SYNC_TAG)) score += 80;
  if (hasTag(noteItem, NOTE_TAG)) score += 70;
  if (hasTag(noteItem, ERROR_TAG)) score += 30;
  if (hasTag(noteItem, INITIALIZING_TAG)) score += 10;
  if (!score) return -1;
  if (hasMinimumReadingContent(noteItem, parentKey)) score += 20;
  if (hasAnyNoteContent(noteItem)) score += 5;
  return score;
}

function visibleNoteText(noteItem) {
  return (noteItem?.getNote?.() || "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasMinimumReadingContent(noteItem, parentKey) {
  const html = noteItem?.getNote?.() || "";
  const marker = `${CODEX_MARKER_PREFIX}${parentKey}`;
  return html.includes(marker) && visibleNoteText(noteItem).length > 40;
}

function hasContentElement(html) {
  return /<(img|table|tr|td|th|a|blockquote|figure|iframe|embed|object|video|audio|svg|math|annotation|span|code|pre)\b/i.test(html);
}

function hasAnyNoteContent(noteItem) {
  const html = noteItem?.getNote?.() || "";
  if (hasContentElement(html)) return true;
  return visibleNoteText(noteItem).length > 0;
}

async function getOrCreateReadingNote(parentItem) {
  const existing = findExistingCodexNote(parentItem);
  if (existing) {
    assertNoCrossProjectConflict(existing);
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
      if (ALLOW_CROSS_PROJECT_MIGRATION) clearOtherProjectOwnership(zoteroItem);
      clearErrorComment(zoteroItem);
    }
  }
}

function markError(rawItem, noteItem, error) {
  const crossProjectConflict = String(error?.message || error || "").includes("cross_project_note_conflict");
  for (const zoteroItem of [rawItem, noteItem]) {
    if (!zoteroItem) continue;
    removeTagIfPresent(zoteroItem, SYNC_TAG);
    addTagOnce(zoteroItem, ERROR_TAG);
    if (zoteroItem.isNote?.() && !crossProjectConflict) {
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

if (
  !Zotero.BetterNotes?.api?.$export?.syncMDBatch ||
  !Zotero.BetterNotes?.api?.sync?.getMDFileName ||
  !Zotero.BetterNotes?.api?.sync?.getSyncStatus ||
  !Zotero.BetterNotes?.api?.sync?.isSyncNote
) {
  return "[Codex BN Sync] Required Better Notes APIs not available. Check Better Notes is installed/enabled and exposes syncMDBatch/getMDFileName/getSyncStatus/isSyncNote.";
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
  alreadyLinked: 0,
  registered: 0,
  reregistered: 0,
  recreatedMissing: 0,
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
  let parentItem = null;
  try {
    if (raw.isNote && raw.isNote()) {
      assertNoCrossProjectConflict(raw);
      noteItem = raw;
      parentItem = getParentRegularItem(raw);
      addTagOnce(noteItem, NOTE_TAG);
      addTagOnce(noteItem, REVIEW_TAG);
    } else {
      parentItem = getParentRegularItem(raw);
      if (!parentItem) {
        stats.skipped += 1;
        continue;
      }

      const result = await withItemLock(parentItem, () => getOrCreateReadingNote(parentItem));
      noteItem = result.noteItem;
      if (result.created) stats.created += 1;
      else stats.existing += 1;
      if (result.contentSource === "template") stats.template += 1;
      if (result.contentSource === "fallback") stats.fallback += 1;
      if (result.contentSource === "reinitialized") stats.fallback += 1;
    }

    let noteChanged = false;
    if (clearErrorComment(noteItem)) noteChanged = true;
    if (parentItem && ensureProjectMarker(noteItem, parentItem.key)) noteChanged = true;
    if (await ensureZoteroLinksBlock(parentItem, noteItem)) noteChanged = true;
    if (noteChanged) {
      await saveChangedItems([noteItem]);
    }

    const syncAction = await withNoteLock(noteItem, async () => {
      assertNoCrossProjectConflict(noteItem);
      const queueState = captureQueueState(raw, noteItem);
      const action = await syncNoteToRoot(noteItem);
      try {
        markDone(raw, noteItem);
        await saveChangedItems([raw, noteItem]);
      } catch (stateError) {
        restoreQueueState(raw, noteItem, queueState);
        throw new Error(`sync_succeeded_state_save_failed: ${shortErrorMessage(stateError)}`);
      }
      return action;
    });

    if (syncAction === "already_linked") stats.alreadyLinked += 1;
    if (syncAction === "forced_refreshed") stats.refreshed += 1;
    if (syncAction === "recreated_missing_file") stats.recreatedMissing += 1;
    if (syncAction === "registered") stats.registered += 1;
    if (syncAction === "reregistered") stats.reregistered += 1;
    stats.notes += 1;
    noteKeys.push(noteItem.key);
  } catch (e) {
    Zotero.debug("[Codex BN Sync] Failed on selected item " + (raw?.key || raw?.id) + ": " + e);
    if (!isTransientLockError(e)) {
      markError(raw, noteItem, e);
      try {
        await saveChangedItems([raw, noteItem]);
      } catch (stateError) {
        Zotero.debug("[Codex BN Sync] Failed to save error state for " + (raw?.key || raw?.id) + ": " + stateError);
      }
    }
    stats.failed += 1;
    failures.push(`${raw?.key || raw?.id}: ${shortErrorMessage(e).slice(0, 160)}`);
  }
}

const failureText = failures.length ? `; failures=${failures.join(" | ")}` : "";
return `[Codex BN Sync] Done. selected=${stats.selected}; notes=${stats.notes}; created=${stats.created}; existing=${stats.existing}; alreadyLinked=${stats.alreadyLinked}; registered=${stats.registered}; reregistered=${stats.reregistered}; recreatedMissing=${stats.recreatedMissing}; refreshed=${stats.refreshed}; template=${stats.template}; fallback=${stats.fallback}; skipped=${stats.skipped}; failed=${stats.failed}; autoSyncPref=${autoSyncPrefStatus}; project=${PROJECT_ID}; root=${ROOT_DIR}; noteKeys=${noteKeys.join(", ")}${failureText}`;
