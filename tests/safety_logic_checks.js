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
  hasAnyNoteContent,
  hasMinimumReadingContent,
  hasUnsafeFilename,
  isFilePathInRoot,
  isPathInRoot,
  isStatusFileInRoot,
  statusFullPath,
};`,
  )();
}

function checkHelpers(label, helpers) {
  const root = "D:\\ObsidianVault\\BetterNotesSync\\PROJECT_NAME";

  assert.strictEqual(helpers.isPathInRoot(root), true, `${label}: root path should match exactly`);
  assert.strictEqual(helpers.isPathInRoot(`${root}\\..\\outside`), false, `${label}: traversal path must not match root`);
  assert.strictEqual(helpers.isFilePathInRoot(`${root}\\note.md`), true, `${label}: file under root should pass`);

  assert.strictEqual(helpers.hasUnsafeFilename("note.md"), false, `${label}: simple filename should pass`);
  assert.strictEqual(helpers.hasUnsafeFilename("..\\outside.md"), true, `${label}: traversal filename should fail`);
  assert.strictEqual(helpers.hasUnsafeFilename("../outside.md"), true, `${label}: slash traversal filename should fail`);
  assert.strictEqual(helpers.hasUnsafeFilename("D:\\outside.md"), true, `${label}: absolute filename should fail`);

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
}

checkHelpers(
  "manual",
  loadHelpers("scripts/actions-tags-bn-autosync-selected.js", "\nif (!Zotero.BetterNotes?.api?.$export?.syncMDBatch)"),
);
checkHelpers(
  "daemon",
  loadHelpers("scripts/actions-tags-bn-queue-daemon.js", "\nasync function queuedItemsFromSearch"),
);

console.log("Safety logic checks passed.");
