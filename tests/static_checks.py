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
    assert_contains(source, "const FORCE_EXPORT_EXISTING = false;", label)
    assert_contains(source, "const RECREATE_MISSING_MARKDOWN = true;", label)
    assert_contains(source, "sync_succeeded_state_save_failed", label)
    assert_contains(source, "function captureQueueState", label)
    assert_contains(source, "function restoreQueueState", label)
    assert_contains(source, "function redactLocalPaths", label)
    assert_contains(source, "function extractStatusFilename", label)
    assert_contains(source, "function statusFullPath", label)
    assert_contains(source, "function isStatusFileInRoot", label)
    assert_contains(source, "function pathExists", label)
    assert_contains(source, 'return "already_linked";', label)
    assert_contains(source, 'return "recreated_missing_file";', label)
    assert_order(source, "if (before.isCorrectRoot && before.fileExists && !FORCE_EXPORT_EXISTING)", "await Zotero.BetterNotes.api.$export.syncMDBatch", label)
    assert_order(source, "statusFilename = extractStatusFilename(status);", "isCorrectRoot: isStatusFileInRoot(status)", label)
    assert_contains(source, "if (clearErrorComment(noteItem))", label)
    assert_order(source, "if (clearErrorComment(noteItem))", "const queueState = captureQueueState", label)
    assert_order(source, "const queueState = captureQueueState", "const syncAction = await syncNoteToRoot(noteItem)", label)
    assert_order(source, restore_call, mark_error_call, label)
    assert_not_contains(source, "error?.stack", label)
    assert_not_contains(source, "Prefs.set", label)
    assert_not_contains(source, "observed=${observed}", label)
    assert_not_contains(source, "error.message || error", label)


def main() -> int:
    manual = read(MANUAL)
    daemon = read(DAEMON)

    check_common(manual, "manual", "restoreQueueState(raw, noteItem, queueState);", "markError(raw, noteItem, e);")
    check_common(daemon, "daemon", "restoreQueueState(rawItem, noteItem, queueState);", "markError(rawItem, noteItem, e);")
    assert_contains(daemon, "const DAEMON_KEY = `codexBNQueue:${PROJECT_ID}`;", "daemon")
    assert_contains(daemon, "globalThis.__codexBNQueueTimers = new Map();", "daemon")
    assert_contains(daemon, "globalThis.__codexBNQueueBusy = new Set();", "daemon")
    assert_contains(daemon, "clearInterval(globalThis.__codexBNQueueTimers.get(DAEMON_KEY));", "daemon")
    assert_contains(daemon, "daemon (re)started", "daemon")
    assert_contains(daemon, "processQueueOnce failed", "daemon")
    assert_not_contains(daemon, "globalThis.__codexBNQueueBusy = true", "daemon")
    print("Static checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
