#!/usr/bin/env node
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

function loadHelpers(relativePath, stopMarker) {
  const source = fs.readFileSync(path.join(ROOT, relativePath), "utf8");
  const stop = source.indexOf(stopMarker);
  if (stop < 0) throw new Error(`Could not find stop marker in ${relativePath}`);
  const prefix = source.slice(0, stop);
  return new Function(
    `${prefix}
return {
  assertNoCrossProjectConflict,
  clearOtherProjectOwnership,
  codexNoteMatchScore,
  getRootSyncState,
  hasAnyNoteContent,
  hasMinimumReadingContent,
  hasUnsafeFilename,
  hasUnsafeMarkdownFilename,
  isFilePathInRoot,
  isPathInRoot,
  isStatusFileInRoot,
  otherProjectOwnershipTokens,
  pathExists,
  preflightMarkdownFilename,
  statusFullPath,
  visibleNoteText,
};`,
  )();
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
  assert(!migrationHTML.includes("old-project"), `${label}: migration cleanup should remove old project marker`);
  assert(migrationHTML.includes("codex-bn-sync:PROJECT_NAME:ITEMKEY"), `${label}: migration cleanup should preserve current marker`);

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

async function main() {
  await checkHelpers(
    "manual",
    loadHelpers("scripts/actions-tags-bn-autosync-selected.js", "\nif (\n  !Zotero.BetterNotes?.api?.$export?.syncMDBatch"),
  );
  await checkHelpers(
    "daemon",
    loadHelpers("scripts/actions-tags-bn-queue-daemon.js", "\nasync function queuedItemsFromSearch"),
  );

  console.log("Safety logic checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
