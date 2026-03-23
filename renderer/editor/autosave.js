/**
 * autosave.js — Autosave controller for OpenScreenwriter
 *
 * Saves 2 seconds after the last content change (debounced). Call
 * notifyChange() from the editor's dispatchTransaction/input handler to
 * trigger the debounce. Only writes if the content has actually changed
 * since the last autosave write.
 *
 * Behaviour by document state:
 *   Named document (file path known):
 *     Writes directly to the real .fountain file on disk. No recovery file is
 *     created — if the app crashes, the user just reopens the file from disk.
 *
 *   Untitled document (no file path yet):
 *     Writes to a recovery file in userData/autosave/ so content can be
 *     offered for recovery on next launch. Recovery file is deleted on a clean
 *     manual save or normal app quit.
 *
 * The autosave toggle is persisted in localStorage under the key
 * "autosaveEnabled". Defaults to true.
 */

const AUTOSAVE_DEBOUNCE_MS   = 2_000;
const INDICATOR_SAVING_MS    = 700;   // minimum time the spinner shows before "Autosaved"
const INDICATOR_VISIBLE_MS   = 2_000; // how long "Autosaved" lingers before fading
const STORAGE_KEY = 'autosaveEnabled';

/**
 * Create and start the autosave controller.
 *
 * @param {object} opts
 * @param {() => string}        opts.getContent      - Returns current fountain text
 * @param {() => string|null}   opts.getFilePath     - Returns current file path (or null)
 * @param {HTMLElement}         opts.indicatorEl     - The #status-autosave span element
 * @returns {{ stop, notifyChange, onManualSave, onFilePathChange, checkRecovery, cleanQuit, setEnabled, isEnabled }}
 */
