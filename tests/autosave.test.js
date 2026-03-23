/**
 * autosave.test.js — Unit tests for the autosave controller
 *
 * The autosave module uses window.screenwriterAPI which is only available
 * inside an Electron renderer. We test the pure logic by injecting a mock
 * API and using vi.useFakeTimers() to control time.
 *
 * Trigger model: call notifyChange() to start the 2-second debounce.
 * The save fires 2 seconds after the LAST notifyChange() call.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Build a minimal mock for window.screenwriterAPI (autosave surface only).
 */
function makeApi({ writeOk = true } = {}) {
  return {
    autosaveWriteRealFile: vi.fn().mockResolvedValue(writeOk),
    autosaveWrite:         vi.fn().mockResolvedValue(writeOk),
    autosaveDelete:        vi.fn().mockResolvedValue(true),
    autosaveCheck:         vi.fn().mockResolvedValue({ exists: false }),
    autosaveRead:          vi.fn().mockResolvedValue(null),
    autosaveCleanQuit:     vi.fn(),
  };
}

/**
 * Build a minimal mock indicator element with classList tracking.
 */
function makeIndicator() {
  const classes = new Set();
  return {
    textContent: '',
    classList: {
      add:    (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      has:    (c) => classes.has(c),
    },
    _classes: classes,
  };
}

/**
 * Build a minimal mock for localStorage.
 */
function makeStorage() {
  const store = {};
  return {
    getItem:    (k) => (k in store ? store[k] : null),
    setItem:    (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    _store:     store,
  };
}

/**
 * Advance fake timers by `ms` and flush the resulting promise microtasks.
 */
async function tick(ms) {
  vi.advanceTimersByTime(ms);
  await Promise.resolve();
  await Promise.resolve();
}

/**
 * Inline mirror of the autosave controller logic (debounce model).
 * Accepts injected `api` and `storage` instead of global singletons,
 * and an optional `debounceMs` override so tests run fast.
 */
function createAutosaveController({
  getContent,
  getFilePath,
  indicatorEl,
  api,
  storage,
  debounceMs         = 2_000,
  indicatorVisibleMs = 2_000,
}) {
  const STORAGE_KEY = 'autosaveEnabled';
  let lastSavedContent = null;
  let debounceTimer    = null;
  let indicatorTimer   = null;

  function isEnabled() {
    const stored = storage.getItem(STORAGE_KEY);
    return stored === null ? true : stored === 'true';
  }

  function setEnabled(enabled) {
    storage.setItem(STORAGE_KEY, String(enabled));
    if (!enabled) {
      if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
      lastSavedContent = null;
    }
  }

  function showIndicator(text = 'Autosaved') {
    if (!indicatorEl) return;
    indicatorEl.textContent = text;
    indicatorEl.classList.add('visible');
    if (indicatorTimer) clearTimeout(indicatorTimer);
    indicatorTimer = setTimeout(() => {
      indicatorEl.classList.remove('visible');
    }, indicatorVisibleMs);
  }

  async function tryAutosave() {
    debounceTimer = null;
    if (!isEnabled()) return;
    const content  = getContent();
    const filePath = getFilePath();
    if (content === lastSavedContent) return;

    let ok = false;
    if (filePath) {
      ok = await api.autosaveWriteRealFile({ content, filePath });
    } else {
      ok = await api.autosaveWrite({ content, filePath: null });
    }

    if (ok) {
      lastSavedContent = content;
      showIndicator('Autosaved');
    }
  }

  function notifyChange() {
    if (!isEnabled()) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(tryAutosave, debounceMs);
  }

  function stop() {
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
    if (indicatorTimer) { clearTimeout(indicatorTimer); indicatorTimer = null; }
  }

  async function onManualSave(savedFilePath, previousPath) {
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
    lastSavedContent = getContent();
    if (!previousPath) {
      await api.autosaveDelete({ filePath: null });
    }
  }

  function onFilePathChange() {
    lastSavedContent = null;
  }

  async function checkRecovery(filePath) {
    if (filePath !== null) return null;
    const result = await api.autosaveCheck({ filePath: null });
    if (!result.exists) return null;
    const content = await api.autosaveRead({ filePath: null });
    await api.autosaveDelete({ filePath: null });
    lastSavedContent = content;
    return content;
  }

  function cleanQuit() {
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
    api.autosaveCleanQuit({ filePath: null });
  }

  return { stop, notifyChange, onManualSave, onFilePathChange, checkRecovery, cleanQuit, setEnabled, isEnabled };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('autosave controller', () => {
  let api;
  let indicator;
  let storage;

  beforeEach(() => {
    vi.useFakeTimers();
    api = makeApi();
    indicator = makeIndicator();
    storage = makeStorage();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── Debounce firing ───────────────────────────────────────────────────────

  it('does not write immediately on creation (no notifyChange called)', () => {
    createAutosaveController({
      getContent:  () => 'hello',
      getFilePath: () => null,
      indicatorEl: indicator,
      api, storage,
    });
    expect(api.autosaveWrite).not.toHaveBeenCalled();
    expect(api.autosaveWriteRealFile).not.toHaveBeenCalled();
  });

  it('does not write before the debounce delay elapses', async () => {
    const ctrl = createAutosaveController({
      getContent:  () => 'hello',
      getFilePath: () => null,
      indicatorEl: indicator,
      api, storage, debounceMs: 1_000,
    });
    ctrl.notifyChange();
    await tick(999);
    expect(api.autosaveWrite).not.toHaveBeenCalled();
  });

  it('writes to real file after debounce when document has a path', async () => {
    const ctrl = createAutosaveController({
      getContent:  () => 'hello',
      getFilePath: () => '/tmp/test.fountain',
      indicatorEl: indicator,
      api, storage, debounceMs: 1_000,
    });

    ctrl.notifyChange();
    await tick(1_000);

    expect(api.autosaveWriteRealFile).toHaveBeenCalledOnce();
    expect(api.autosaveWriteRealFile).toHaveBeenCalledWith({
      content:  'hello',
      filePath: '/tmp/test.fountain',
    });
    expect(api.autosaveWrite).not.toHaveBeenCalled();
  });

  it('writes to recovery file when document is untitled (no path)', async () => {
    const ctrl = createAutosaveController({
      getContent:  () => 'hello',
      getFilePath: () => null,
      indicatorEl: indicator,
      api, storage, debounceMs: 1_000,
    });

    ctrl.notifyChange();
    await tick(1_000);

    expect(api.autosaveWrite).toHaveBeenCalledOnce();
    expect(api.autosaveWrite).toHaveBeenCalledWith({ content: 'hello', filePath: null });
    expect(api.autosaveWriteRealFile).not.toHaveBeenCalled();
  });

  it('debounce resets on repeated notifyChange calls — only one write fires', async () => {
    const ctrl = createAutosaveController({
      getContent:  () => 'same content',
      getFilePath: () => null,
      indicatorEl: indicator,
      api, storage, debounceMs: 1_000,
    });

    ctrl.notifyChange();
    await tick(500);
    ctrl.notifyChange();  // resets the timer
    await tick(500);      // only 500ms since last notifyChange — should not fire yet
    expect(api.autosaveWrite).not.toHaveBeenCalled();

    await tick(500);      // now 1000ms since last notifyChange — fires
    expect(api.autosaveWrite).toHaveBeenCalledOnce();
  });

  it('does NOT write again if content has not changed since last autosave', async () => {
    const ctrl = createAutosaveController({
      getContent:  () => 'same content',
      getFilePath: () => null,
      indicatorEl: indicator,
      api, storage, debounceMs: 1_000,
    });

    ctrl.notifyChange();
    await tick(1_000);
    expect(api.autosaveWrite).toHaveBeenCalledOnce();

    ctrl.notifyChange();
    await tick(1_000);
    expect(api.autosaveWrite).toHaveBeenCalledOnce(); // still just once
  });

  it('writes again after content changes', async () => {
    let content = 'v1';
    const ctrl = createAutosaveController({
      getContent:  () => content,
      getFilePath: () => null,
      indicatorEl: indicator,
      api, storage, debounceMs: 1_000,
    });

    ctrl.notifyChange();
    await tick(1_000);
    expect(api.autosaveWrite).toHaveBeenCalledOnce();

    content = 'v2';
    ctrl.notifyChange();
    await tick(1_000);
    expect(api.autosaveWrite).toHaveBeenCalledTimes(2);
  });

  // ── stop() ───────────────────────────────────────────────────────────────

  it('stop() cancels the pending debounce', async () => {
    const ctrl = createAutosaveController({
      getContent:  () => 'hello',
      getFilePath: () => null,
      indicatorEl: indicator,
      api, storage, debounceMs: 1_000,
    });

    ctrl.notifyChange();
    ctrl.stop();
    await tick(1_000);
    expect(api.autosaveWrite).not.toHaveBeenCalled();
    expect(api.autosaveWriteRealFile).not.toHaveBeenCalled();
  });

  // ── setEnabled / isEnabled ────────────────────────────────────────────────

  it('isEnabled() returns true by default', () => {
    const ctrl = createAutosaveController({
      getContent:  () => '',
      getFilePath: () => null,
      indicatorEl: indicator,
      api, storage,
    });
    expect(ctrl.isEnabled()).toBe(true);
  });

  it('setEnabled(false) cancels pending debounce and prevents writes', async () => {
    const ctrl = createAutosaveController({
      getContent:  () => 'hello',
      getFilePath: () => null,
      indicatorEl: indicator,
      api, storage, debounceMs: 1_000,
    });

    ctrl.notifyChange();
    ctrl.setEnabled(false);
    await tick(1_000);
    expect(api.autosaveWrite).not.toHaveBeenCalled();
    expect(api.autosaveWriteRealFile).not.toHaveBeenCalled();
  });

  it('notifyChange() is a no-op when disabled', async () => {
    const ctrl = createAutosaveController({
      getContent:  () => 'hello',
      getFilePath: () => null,
      indicatorEl: indicator,
      api, storage, debounceMs: 1_000,
    });

    ctrl.setEnabled(false);
    ctrl.notifyChange();
    await tick(1_000);
    expect(api.autosaveWrite).not.toHaveBeenCalled();
  });

  it('setEnabled(true) after false resumes on next notifyChange', async () => {
    const ctrl = createAutosaveController({
      getContent:  () => 'hello',
      getFilePath: () => null,
      indicatorEl: indicator,
      api, storage, debounceMs: 1_000,
    });

    ctrl.setEnabled(false);
    ctrl.notifyChange();
    await tick(1_000);
    expect(api.autosaveWrite).not.toHaveBeenCalled();

    ctrl.setEnabled(true);
    ctrl.notifyChange();
    await tick(1_000);
    expect(api.autosaveWrite).toHaveBeenCalledOnce();
  });

  it('setEnabled persists to storage', () => {
    const ctrl = createAutosaveController({
      getContent:  () => '',
      getFilePath: () => null,
      indicatorEl: indicator,
      api, storage,
    });

    ctrl.setEnabled(false);
    expect(storage.getItem('autosaveEnabled')).toBe('false');

    ctrl.setEnabled(true);
    expect(storage.getItem('autosaveEnabled')).toBe('true');
  });

  // ── onManualSave() ────────────────────────────────────────────────────────

  it('onManualSave() deletes untitled recovery when saving for the first time', async () => {
    const ctrl = createAutosaveController({
      getContent:  () => 'script',
      getFilePath: () => '/tmp/script.fountain',
      indicatorEl: indicator,
      api, storage,
    });

    // previousPath = null means the doc was untitled before this save
    await ctrl.onManualSave('/tmp/script.fountain', null);
    expect(api.autosaveDelete).toHaveBeenCalledWith({ filePath: null });
  });

  it('onManualSave() does NOT call autosaveDelete when re-saving a named file', async () => {
    const ctrl = createAutosaveController({
      getContent:  () => 'script',
      getFilePath: () => '/tmp/script.fountain',
      indicatorEl: indicator,
      api, storage,
    });

    // previousPath = '/tmp/script.fountain' means the doc already had a path
    await ctrl.onManualSave('/tmp/script.fountain', '/tmp/script.fountain');
    expect(api.autosaveDelete).not.toHaveBeenCalled();
  });

  it('onManualSave() cancels pending debounce and resets lastSavedContent', async () => {
    const ctrl = createAutosaveController({
      getContent:  () => 'script',
      getFilePath: () => '/tmp/script.fountain',
      indicatorEl: indicator,
      api, storage, debounceMs: 1_000,
    });

    ctrl.notifyChange();
    await ctrl.onManualSave('/tmp/script.fountain', '/tmp/script.fountain');

    // Advancing time should not trigger an additional write
    await tick(1_000);
    expect(api.autosaveWriteRealFile).not.toHaveBeenCalled();
  });

  // ── onFilePathChange() ────────────────────────────────────────────────────

  it('onFilePathChange() causes next notifyChange+debounce to write even if content appears same', async () => {
    const ctrl = createAutosaveController({
      getContent:  () => 'content',
      getFilePath: () => '/tmp/a.fountain',
      indicatorEl: indicator,
      api, storage, debounceMs: 1_000,
    });

    ctrl.notifyChange();
    await tick(1_000);
    expect(api.autosaveWriteRealFile).toHaveBeenCalledOnce();

    ctrl.onFilePathChange();
    ctrl.notifyChange();
    await tick(1_000);
    expect(api.autosaveWriteRealFile).toHaveBeenCalledTimes(2);
  });

  // ── Indicator ─────────────────────────────────────────────────────────────

  it('shows the indicator after a successful autosave', async () => {
    const ctrl = createAutosaveController({
      getContent:  () => 'text',
      getFilePath: () => null,
      indicatorEl: indicator,
      api, storage, debounceMs: 1_000,
    });

    ctrl.notifyChange();
    await tick(1_000);

    expect(indicator.textContent).toBe('Autosaved');
    expect(indicator._classes.has('visible')).toBe(true);
  });

  it('hides the indicator after the visible timeout', async () => {
    const ctrl = createAutosaveController({
      getContent:         () => 'text',
      getFilePath:        () => null,
      indicatorEl:        indicator,
      api, storage,
      debounceMs:         1_000,
      indicatorVisibleMs: 500,
    });

    ctrl.notifyChange();
    await tick(1_000);
    expect(indicator._classes.has('visible')).toBe(true);

    await tick(500);
    expect(indicator._classes.has('visible')).toBe(false);
  });

  it('does NOT show indicator when write fails', async () => {
    api = makeApi({ writeOk: false });
    const ctrl = createAutosaveController({
      getContent:  () => 'text',
      getFilePath: () => null,
      indicatorEl: indicator,
      api, storage, debounceMs: 1_000,
    });

    ctrl.notifyChange();
    await tick(1_000);

    expect(indicator._classes.has('visible')).toBe(false);
  });

  // ── checkRecovery() ───────────────────────────────────────────────────────

  it('returns null when no autosave exists for untitled', async () => {
    const ctrl = createAutosaveController({
      getContent:  () => '',
      getFilePath: () => null,
      indicatorEl: indicator,
      api, storage,
    });

    api.autosaveCheck.mockResolvedValue({ exists: false });
    const result = await ctrl.checkRecovery(null);
    expect(result).toBeNull();
  });

  it('returns recovered content and deletes autosave when untitled recovery exists', async () => {
    const ctrl = createAutosaveController({
      getContent:  () => '',
      getFilePath: () => null,
      indicatorEl: indicator,
      api, storage,
    });

    api.autosaveCheck.mockResolvedValue({ exists: true });
    api.autosaveRead.mockResolvedValue('recovered content');

    const result = await ctrl.checkRecovery(null);
    expect(result).toBe('recovered content');
    expect(api.autosaveDelete).toHaveBeenCalledWith({ filePath: null });
  });

  it('always returns null for named files (no recovery file used)', async () => {
    const ctrl = createAutosaveController({
      getContent:  () => '',
      getFilePath: () => '/home/user/script.fountain',
      indicatorEl: indicator,
      api, storage,
    });

    api.autosaveCheck.mockResolvedValue({ exists: true });
    api.autosaveRead.mockResolvedValue('should not be returned');

    const result = await ctrl.checkRecovery('/home/user/script.fountain');
    expect(result).toBeNull();
    expect(api.autosaveCheck).not.toHaveBeenCalled();
  });

  // ── cleanQuit() ───────────────────────────────────────────────────────────

  it('cleanQuit() cancels pending debounce and calls autosaveCleanQuit', async () => {
    const ctrl = createAutosaveController({
      getContent:  () => 'text',
      getFilePath: () => '/tmp/script.fountain',
      indicatorEl: indicator,
      api, storage, debounceMs: 1_000,
    });

    ctrl.notifyChange();
    ctrl.cleanQuit();

    await tick(1_000);
    // cleanQuit cancels the debounce, so no write should have occurred
    expect(api.autosaveWriteRealFile).not.toHaveBeenCalled();
    expect(api.autosaveCleanQuit).toHaveBeenCalledWith({ filePath: null });
  });
});
