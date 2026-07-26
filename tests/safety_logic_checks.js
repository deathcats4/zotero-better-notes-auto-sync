#!/usr/bin/env node
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

function loadHelpers(relativePath, stopMarker, transformSource = (source) => source) {
  const source = transformSource(fs.readFileSync(path.join(ROOT, relativePath), "utf8").replace(/\r\n/g, "\n"));
  const stop = source.indexOf(stopMarker);
  if (stop < 0) throw new Error(`Could not find stop marker in ${relativePath}`);
  const prefix = source.slice(0, stop);
  return new Function(
    `${prefix}
  return {
    assertNoCrossProjectConflict,
    ensureZoteroLinksBlock,
    clearOtherProjectOwnership,
    codexNoteMatchScore,
    getProjectLinkedNotesForAutosync: typeof getProjectLinkedNotesForAutosync === "function" ? getProjectLinkedNotesForAutosync : undefined,
    getRootSyncState,
  hasAnyNoteContent,
  hasMinimumReadingContent,
  hasUnsafeFilename,
  hasUnsafeMarkdownFilename,
  linkedNoteAutosyncHasPendingTimeouts: typeof linkedNoteAutosyncHasPendingTimeouts === "function" ? linkedNoteAutosyncHasPendingTimeouts : undefined,
  linkedNoteAutosyncIsRecentlyAttempted: typeof linkedNoteAutosyncIsRecentlyAttempted === "function" ? linkedNoteAutosyncIsRecentlyAttempted : undefined,
  isFilePathInRoot,
  isPathInRoot,
  isStatusFileInRoot,
  otherProjectOwnershipTokens,
  pathExists,
  preflightMarkdownFilename,
  rotateLinkedNoteAutosyncCandidates: typeof rotateLinkedNoteAutosyncCandidates === "function" ? rotateLinkedNoteAutosyncCandidates : undefined,
  runProjectLinkedNoteAutosync: typeof runProjectLinkedNoteAutosync === "function" ? runProjectLinkedNoteAutosync : undefined,
  statusFullPath,
    withNoteLock,
    withTimeout: typeof withTimeout === "function" ? withTimeout : undefined,
    visibleNoteText,
    zoteroPDFLink,
    zoteroSelectLink,
  };`,
  )();
}

function loadDaemonAutosyncHelpers() {
  return loadHelpers("scripts/actions-tags-bn-queue-daemon.js", "\nasync function processOneQueuedItem", (source) =>
    source
      .replace(/const ENABLE_PROJECT_LINKED_NOTE_AUTOSYNC = false;[^\n]*/, "const ENABLE_PROJECT_LINKED_NOTE_AUTOSYNC = true;")
      .replace("const LINKED_NOTE_AUTOSYNC_TIMEOUT_MS = 12000;", "const LINKED_NOTE_AUTOSYNC_TIMEOUT_MS = 25;")
      .replace("const LINKED_NOTE_AUTOSYNC_RECHECK_MS = 60 * 1000;", "const LINKED_NOTE_AUTOSYNC_RECHECK_MS = 1000;"),
  );
}