export function createAutosaveController({ getContent, getFilePath, indicatorEl }) {
  let lastSavedContent = null;   // content at last autosave write
  let debounceTimer    = null;
  let indicatorTimer   = null;

  // ----------------------------------------------------------------
  // Enabled state — persisted in localStorage
  // ----------------------------------------------------------------

  function isEnabled() {
    const stored = localStorage.getItem(STORAGE_KEY);
    // Default to true if not set
    return stored === null ? true : stored === 'true';
  }

  function setEnabled(enabled) {
    localStorage.setItem(STORAGE_KEY, String(enabled));
    if (!enabled) {
      // Cancel any pending debounce and reset change tracker
      if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
      lastSavedContent = null;
    }
  }

  // ----------------------------------------------------------------
  // Internal helpers
  // ----------------------------------------------------------------

  /**
   * Show the autosave indicator.
   * @param {'saving'|'saved'} phase
   */
  function showIndicator(phase) {
    if (!indicatorEl) return;
    if (indicatorTimer) { clearTimeout(indicatorTimer); indicatorTimer = null; }

    indicatorEl.classList.remove('autosaving', 'autosaved');

    if (phase === 'saving') {
      indicatorEl.textContent = 'Autosaving...';
      indicatorEl.classList.add('visible', 'autosaving');
      // No auto-hide during saving — will transition to 'saved' or be hidden on failure
    } else {
      indicatorEl.textContent = 'Autosaved';
      indicatorEl.classList.add('visible', 'autosaved');
      indicatorTimer = setTimeout(() => {
        indicatorEl.classList.remove('visible', 'autosaved');
      }, INDICATOR_VISIBLE_MS);
    }
  }

  function hideIndicator() {
    if (!indicatorEl) return;
    if (indicatorTimer) { clearTimeout(indicatorTimer); indicatorTimer = null; }
    indicatorEl.classList.remove('visible', 'autosaving', 'autosaved');
  }

  async function tryAutosave() {
    debounceTimer = null;
    if (!isEnabled()) return;

    const content  = getContent();
    const filePath = getFilePath();

    // Only write if content has changed since last autosave
    if (content === lastSavedContent) return;

    showIndicator('saving');

    // Run the write and the minimum spinner display time concurrently
    const minDelay = new Promise(r => setTimeout(r, INDICATOR_SAVING_MS));

    let ok = false;
    if (filePath) {
      // Named document — write directly to the real file
      ok = await window.screenwriterAPI.autosaveWriteRealFile({ content, filePath });
    } else {
      // Untitled document — write to the recovery location
      ok = await window.screenwriterAPI.autosaveWrite({ content, filePath: null });
    }

    // Wait for the minimum spinner time so the animation is always visible
    await minDelay;

    if (ok) {
      lastSavedContent = content;
      showIndicator('saved');
    } else {
      hideIndicator();
    }
  }

  // ----------------------------------------------------------------
  // Public API
  // ----------------------------------------------------------------

  /**
   * Call this on every editor content change. Resets the 2-second debounce
   * timer so that a save fires 2 seconds after the user stops typing.
   */
  function notifyChange() {
    if (!isEnabled()) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(tryAutosave, AUTOSAVE_DEBOUNCE_MS);
  }

  /** Cancel the debounce and indicator timers (e.g. on app teardown). */
  function stop() {
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
    if (indicatorTimer) { clearTimeout(indicatorTimer); indicatorTimer = null; }
  }

  /**
   * Call after a successful manual save.
   * For untitled→named transitions, deletes the untitled recovery file.
   * Resets the change tracker so the next debounce fires only if content changes.
   *
   * @param {string}      savedFilePath - The path just written to
   * @param {string|null} previousPath  - The file path before this save (null if untitled)
   */
  async function onManualSave(savedFilePath, previousPath) {
    // Cancel any pending debounce — the file is already saved manually
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }

    // Capture current content so the next notifyChange/debounce skips if nothing changed
    lastSavedContent = getContent();

    // If the document was untitled before this save, clean up the untitled recovery file
    if (!previousPath) {
      await window.screenwriterAPI.autosaveDelete({ filePath: null });
    }
  }

  /**
   * Call when the active file path changes (e.g. on open).
   * Resets the last-saved content so the next notifyChange writes fresh.
   */
  function onFilePathChange() {
    lastSavedContent = null;
  }

  /**
   * Check for a recovery file for an untitled document.
   * Only meaningful for untitled docs (filePath === null).
   * Named documents no longer use recovery files — they write to the real file.
   *
   * Returns the recovered content string if found and accepted, or null.
   *
   * @param {string|null} filePath  - Pass null for untitled; named files always return null
   * @returns {Promise<string|null>}
   */
  async function checkRecovery(filePath) {
    // Named files don't use recovery files in the new design
    if (filePath !== null) return null;

    const result = await window.screenwriterAPI.autosaveCheck({ filePath: null });
    if (!result.exists) return null;

    const confirmed = window.confirm(
      'A recovery file was found for an unsaved document.\n\n' +
      'This may contain unsaved changes from a previous session.\n\n' +
      'Do you want to restore it?'
    );

    if (confirmed) {
      const content = await window.screenwriterAPI.autosaveRead({ filePath: null });
      await window.screenwriterAPI.autosaveDelete({ filePath: null });
      lastSavedContent = content;
      return content;
    } else {
      // User declined — delete the stale autosave
      await window.screenwriterAPI.autosaveDelete({ filePath: null });
      return null;
    }
  }

  /**
   * Notify main process to clean up the untitled recovery file on clean quit.
   * Should be called from beforeunload. Named files don't need cleanup since
   * the last autosave IS the current file content.
   */
  function cleanQuit() {
    // Cancel any pending debounce — we're quitting
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
    // Only clean up untitled recovery files; named files are already correct on disk
    window.screenwriterAPI.autosaveCleanQuit({ filePath: null });
  }

  return { stop, notifyChange, onManualSave, onFilePathChange, checkRecovery, cleanQuit, setEnabled, isEnabled };
}
