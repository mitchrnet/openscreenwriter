/**
 * autosave.js — Autosave controller for OpenScreenwriter
 *
 * Fires every 60 seconds. Only writes if the document content has changed
 * since the last autosave. Cleans up the recovery file on a clean manual
 * save or when the app quits normally. Shows a brief "Autosaved" notice in
 * the status bar.
 */

const AUTOSAVE_INTERVAL_MS = 60_000;
const INDICATOR_VISIBLE_MS = 2_000;

/**
 * Create and start the autosave controller.
 *
 * @param {object} opts
 * @param {() => string}        opts.getContent      - Returns current fountain text
 * @param {() => string|null}   opts.getFilePath     - Returns current file path (or null)
 * @param {HTMLElement}         opts.indicatorEl     - The #status-autosave span element
 * @returns {{ stop, onManualSave, onFilePathChange, checkRecovery }}
 */
export function createAutosaveController({ getContent, getFilePath, indicatorEl }) {
  let lastSavedContent = null;   // content at last autosave write
  let intervalId       = null;
  let indicatorTimer   = null;

  // ----------------------------------------------------------------
  // Internal helpers
  // ----------------------------------------------------------------

  function showIndicator(text = 'Autosaved') {
    if (!indicatorEl) return;
    indicatorEl.textContent = text;
    indicatorEl.classList.add('visible');
    if (indicatorTimer) clearTimeout(indicatorTimer);
    indicatorTimer = setTimeout(() => {
      indicatorEl.classList.remove('visible');
    }, INDICATOR_VISIBLE_MS);
  }

  async function tryAutosave() {
    const content  = getContent();
    const filePath = getFilePath();

    // Only write if content has changed since last autosave
    if (content === lastSavedContent) return;

    const ok = await window.screenwriterAPI.autosaveWrite({ content, filePath });
    if (ok) {
      lastSavedContent = content;
      showIndicator('Autosaved');
    }
  }

  // ----------------------------------------------------------------
  // Public API
  // ----------------------------------------------------------------

  /** Start the periodic autosave timer. */
  function start() {
    if (intervalId) return;
    intervalId = setInterval(tryAutosave, AUTOSAVE_INTERVAL_MS);
  }

  /** Stop the autosave timer (e.g. on app teardown). */
  function stop() {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
    if (indicatorTimer) {
      clearTimeout(indicatorTimer);
      indicatorTimer = null;
    }
  }

  /**
   * Call after a successful manual save.
   * Deletes the autosave recovery file and resets the change tracker.
   */
  async function onManualSave(savedFilePath) {
    lastSavedContent = getContent();
    await window.screenwriterAPI.autosaveDelete({ filePath: savedFilePath });
    // Also clean up any old untitled autosave when saving for the first time
    if (!savedFilePath) {
      await window.screenwriterAPI.autosaveDelete({ filePath: null });
    }
  }

  /**
   * Call when the active file path changes (e.g. on open or Save As).
   * Resets the last-saved content so the next tick compares fresh.
   */
  function onFilePathChange() {
    lastSavedContent = null;
  }

  /**
   * Check for a recovery file for the given path (or untitled if null).
   * Returns the recovered content string if found and accepted, or null.
   *
   * @param {string|null} filePath  - The path of the file just opened (null = untitled)
   * @returns {Promise<string|null>}
   */
  async function checkRecovery(filePath) {
    const result = await window.screenwriterAPI.autosaveCheck({ filePath });
    if (!result.exists) return null;

    // Build a friendly label for the dialog
    const name = filePath
      ? filePath.split(/[\\/]/).pop()
      : 'untitled.fountain';

    const confirmed = window.confirm(
      `A recovery file was found for "${name}".\n\nThis may contain unsaved changes from a previous session.\n\nDo you want to restore it?`
    );

    if (confirmed) {
      const content = await window.screenwriterAPI.autosaveRead({ filePath });
      // Remove the autosave so we don't prompt again next time
      await window.screenwriterAPI.autosaveDelete({ filePath });
      lastSavedContent = content;
      return content;
    } else {
      // User declined — delete the stale autosave
      await window.screenwriterAPI.autosaveDelete({ filePath });
      return null;
    }
  }

  /**
   * Notify main process to clean up autosave on clean quit.
   * Should be called from beforeunload.
   */
  function cleanQuit(filePath) {
    window.screenwriterAPI.autosaveCleanQuit({ filePath });
  }

  start();

  return { stop, start, onManualSave, onFilePathChange, checkRecovery, cleanQuit };
}
