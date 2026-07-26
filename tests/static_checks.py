#!/usr/bin/env python
"""Static regression checks for the Zotero Better Notes bridge scripts.

These checks do not replace integration testing inside Zotero. They guard the
highest-risk state-machine invariants that are easy to regress during edits.
"""

from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MANUAL = ROOT / "scripts" / "actions-tags-bn-autosync-selected.js"
DAEMON = ROOT / "scripts" / "actions-tags-bn-queue-daemon.js"
READING_CARD_TEMPLATE = ROOT / "templates" / "codex-literature-reading-card.better-notes.yml"
READING_CARD_REFERENCE = ROOT / "references" / "better-notes-reading-card-template.md"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def assert_contains(source: str, needle: str, label: str) -> None:
    if needle not in source:
        raise AssertionError(f"{label}: missing {needle!r}")


def assert_not_contains(source: str, needle: str, label: str) -> None:
    if needle in source:
        raise AssertionError(f"{label}: forbidden {needle!r}")


def assert_order(source: str, first: str, second: str, label: str) -> None:
    first_idx = source.find(first)
    second_idx = source.find(second)
    if first_idx < 0 or second_idx < 0 or first_idx > second_idx:
        raise AssertionError(f"{label}: expected {first!r} before {second!r}")


def check_common(source: str, label: str, restore_call: str, mark_error_call: str) -> None:
    assert_contains(source, "const NOTE_TAG = `Codex/BN-Note/${PROJECT_ID}`;", label)
    assert_contains(source, "const INITIALIZING_TAG = `Codex/BN-Initializing/${PROJECT_ID}`;", label)
    assert_contains(source, 'const TEMPLATE_NAME = "[item]Codex 中英文献精读卡";', label)
    assert_contains(source, "const FORCE_EXPORT_EXISTING = false;", label)
    assert_contains(source, "const RECREATE_MISSING_MARKDOWN = true;", label)
    assert_contains(source, "const ALLOW_CROSS_PROJECT_MIGRATION = false;", label)
    assert_contains(source, "const CODEX_QUEUE_TAG_PREFIX = \"Codex/Queue/BN-Sync/\";", label)
    assert_contains(source, "const CODEX_SYNC_TAG_PREFIX = \"Codex/BN-Synced/\";", label)
    assert_contains(source, "const CODEX_NOTE_TAG_PREFIX = \"Codex/BN-Note/\";", label)
    assert_contains(source, "const CODEX_ERROR_TAG_PREFIX = \"Codex/BN-Sync-Error/\";", label)
    assert_contains(source, "const CODEX_INITIALIZING_TAG_PREFIX = \"Codex/BN-Initializing/\";", label)
    assert_contains(source, "sync_succeeded_state_save_failed", label)
    assert_contains(source, "sync_file_check_failed", label)
    assert_contains(source, "sync_status_check_failed", label)
    assert_contains(source, "unsafe_markdown_filename", label)
    assert_contains(source, "cross_project_note_conflict", label)
    assert_contains(source, "markdown_filename_precheck_unavailable", label)
    assert_contains(source, "function captureQueueState", label)
    assert_contains(source, "function restoreQueueState", label)
    assert_contains(source, "function ensureSharedLockContainers", label)
    assert_contains(source, "function withItemLock", label)
    assert_contains(source, "function withNoteLock", label)
    assert_contains(source, "function redactLocalPaths", label)
    assert_contains(source, "function extractStatusFilename", label)
    assert_contains(source, "function statusFullPath", label)
    assert_contains(source, "function isStatusFileInRoot", label)
    assert_contains(source, "function isFilePathInRoot", label)
    assert_contains(source, "return candidate === root;", label)
    assert_contains(source, "function pathExists", label)
    assert_contains(source, "return { state: exists ? \"exists\" : \"missing\" };", label)
    assert_contains(source, "return { state: \"error\", error: e };", label)
    assert_contains(source, "function preflightMarkdownFilename", label)
    assert_contains(source, "getMDFileName(noteId, ROOT_DIR)", label)
    assert_contains(source, "function clearOtherProjectOwnership", label)
    assert_contains(source, "function hasUnsafeMarkdownFilename", label)
    assert_contains(source, "function visibleNoteText", label)
    assert_contains(source, "function hasAnyNoteContent", label)
    assert_contains(source, "function hasContentElement", label)
    assert_contains(source, "function codexNoteMatchScore", label)
    assert_contains(source, "function otherProjectOwnershipTokens", label)
    assert_contains(source, "const LINKS_MARKER_PROJECT_RE", label)
    assert_contains(source, "const LINKS_BLOCK_PROJECT_RE", label)
    assert_contains(source, "function stripOtherProjectZoteroLinksBlocks", label)
    assert_contains(source, "data-codex-zotero-links", label)
    assert_contains(source, "statusCheckState", label)
    assert_contains(source, "getSyncStatus_unavailable", label)
    assert_contains(source, "isSyncNote_unavailable", label)
    assert_contains(source, "getSyncStatus_failed", label)
    assert_contains(source, "isSyncNote_failed", label)
    assert_contains(source, 'return "already_linked";', label)
    assert_contains(source, 'return "recreated_missing_file";', label)
    assert_contains(source, 'throw new Error("sync_file_missing_recreate_disabled");', label)
    assert_contains(source, 'throw new Error("sync_file_check_failed");', label)
    assert_order(source, "if (before.isCorrectRoot && before.fileExists && !FORCE_EXPORT_EXISTING)", "await Zotero.BetterNotes.api.$export.syncMDBatch", label)
    assert_order(source, "if (before.statusCheckState === \"error\")", "await preflightMarkdownFilename(noteItem.id);", label)
    assert_order(source, "await preflightMarkdownFilename(noteItem.id);", "await Zotero.BetterNotes.api.$export.syncMDBatch", label)
    assert_order(source, "if (after.statusCheckState === \"error\")", "if (!after.isCorrectRoot)", label)
    assert_order(source, "if (hasAnyNoteContent(existing))", "await applyTemplateOrFallback(parentItem, existing);", label)
    assert_order(source, "statusFilename = extractStatusFilename(status);", "isCorrectRoot: isStatusFileInRoot(status)", label)
    assert_contains(source, "if (clearErrorComment(noteItem))", label)
    assert_order(source, "if (clearErrorComment(noteItem))", "const queueState = captureQueueState", label)
    assert_order(source, "const queueState = captureQueueState", "await syncNoteToRoot(noteItem)", label)
    assert_order(source, restore_call, mark_error_call, label)
    assert_order(source, "assertNoCrossProjectConflict(noteItem);", "await preflightMarkdownFilename(noteItem.id);", label)
    assert_order(source, "addTagOnce(zoteroItem, REVIEW_TAG);", "if (ALLOW_CROSS_PROJECT_MIGRATION) clearOtherProjectOwnership(zoteroItem);", label)
    assert_not_contains(source, "error?.stack", label)
    assert_not_contains(source, "Prefs.set", label)
    assert_not_contains(source, "observed=${observed}", label)
    assert_not_contains(source, "error.message || error", label)
    assert_not_contains(source, 'return "linked_missing_file";', label)


