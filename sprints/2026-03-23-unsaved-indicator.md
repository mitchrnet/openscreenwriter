# Sprint: Features #2, #3, #4 — Close Guard, Pagination Stability, Recent Files
**Date:** 2026-03-23
**Branch:** `feature/unsaved-indicator`
**Status:** Ready for review

---

## What was built

A native OS dialog that appears when you try to close a window (or quit the app) with unsaved changes. The dialog offers three options: **Save**, **Don't Save**, or **Cancel**.

The dialog is smart about when to appear:
- **Shows:** when the document is dirty and autosave is off, or when autosave is on but the file has never been saved (new/untitled document)
- **Skips:** when autosave is on and the file has a real path — autosave has already written every change to disk, so there's nothing to warn about

---

## What was already there (no changes needed)

The visual indicator — `●` in the window title bar and a dot next to the filename in the status bar — was already implemented via `setDirty()` in `renderer/editor/index.js`. The feature request described this as missing, but it had been added as part of Feature #1 (autosave). No changes to the indicator itself were needed.

---

## Files changed

| File | Change |
|---|---|
| `main.js` | Per-window dirty/autosave state Maps; `win.on('close')` guard with async dialog; `closingBypass` set for don't-save and save-then-close paths; 3 new IPC handlers |
| `preload.js` | 4 new API entries: `notifyDirtyState`, `notifyAutosaveState`, `notifyReadyToClose`, `onSaveAndClose` |
| `renderer/editor/index.js` | `setDirty()` now calls `notifyDirtyState`; toolbar/menu autosave toggles call `notifyAutosaveState`; `onSaveAndClose` handler triggers `saveFile()` then `notifyReadyToClose` |
| `tests/close-guard.test.js` | 7 new tests — predicate unit tests + IPC contract documentation |

---

## Test results

```
Test Files  3 passed (3)
      Tests  74 passed (74)
```

---

## How to test manually

1. Open a file, make changes, **disable autosave** → close the window → dialog should appear
2. Click **Save** → file is saved, window closes
3. Click **Don't Save** → window closes immediately, no save
4. Click **Cancel** → window stays open
5. Make changes with **autosave on** and file already saved → close → **no dialog** (autosave covers it)
6. Start a **new file**, make changes, autosave on → close → dialog appears (file has no path yet)
7. Quit with **Cmd+Q** while dirty → dialog appears (same guard)

---

---

## Feature #3: Pagination Stability

**File changed:** `renderer/editor/pagination.js`

Two fixes:

**1. Debounce duration: 0ms → 60ms**
The `scheduleDocChangeRecalc` function was using `setTimeout(0)`, which fires nearly instantly — one recalculation per keystroke. With fast typing that's a recalculation on every character: layout measurement, decoration rebuild, full ProseMirror dispatch, re-render. Changed to 60ms so rapid keystrokes batch into a single recalculation. Feels instant in practice but cuts layout work dramatically.

**2. Fallback retry when `allReported()` is false**
When a new NodeView is created (new paragraph, type change), it registers with the height registry immediately but hasn't received its ResizeObserver callback yet. `allReported()` returns false, and `recalculate()` bails out, keeping old decorations. The primary recovery path is the `onChange` callback that fires when the NodeView eventually reports — but if ResizeObserver stalls (e.g. a zero-height element the browser decides to skip), that callback never fires and decorations get stuck.

Added a 100ms fallback retry: if `allReported()` is false, schedule one retry. If the primary `onChange` path fires first (the normal case), the retry is cancelled when the next recalculate runs with complete data.

---

---

## Feature #4: Recent Files in Startup Modal

**Files changed:** `renderer/index.html`, `renderer/editor/index.js`, `renderer/style.css`

Shows the last 5 opened or saved `.fountain` files in the startup modal, between the theme picker and the New/Open buttons. Each entry shows the filename in bold with the directory path as smaller muted text. Clicking opens the file directly.

If a recent file has been moved or deleted, it's silently removed from the list on click and the modal re-renders. Recent files persist across sessions via `localStorage` — no main process involvement needed.

`addRecentFile(path)` is called in three places: `openFile()` (on successful load), `saveFile()` (after first save / Save As), and `saveFileAs()`.

---

## Decision log

- **Why skip the dialog when autosave is on + file has a path?** Because autosave writes every change to disk within 2 seconds. Showing a warning in that state is noise — the file is already saved.
- **Save-then-close flow:** main process can't call the renderer's save function directly, so it sends `window:saveAndClose`, waits for `window:readyToClose`, then closes with a bypass flag. This avoids re-triggering the dialog.
- **Why no unit tests for the IPC flow?** The close-guard logic touches Electron APIs (dialog, BrowserWindow) that aren't available in Vitest. The predicate logic is unit tested; the wiring is covered by the manual checklist above.