function resetAutosyncGlobals() {
  for (const key of [
    "__codexBNItemLocks",
    "__codexBNNoteLocks",
    "__codexBNLinkedNoteAutosyncCooldowns",
    "__codexBNLinkedNoteAutosyncCursors",
    "__codexBNLinkedNoteAutosyncAttempts",
    "__codexBNLinkedNoteAutosyncTimedOut",
  ]) {
    delete globalThis[key];
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeSyncedNote(id) {
  return {
    id,
    libraryID: 1,
    key: `NOTE${id}`,
    deleted: false,
    isNote: () => true,
    getTags: () => [{ tag: "Codex/BN-Synced/PROJECT_NAME" }, { tag: "Codex/BN-Note/PROJECT_NAME" }],
    getNote: () => "<p><!-- codex-bn-sync:PROJECT_NAME:ITEMKEY --></p><p>Synced reading note.</p>",
  };
}

function installAutosyncZoteroStub(notes, onSyncing) {
  const byID = new Map(notes.map((note) => [note.id, note]));
  const root = "D:\\ObsidianVault\\BetterNotesSync\\PROJECT_NAME";
  global.IOUtils = { exists: async () => true };
  global.Zotero = {
    debug() {},
    Notes: { _editorInstances: [] },
    Libraries: { userLibraryID: 1 },
    Search: function Search() {
      this.addCondition = () => {};
      this.search = async () => notes.map((note) => note.id);
    },
    Items: {
      get: (ids) => (Array.isArray(ids) ? ids.map((id) => byID.get(id)).filter(Boolean) : byID.get(ids)),
      getAll: async () => notes,
    },
    BetterNotes: {
      hooks: { onSyncing },
      api: {
        sync: {
          getSyncStatus: async (noteId) => ({ path: root, filename: `note-${noteId}.md` }),
          isSyncNote: async () => true,
        },
      },
    },
  };
}

async function checkHelpers(label, helpers) {
  const root = "D:\\ObsidianVault\\BetterNotesSync\\PROJECT_NAME";

  assert.strictEqual(helpers.isPathInRoot(root), true, `${label}: root path should match exactly`);
  assert.strictEqual(helpers.isPathInRoot(`${root}\\..\\outside`), false, `${label}: traversal path must not match root`);
  assert.strictEqual(helpers.isFilePathInRoot(`${root}\\note.md`), true, `${label}: file under root should pass`);

  assert.strictEqual(helpers.hasUnsafeFilename("note.md"), false, `${label}: simple filename should pass`);
  assert.strictEqual(helpers.hasUnsafeFilename("..\\outside.md"), true, `${label}: traversal filename should fail`);
  assert.strictEqual(helpers.hasUnsafeFilename("../outside.md"), true, `${label}: slash traversal filename should fail`);
  assert.strictEqual(helpers.hasUnsafeFilename("D:\\outside.md"), true, `${label}: absolute filename should fail`);
  assert.strictEqual(helpers.hasUnsafeMarkdownFilename("note.txt"), true, `${label}: non-md filename should fail`);
  assert.strictEqual(helpers.hasUnsafeMarkdownFilename("note.md"), false, `${label}: md filename should pass`);

  assert.strictEqual(
    helpers.isStatusFileInRoot({ path: root, filename: "note.md" }),
    true,
    `${label}: status path + filename under root should pass`,
  );
  assert.strictEqual(
    helpers.isStatusFileInRoot({ path: `${root}\\..\\outside`, filename: "note.md" }),
    false,
    `${label}: status path traversal should fail`,
  );
  assert.strictEqual(
    helpers.isStatusFileInRoot({ path: root, filename: "..\\outside.md" }),
    false,
    `${label}: status filename traversal should fail`,
  );

  const shortValuableNote = { getNote: () => "<p>short but important</p>" };
  assert.strictEqual(helpers.hasAnyNoteContent(shortValuableNote), true, `${label}: nonempty short note should be protected`);
  assert.strictEqual(
    helpers.hasMinimumReadingContent(shortValuableNote, "ITEMKEY"),
    false,
    `${label}: short note lacks project marker but must still be recognized as nonempty`,
  );

  const markerOnlyNote = { getTags: () => [], getNote: () => "<p><!-- codex-bn-sync:PROJECT_NAME:ITEMKEY --></p>" };
  assert.strictEqual(helpers.visibleNoteText(markerOnlyNote), "", `${label}: marker-only note should have no visible text`);
  assert.strictEqual(helpers.hasAnyNoteContent(markerOnlyNote), false, `${label}: marker-only note should not count as real content`);
  assert.strictEqual(
    helpers.hasMinimumReadingContent(markerOnlyNote, "ITEMKEY"),
    false,
    `${label}: marker-only note should not pass minimum reading-content check`,
  );

  for (const [caseName, html] of [
    ["image", '<p><img src="zotero://attachment/foo"></p>'],
    ["table", "<table><tbody><tr><td></td></tr></tbody></table>"],
    ["linked image", '<p><a href="https://example.com"><img src="x.png"></a></p>'],
    ["citation span", '<span class="citation-item" data-citation-key="abc"></span>'],
  ]) {
    assert.strictEqual(
      helpers.hasAnyNoteContent({ getNote: () => html }),
      true,
      `${label}: ${caseName} note should be protected even without visible text`,
    );
  }

  const syncedCandidate = {
    getTags: () => [{ tag: "Codex/BN-Synced/PROJECT_NAME" }],
    getNote: () => "<p><!-- codex-bn-sync:PROJECT_NAME:ITEMKEY --></p><p>This is a complete reading note with enough visible text to outrank an empty initializing note.</p>",
  };
  const initializingCandidate = {
    getTags: () => [{ tag: "Codex/BN-Initializing/PROJECT_NAME" }],
    getNote: () => "",
  };
  assert(
    helpers.codexNoteMatchScore(syncedCandidate, "ITEMKEY") > helpers.codexNoteMatchScore(initializingCandidate, "ITEMKEY"),
    `${label}: candidate scoring should prefer complete synced notes over empty initializing notes`,
  );

  const tagConflictNote = {
    getTags: () => [
      { tag: "Codex/BN-Synced/other-project" },
      { tag: "Codex/Queue/BN-Sync/other-project" },
      { tag: "Codex/BN-Sync-Error/other-project" },
    ],
    getNote: () => "",
  };
  assert.deepStrictEqual(
    helpers.otherProjectOwnershipTokens(tagConflictNote),
    ["Codex/BN-Synced/other-project", "Codex/Queue/BN-Sync/other-project", "Codex/BN-Sync-Error/other-project"],
    `${label}: should detect other project status tags`,
  );
  assert.throws(
    () => helpers.assertNoCrossProjectConflict(tagConflictNote),
    /cross_project_note_conflict/,
    `${label}: should reject other project-owned notes`,
  );

  const markerConflictNote = {
    getTags: () => [],
    getNote: () => "<p><!-- codex-bn-sync:other-project:ITEMKEY --></p>",
  };
  assert.deepStrictEqual(
    helpers.otherProjectOwnershipTokens(markerConflictNote),
    ["marker:other-project"],
    `${label}: should detect other project markers`,
  );

  const linksConflictNote = {
    getTags: () => [],
    getNote: () => '<div data-codex-zotero-links="other-project"><p>Old links</p><!-- codex-zotero-links:other-project:ITEMKEY --></div>',
  };
  assert.deepStrictEqual(
    helpers.otherProjectOwnershipTokens(linksConflictNote),
    ["links:other-project"],
    `${label}: should detect other project Zotero backlink markers`,
  );

  const prefixLinksConflictNote = {
    getTags: () => [],
    getNote: () => '<div data-codex-zotero-links="PROJECT_NAME-old"><p>Prefix links</p><!-- codex-zotero-links:PROJECT_NAME-old:ITEMKEY --></div>',
  };
  assert.deepStrictEqual(
    helpers.otherProjectOwnershipTokens(prefixLinksConflictNote),
    ["links:PROJECT_NAME-old"],
    `${label}: should detect backlink projects that share the current project prefix`,
  );

  let migrationTags = [
    "Codex/Queue/BN-Sync/PROJECT_NAME",
    "Codex/BN-Synced/PROJECT_NAME",
    "Codex/BN-Note/PROJECT_NAME",
    "Codex/BN-Synced/old-project",
    "Codex/BN-Note/old-project",
    "Codex/BN-Sync-Error/old-project",
    "Codex/BN-Initializing/old-project",
  ];
  let migrationHTML =
    '<div data-codex-zotero-links="old-project"><p>Old links</p><!-- codex-zotero-links:old-project:ITEMKEY --></div>' +
    '<div data-codex-zotero-links="PROJECT_NAME"><p>Current links</p><!-- codex-zotero-links:PROJECT_NAME:ITEMKEY --></div>' +
    '<p><!-- codex-bn-sync:old-project:ITEMKEY --></p><p><!-- codex-bn-sync:PROJECT_NAME:ITEMKEY --></p><p>Visible text</p>';
  const migrationNote = {
    isNote: () => true,
    getTags: () => migrationTags.map((tag) => ({ tag })),
    removeTag: (tag) => {
      migrationTags = migrationTags.filter((existing) => existing !== tag);
    },
    getNote: () => migrationHTML,
    setNote: (html) => {
      migrationHTML = html;
    },
  };
  helpers.clearOtherProjectOwnership(migrationNote);
  assert.deepStrictEqual(
    migrationTags,
    ["Codex/Queue/BN-Sync/PROJECT_NAME", "Codex/BN-Synced/PROJECT_NAME", "Codex/BN-Note/PROJECT_NAME"],
    `${label}: migration cleanup should remove only other-project ownership tags`,
  );
  assert(!migrationHTML.includes("old-project"), `${label}: migration cleanup should remove old project marker and backlink block`);
  assert(migrationHTML.includes("codex-bn-sync:PROJECT_NAME:ITEMKEY"), `${label}: migration cleanup should preserve current marker`);
  assert(migrationHTML.includes("codex-zotero-links:PROJECT_NAME:ITEMKEY"), `${label}: migration cleanup should preserve current backlink block`);

  let prefixMigrationHTML =
    '<div data-codex-zotero-links="PROJECT_NAME-old"><p>Prefix old links</p><!-- codex-zotero-links:PROJECT_NAME-old:ITEMKEY --></div>' +
    '<div data-codex-zotero-links="PROJECT_NAME"><p>Current links</p><!-- codex-zotero-links:PROJECT_NAME:ITEMKEY --></div>';
  const prefixMigrationNote = {
    isNote: () => true,
    getTags: () => [],
    getNote: () => prefixMigrationHTML,
    setNote: (html) => {
      prefixMigrationHTML = html;
    },
  };
  helpers.clearOtherProjectOwnership(prefixMigrationNote);
  assert(!prefixMigrationHTML.includes("PROJECT_NAME-old"), `${label}: migration cleanup should remove prefix-matching old backlink project`);
  assert(!prefixMigrationHTML.includes("Prefix old links"), `${label}: migration cleanup should not leave old backlink content after marker cleanup`);
  assert(prefixMigrationHTML.includes("codex-zotero-links:PROJECT_NAME:ITEMKEY"), `${label}: migration cleanup should preserve current prefix backlink block`);

  const pdfAttachment = {
    libraryID: 1,
    key: "PDFKEY",
    isPDFAttachment: () => true,
    getField: () => "Primary PDF",
  };
  const parentItem = {
    libraryID: 1,
    key: "ITEMKEY",
    isRegularItem: () => true,
    getField: (field) => (field === "title" ? "Paper Title" : ""),
    getBestAttachments: async () => [pdfAttachment],
    getAttachments: () => [],
  };
  let linkedHTML = "<p>Visible reading note</p>\n<p><!-- codex-bn-sync:PROJECT_NAME:ITEMKEY --></p>";
  const linkedNote = {
    libraryID: 1,
    key: "NOTEKEY",
    isNote: () => true,
    getNoteTitle: () => "Reading Note",
    getNote: () => linkedHTML,
    setNote: (html) => {
      linkedHTML = html;
    },
  };
  global.Zotero = {
    debug() {},
    Libraries: { get: () => ({ libraryType: "user" }) },
    Items: { get: () => [] },
  };
  assert.strictEqual(
    await helpers.ensureZoteroLinksBlock(parentItem, linkedNote),
    true,
    `${label}: first link-layer insertion should modify the note`,
  );
  assert(linkedHTML.includes("data-codex-zotero-links=\"PROJECT_NAME\""), `${label}: link block should be project-scoped`);
  assert(linkedHTML.includes("zotero://select/library/items/ITEMKEY"), `${label}: link block should include Zotero item select URI`);
  assert(linkedHTML.includes("zotero://select/library/items/NOTEKEY"), `${label}: link block should include Zotero note select URI`);
  assert(linkedHTML.includes("zotero://open-pdf/library/items/PDFKEY"), `${label}: link block should include PDF open URI`);
  assert.strictEqual(
    (linkedHTML.match(/data-codex-zotero-links/g) || []).length,
    1,
    `${label}: link block should appear once after first insertion`,
  );
  assert.strictEqual(
    await helpers.ensureZoteroLinksBlock(parentItem, linkedNote),
    false,
    `${label}: repeated link-layer insertion should be a no-op`,
  );
  assert.strictEqual(
    (linkedHTML.match(/data-codex-zotero-links/g) || []).length,
    1,
    `${label}: repeated link-layer insertion should not duplicate the block`,
  );

  global.Zotero = { debug() {} };
  global.IOUtils = { exists: async () => true };
  assert.strictEqual((await helpers.pathExists(`${root}\\note.md`)).state, "exists", `${label}: pathExists should report exists`);
  global.IOUtils = { exists: async () => false };
  assert.strictEqual((await helpers.pathExists(`${root}\\missing.md`)).state, "missing", `${label}: pathExists should report missing`);
  global.IOUtils = {
    exists: async () => {
      throw new Error("EACCES");
    },
  };
  assert.strictEqual((await helpers.pathExists(`${root}\\locked.md`)).state, "error", `${label}: pathExists should preserve check errors`);

  global.Zotero = {
    debug() {},
    BetterNotes: { api: { sync: { getMDFileName: async () => "safe.md" } } },
  };
  assert.strictEqual(await helpers.preflightMarkdownFilename(123), "safe.md", `${label}: safe preflight filename should pass`);
  global.Zotero = {
    debug() {},
    BetterNotes: { api: { sync: { getMDFileName: async () => "..\\outside.md" } } },
  };
  await assert.rejects(
    () => helpers.preflightMarkdownFilename(123),
    /unsafe_markdown_filename/,
    `${label}: unsafe preflight filename should fail before export`,
  );
  global.Zotero = { debug() {}, BetterNotes: { api: { sync: {} } } };
  await assert.rejects(
    () => helpers.preflightMarkdownFilename(123),
    /markdown_filename_precheck_unavailable/,
    `${label}: missing getMDFileName should fail closed`,
  );

  global.IOUtils = { exists: async () => true };
  global.Zotero = {
    debug() {},
    BetterNotes: {
      api: {
        sync: {
          getSyncStatus: async () => ({ path: root, filename: "note.md" }),
          isSyncNote: async () => true,
        },
      },
    },
  };
  const okState = await helpers.getRootSyncState(123);
  assert.strictEqual(okState.statusCheckState, "ok", `${label}: status check should pass when both APIs work`);
  assert.strictEqual(okState.fileExists, true, `${label}: status check should still verify file existence when status works`);

  global.Zotero = {
    debug() {},
    BetterNotes: {
      api: {
        sync: {
          getSyncStatus: async () => {
            throw new Error("temporary status failure");
          },
          isSyncNote: async () => true,
        },
      },
    },
  };
  const getStatusFailed = await helpers.getRootSyncState(123);
  assert.strictEqual(getStatusFailed.statusCheckState, "error", `${label}: getSyncStatus failure should fail closed`);
  assert.match(getStatusFailed.statusCheckError, /getSyncStatus_failed/, `${label}: getSyncStatus failure should be explicit`);

  global.Zotero = {
    debug() {},
    BetterNotes: {
      api: {
        sync: {
          getSyncStatus: async () => ({ path: root, filename: "note.md" }),
          isSyncNote: async () => {
            throw new Error("temporary sync-note failure");
          },
        },
      },
    },
  };
  const isSyncFailed = await helpers.getRootSyncState(123);
  assert.strictEqual(isSyncFailed.statusCheckState, "error", `${label}: isSyncNote failure should fail closed`);
  assert.match(isSyncFailed.statusCheckError, /isSyncNote_failed/, `${label}: isSyncNote failure should be explicit`);

  global.Zotero = { debug() {}, BetterNotes: { api: { sync: { getSyncStatus: async () => null } } } };
  const missingStatusAPI = await helpers.getRootSyncState(123);
  assert.strictEqual(missingStatusAPI.statusCheckState, "error", `${label}: missing isSyncNote should fail closed`);
  assert.match(missingStatusAPI.statusCheckError, /isSyncNote_unavailable/, `${label}: missing status API should be explicit`);
}

async function checkLinkedNoteAutosyncBehavior() {
  let helpers = loadDaemonAutosyncHelpers();
  resetAutosyncGlobals();
  const lockedNote = makeSyncedNote(1);
  let releaseSync;
  const pendingSync = new Promise((resolve) => {
    releaseSync = resolve;
  });
  installAutosyncZoteroStub([lockedNote], () => pendingSync);
  const timeoutStats = await helpers.runProjectLinkedNoteAutosync();
  assert.strictEqual(timeoutStats.attempted, 1, "daemon: timeout path should count the attempted Better Notes call");
  assert.strictEqual(timeoutStats.timedOut, 1, "daemon: unresolved Better Notes call should time out");
  assert.strictEqual(helpers.linkedNoteAutosyncHasPendingTimeouts(), true, "daemon: timed-out promise should suspend linked-note autosync");
  await assert.rejects(
    () => helpers.withNoteLock(lockedNote, async () => "should not run"),
    /codex_bn_lock_busy/,
    "daemon: note lock must remain held until the original Better Notes promise resolves",
  );
  releaseSync();
  await sleep(0);
  await sleep(0);
  assert.strictEqual(helpers.linkedNoteAutosyncHasPendingTimeouts(), false, "daemon: timed-out promise should clear suspension after it settles");
  assert.strictEqual(await helpers.withNoteLock(lockedNote, async () => "released"), "released", "daemon: note lock should release after original promise settles");

  helpers = loadDaemonAutosyncHelpers();
  resetAutosyncGlobals();
  const candidates = Array.from({ length: 12 }, (_, index) => ({ id: index + 1 }));
  const selected = new Set();
  for (let i = 0; i < 3; i += 1) {
    for (const candidate of helpers.rotateLinkedNoteAutosyncCandidates(candidates)) {
      selected.add(candidate.id);
    }
  }
  assert.deepStrictEqual(
    [...selected].sort((a, b) => a - b),
    candidates.map((candidate) => candidate.id),
    "daemon: rotation should cover all 12 candidates across three 5-note ticks",
  );

  helpers = loadDaemonAutosyncHelpers();
  resetAutosyncGlobals();
  const recentNote = makeSyncedNote(2);
  let syncCalls = 0;
  installAutosyncZoteroStub([recentNote], async () => {
    syncCalls += 1;
  });
  const firstStats = await helpers.runProjectLinkedNoteAutosync();
  const secondStats = await helpers.runProjectLinkedNoteAutosync();
  assert.strictEqual(firstStats.attempted, 1, "daemon: first eligible note should be checked once");
  assert.strictEqual(secondStats.attempted, 0, "daemon: recently checked note should not be called again inside the recheck interval");
  assert.strictEqual(secondStats.skippedRecent, 1, "daemon: recent attempt should be reported as a skipped recheck");
  assert.strictEqual(syncCalls, 1, "daemon: successful check should be throttled by the recheck interval");
}

async function main() {
  await checkHelpers(
    "manual",
    loadHelpers("scripts/actions-tags-bn-autosync-selected.js", "\nif (\n  !Zotero.BetterNotes?.api?.$export?.syncMDBatch"),
  );
  await checkHelpers(
    "daemon",
    loadHelpers("scripts/actions-tags-bn-queue-daemon.js", "\nasync function processOneQueuedItem"),
  );
  await checkLinkedNoteAutosyncBehavior();

  console.log("Safety logic checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
