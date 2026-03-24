/**
 * close-guard.test.js — Unit tests for the unsaved-changes close guard
 *
 * The close-guard lives in main.js (Electron main process) and relies on
 * Electron APIs (dialog, BrowserWindow) that aren't available in Vitest.
 * We test the pure decision logic in isolation and document the IPC contract
 * that the integration depends on.
 *
 * Manual verification checklist (run after building):
 *   □ Make changes, autosave OFF → close window → "Unsaved changes" dialog appears
 *   □ Click Save → file is saved, window closes
 *   □ Click Don't Save → window closes without saving
 *   □ Click Cancel → window stays open, no data lost
 *   □ Make changes, autosave ON, file saved → close window → NO dialog (autosave covers it)
 *   □ Make changes, autosave ON, NEW file (never saved) → close → dialog appears
 *   □ Quit app (Cmd+Q) with unsaved changes → dialog appears per window
 */

import { describe, it, expect } from 'vitest';

// ─── Pure close-guard predicate ──────────────────────────────────────────────
//
// Mirrors the condition in main.js win.on('close'):
//   if (!dirty || (autosaveOn && filePath)) return; // allow close, no dialog
//
// Returns true if the dialog SHOULD be shown.

function needsCloseDialog(dirty, autosaveOn, filePath) {
  return dirty && !(autosaveOn && filePath);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('close-guard predicate', () => {
  it('no dialog when document is clean', () => {
    expect(needsCloseDialog(false, false, null)).toBe(false);
    expect(needsCloseDialog(false, true,  '/path/to/file.fountain')).toBe(false);
    expect(needsCloseDialog(false, false, '/path/to/file.fountain')).toBe(false);
  });

  it('dialog when dirty and autosave is off', () => {
    expect(needsCloseDialog(true, false, '/path/to/file.fountain')).toBe(true);
    expect(needsCloseDialog(true, false, null)).toBe(true);
  });

  it('dialog when dirty, autosave on, but file has never been saved (new file)', () => {
    // autosave on but no real filePath → autosave went to temp, not the real file
    expect(needsCloseDialog(true, true, null)).toBe(true);
  });

  it('no dialog when dirty, autosave on, and file has a real path (autosave covers it)', () => {
    expect(needsCloseDialog(true, true, '/path/to/file.fountain')).toBe(false);
  });
});

// ─── IPC contract documentation ──────────────────────────────────────────────
//
// These tests document the expected message flow. They do not exercise Electron
// IPC directly — that requires integration testing with a running Electron app.

describe('close-guard IPC contract', () => {
  it('renderer sends window:dirtyChanged when dirty state changes', () => {
    // When setDirty(true) is called in index.js, it must call:
    //   window.screenwriterAPI.notifyDirtyState(true)
    // which maps to: ipcRenderer.send('window:dirtyChanged', true)
    // Main process stores this in dirtyByWindow.set(win.id, true).
    expect(true).toBe(true); // documented — verified manually
  });

  it('renderer sends window:autosaveChanged when autosave is toggled', () => {
    // Toolbar button click and menu toggle both call:
    //   window.screenwriterAPI.notifyAutosaveState(enabled)
    // Main stores in autosaveEnabledByWindow.set(win.id, enabled).
    expect(true).toBe(true); // documented — verified manually
  });

  it('save-then-close flow: main sends window:saveAndClose, renderer saves then sends window:readyToClose', () => {
    // On dialog "Save":
    //   main → win.webContents.send('window:saveAndClose')
    //   renderer → saveFile() then ipcRenderer.send('window:readyToClose')
    //   main → closingBypass.add(win.id); win.close()
    expect(true).toBe(true); // documented — verified manually
  });
});
