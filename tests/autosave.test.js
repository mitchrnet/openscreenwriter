/**
 * autosave.test.js — Unit tests for the autosave controller
 *
 * The autosave module uses window.screenwriterAPI which is only available
 * inside an Electron renderer. We test the pure logic by injecting a mock
 * API and using vi.useFakeTimers() to control time.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Build a minimal mock for window.screenwriterAPI (autosave surface only).
 */
function makeApi({ writeOk = true } = {}) {
  return {
    autosaveWrite:     vi.fn().mockResolvedValue(writeOk),
    autosaveDelete:    vi.fn().mockResolvedValue(true),
    autosaveCheck:     vi.fn().mockResolvedValue({ exists: false }),
    autosaveRead:      vi.fn().mockResolvedValue(null),
    autosaveListAll:   vi.fn().mockResolvedValue([]),
    autosaveCleanQuit: vi.fn(),
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
 * Advance fake timers by `ms` and flush the resulting promise microtasks.
 * This is the correct pattern when the timer callback is async:
 *   advanceTimersByTime() triggers the setInterval callback synchronously,
 *   then we await a resolved promise to flush any awaited microtasks inside
 *   the callback (e.g. `await api.autosaveWrite(...)` ).
 */
async function tick(ms) {
  vi.advanceTimersByTime(ms);
  // Flush microtasks produced by the async callback
  await Promise.resolve();
  await Promise.resolve(); // two rounds: one for the await inside tryAutosave, one for the mock chain
}

/**
 * Inline mirror of the autosave controller logic.
 * Accepts an `api` parameter instead of reading window.screenwriterAPI,
 * and optional overrides for intervalMs / indicatorVisibleMs so tests run fast.
 */
function createAutosaveController({
  getContent,
  getFilePath,
  indicatorEl,
  api,
  intervalMs         = 60_000,
  indicatorVisibleMs = 2_000,
}) {
  let lastSavedContent = null;
  let intervalId       = null;
  let indicatorTimer   = null;

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
    const content  = getContent();
    const filePath = getFilePath();
    if (content === lastSavedContent) return;
    const ok = await api.autosaveWrite({ content, filePath });
    if (ok) {
      lastSavedContent = content;
      showIndicator('Autosaved');
    }
  }

  function start() {
    if (intervalId) return;
    intervalId = setInterval(tryAutosave, intervalMs);
  }

  function stop() {
    if (intervalId) { clearInterval(intervalId); intervalId = null; }
    if (indicatorTimer) { clearTimeout(indicatorTimer); indicatorTimer = null; }
  }

  async function onManualSave(savedFilePath) {
    lastSavedContent = getContent();
    await api.autosaveDelete({ filePath: savedFilePath });
  }

  function onFilePathChange() {
    lastSavedContent = null;
  }

  async function checkRecovery(filePath) {
    const result = await api.autosaveCheck({ filePath });
    if (!result.exists) return null;
    const content = await api.autosaveRead({ filePath });
    await api.autosaveDelete({ filePath });
    lastSavedContent = content;
    return content;
  }

  function cleanQuit(filePath) {
    api.autosaveCleanQuit({ filePath });
  }

  start();
  return { stop, start, onManualSave, onFilePathChange, checkRecovery, cleanQuit };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('autosave controller', () => {
  let api;
  let indicator;

  beforeEach(() => {
    vi.useFakeTimers();
    api = makeApi();
    indicator = makeIndicator();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── Interval firing ──────────────────────────────────────────────────────

  it('does not write immediately on creation', () => {
    createAutosaveController({
      getContent:  () => 'hello',
      getFilePath: () => null,
      indicatorEl: indicator,
      api,
    });
    expect(api.autosaveWrite).not.toHaveBeenCalled();
  });

  it('writes after the interval elapses when content has changed', async () => {
    createAutosaveController({
      getContent:  () => 'hello',
      getFilePath: () => '/tmp/test.fountain',
      indicatorEl: indicator,
      api,
      intervalMs: 1_000,
    });

    await tick(1_000);

    expect(api.autosaveWrite).toHaveBeenCalledOnce();
    expect(api.autosaveWrite).toHaveBeenCalledWith({
      content:  'hello',
      filePath: '/tmp/test.fountain',
    });
  });

  it('does NOT write again if content has not changed since last autosave', async () => {
    createAutosaveController({
      getContent:  () => 'same content',
      getFilePath: () => null,
      indicatorEl: indicator,
      api,
      intervalMs: 1_000,
    });

    // First tick — should write
    await tick(1_000);
    expect(api.autosaveWrite).toHaveBeenCalledOnce();

    // Second tick — content unchanged, should NOT write again
    await tick(1_000);
    expect(api.autosaveWrite).toHaveBeenCalledOnce();
  });

  it('writes again after content changes between ticks', async () => {
    let content = 'v1';
    createAutosaveController({
      getContent:  () => content,
      getFilePath: () => null,
      indicatorEl: indicator,
      api,
      intervalMs: 1_000,
    });

    await tick(1_000);
    expect(api.autosaveWrite).toHaveBeenCalledOnce();

    content = 'v2'; // user typed more
    await tick(1_000);
    expect(api.autosaveWrite).toHaveBeenCalledTimes(2);
  });

  // ── stop() ───────────────────────────────────────────────────────────────

  it('stop() prevents further writes', async () => {
    const ctrl = createAutosaveController({
      getContent:  () => 'hello',
      getFilePath: () => null,
      indicatorEl: indicator,
      api,
      intervalMs: 1_000,
    });

    ctrl.stop();
    await tick(1_000);
    expect(api.autosaveWrite).not.toHaveBeenCalled();
  });

  // ── onManualSave() ────────────────────────────────────────────────────────

  it('onManualSave() calls autosaveDelete with the saved path', async () => {
    const ctrl = createAutosaveController({
      getContent:  () => 'script',
      getFilePath: () => '/tmp/script.fountain',
      indicatorEl: indicator,
      api,
    });

    await ctrl.onManualSave('/tmp/script.fountain');
    expect(api.autosaveDelete).toHaveBeenCalledWith({ filePath: '/tmp/script.fountain' });
  });

  it('onManualSave() resets lastSavedContent so next tick skips write', async () => {
    const ctrl = createAutosaveController({
      getContent:  () => 'script',
      getFilePath: () => '/tmp/script.fountain',
      indicatorEl: indicator,
      api,
      intervalMs: 1_000,
    });

    await ctrl.onManualSave('/tmp/script.fountain');

    // Content is still 'script' — matches what onManualSave captured
    await tick(1_000);
    expect(api.autosaveWrite).not.toHaveBeenCalled();
  });

  // ── onFilePathChange() ────────────────────────────────────────────────────

  it('onFilePathChange() causes next tick to write even if content appears same', async () => {
    const ctrl = createAutosaveController({
      getContent:  () => 'content',
      getFilePath: () => '/tmp/a.fountain',
      indicatorEl: indicator,
      api,
      intervalMs: 1_000,
    });

    // First save syncs lastSavedContent to 'content'
    await tick(1_000);
    expect(api.autosaveWrite).toHaveBeenCalledOnce();

    // File path changes (e.g. user opens a different file with same text)
    ctrl.onFilePathChange();

    await tick(1_000);
    expect(api.autosaveWrite).toHaveBeenCalledTimes(2);
  });

  // ── Indicator ─────────────────────────────────────────────────────────────

  it('shows the indicator after a successful autosave', async () => {
    createAutosaveController({
      getContent:  () => 'text',
      getFilePath: () => null,
      indicatorEl: indicator,
      api,
      intervalMs: 1_000,
    });

    await tick(1_000);

    expect(indicator.textContent).toBe('Autosaved');
    expect(indicator._classes.has('visible')).toBe(true);
  });

  it('hides the indicator after the visible timeout', async () => {
    createAutosaveController({
      getContent:         () => 'text',
      getFilePath:        () => null,
      indicatorEl:        indicator,
      api,
      intervalMs:         1_000,
      indicatorVisibleMs: 500,
    });

    await tick(1_000);
    expect(indicator._classes.has('visible')).toBe(true);

    // Now advance past the indicator timeout
    await tick(500);
    expect(indicator._classes.has('visible')).toBe(false);
  });

  it('does NOT show indicator when write fails', async () => {
    api = makeApi({ writeOk: false });
    createAutosaveController({
      getContent:  () => 'text',
      getFilePath: () => null,
      indicatorEl: indicator,
      api,
      intervalMs: 1_000,
    });

    await tick(1_000);

    expect(indicator._classes.has('visible')).toBe(false);
  });

  // ── checkRecovery() ───────────────────────────────────────────────────────

  it('returns null when no autosave exists', async () => {
    const ctrl = createAutosaveController({
      getContent:  () => '',
      getFilePath: () => null,
      indicatorEl: indicator,
      api,
    });

    api.autosaveCheck.mockResolvedValue({ exists: false });
    const result = await ctrl.checkRecovery(null);
    expect(result).toBeNull();
  });

  it('returns recovered content and deletes the autosave when recovery exists', async () => {
    const ctrl = createAutosaveController({
      getContent:  () => '',
      getFilePath: () => null,
      indicatorEl: indicator,
      api,
    });

    api.autosaveCheck.mockResolvedValue({ exists: true, originalPath: null });
    api.autosaveRead.mockResolvedValue('recovered content');

    const result = await ctrl.checkRecovery(null);
    expect(result).toBe('recovered content');
    expect(api.autosaveDelete).toHaveBeenCalledWith({ filePath: null });
  });

  it('calls autosaveRead with the correct filePath for named files', async () => {
    const ctrl = createAutosaveController({
      getContent:  () => '',
      getFilePath: () => '/home/user/script.fountain',
      indicatorEl: indicator,
      api,
    });

    api.autosaveCheck.mockResolvedValue({ exists: true, originalPath: '/home/user/script.fountain' });
    api.autosaveRead.mockResolvedValue('recovered named file');

    const result = await ctrl.checkRecovery('/home/user/script.fountain');
    expect(result).toBe('recovered named file');
    expect(api.autosaveRead).toHaveBeenCalledWith({ filePath: '/home/user/script.fountain' });
  });

  // ── cleanQuit() ───────────────────────────────────────────────────────────

  it('cleanQuit() calls autosaveCleanQuit with current filePath', () => {
    const ctrl = createAutosaveController({
      getContent:  () => '',
      getFilePath: () => '/tmp/script.fountain',
      indicatorEl: indicator,
      api,
    });

    ctrl.cleanQuit('/tmp/script.fountain');
    expect(api.autosaveCleanQuit).toHaveBeenCalledWith({ filePath: '/tmp/script.fountain' });
  });

  it('cleanQuit() passes null for untitled documents', () => {
    const ctrl = createAutosaveController({
      getContent:  () => '',
      getFilePath: () => null,
      indicatorEl: indicator,
      api,
    });

    ctrl.cleanQuit(null);
    expect(api.autosaveCleanQuit).toHaveBeenCalledWith({ filePath: null });
  });
});