def check_reading_card_template() -> None:
    template = read(READING_CARD_TEMPLATE)
    reference = read(READING_CARD_REFERENCE)

    assert_contains(template, 'name: "[item]Codex 中英文献精读卡"', "reading-card template")
    assert_contains(template, "// @use-markdown", "reading-card template")
    assert_contains(template, "sharedObj.codexReadingCard", "reading-card template")
    assert_contains(template, "targetNoteItem", "reading-card template")
    assert_contains(template, "zotero://select/", "reading-card template")
    assert_contains(template, "zotero://open-pdf/", "reading-card template")
    for section in [
        "## 1. 一句话定位",
        "## 2. 摘要与研究问题",
        "## 3. 方法与数据",
        "## 4. 核心结论",
        "## 5. 证据候选表",
        "## 6. 标注与摘录整理",
        "## 7. 我的判断",
        "## 8. 待人工复核",
        "## 9. Codex 状态",
    ]:
        assert_contains(template, section, "reading-card template")
    assert_contains(reference, "[item]Codex 中英文献精读卡", "reading-card reference")
    assert_contains(reference, "const TEMPLATE_NAME = \"[item]Codex 中英文献精读卡\";", "reading-card reference")


def main() -> int:
    manual = read(MANUAL)
    daemon = read(DAEMON)

    check_common(manual, "manual", "restoreQueueState(raw, noteItem, queueState);", "markError(raw, noteItem, e);")
    check_common(daemon, "daemon", "restoreQueueState(rawItem, noteItem, queueState);", "markError(rawItem, noteItem, e);")
    assert_contains(daemon, "const DAEMON_KEY = `codexBNQueue:${PROJECT_ID}`;", "daemon")
    assert_contains(daemon, "const ENABLE_PROJECT_LINKED_NOTE_AUTOSYNC = false;", "daemon")
    assert_contains(daemon, "linkedAutosyncAttempted", "daemon")
    assert_contains(daemon, "linkedAutosyncSuspended", "daemon")
    assert_contains(daemon, "skippedRecent", "daemon")
    assert_contains(daemon, "skipActive: true", "daemon")
    assert_contains(daemon, "LINKED_NOTE_AUTOSYNC_TIMEOUT_MS", "daemon")
    assert_contains(daemon, "LINKED_NOTE_AUTOSYNC_RECHECK_MS", "daemon")
    assert_contains(daemon, "putLinkedNoteAutosyncCooldown", "daemon")
    assert_contains(daemon, "putLinkedNoteAutosyncAttempt", "daemon")
    assert_contains(daemon, "trackTimedOutLinkedNoteAutosync", "daemon")
    assert_contains(daemon, "__codexBNLinkedNoteAutosyncTimedOut", "daemon")
    assert_contains(daemon, "rotateLinkedNoteAutosyncCandidates", "daemon")
    assert_order(daemon, "syncPromise = withNoteLock(noteItem", "onSyncing([noteItem]", "daemon")
    assert_order(daemon, "stats.attempted += 1;", "await withTimeout(", "daemon")
    assert_contains(daemon, "trackTimedOutLinkedNoteAutosync(noteItem, syncPromise);", "daemon")
    assert_order(daemon, "const queued = await getQueuedItems();", "if (!queued.length)", "daemon")
    assert_order(daemon, "if (!queued.length)", "const linkedAutosyncResult = await runProjectLinkedNoteAutosync();", "daemon")
    assert_not_contains(daemon, "skipActive: false", "daemon")
    assert_not_contains(daemon, "ACTIVE_NOTE_SETTLE_SECONDS", "daemon")
    assert_not_contains(daemon, "activeNoteIsSettled", "daemon")
    assert_contains(daemon, "globalThis.__codexBNQueueTimers = new Map();", "daemon")
    assert_contains(daemon, "globalThis.__codexBNQueueBusy = new Set();", "daemon")
    assert_contains(daemon, "clearInterval(globalThis.__codexBNQueueTimers.get(DAEMON_KEY));", "daemon")
    assert_contains(daemon, "daemon (re)started", "daemon")
    assert_contains(daemon, "processQueueOnce failed", "daemon")
    assert_not_contains(daemon, "globalThis.__codexBNQueueBusy = true", "daemon")
    check_reading_card_template()
    print("Static checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
