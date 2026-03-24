/**
 * find-replace.js — Find & Replace for ProseMirror
 *
 * Exports:
 *   createFindReplacePlugin(callbacks) — ProseMirror Plugin that manages match decorations
 *   openFindBar(replaceMode?)          — Show the bar (called from keymap / menu)
 *   closeFindBar()                     — Hide the bar and clear decorations
 */

import { Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

export const findReplaceKey = new PluginKey('findReplace');

// ─── Match finding ──────────────────────────────────────────────────────────

/**
 * Walk the doc and collect all text ranges that match `query`.
 * Returns an array of { from, to } absolute positions.
 */
function findMatches(doc, query) {
  if (!query) return [];
  const results = [];
  const lowerQuery = query.toLowerCase();
  const queryLen = query.length;

  doc.descendants((node, pos) => {
    if (!node.isText) return;
    const text = node.text.toLowerCase();
    let idx = 0;
    while ((idx = text.indexOf(lowerQuery, idx)) !== -1) {
      results.push({ from: pos + idx, to: pos + idx + queryLen });
      idx += queryLen;
    }
  });

  return results;
}

// ─── Plugin ─────────────────────────────────────────────────────────────────

/**
 * @param {{ onMatchCount: (current: number, total: number) => void }} callbacks
 */
export function createFindReplacePlugin(callbacks = {}) {
  return new Plugin({
    key: findReplaceKey,

    state: {
      init() {
        return { query: '', matches: [], activeIndex: 0, decos: DecorationSet.empty };
      },

      apply(tr, prev) {
        const meta = tr.getMeta(findReplaceKey);
        let { query, matches, activeIndex } = prev;

        if (meta) {
          if (meta.query !== undefined) query = meta.query;
          if (meta.activeIndex !== undefined) activeIndex = meta.activeIndex;
        }

        // Recompute matches when doc changes or query changes
        if (tr.docChanged || (meta && meta.query !== undefined)) {
          matches = findMatches(tr.doc, query);
          // Clamp activeIndex to valid range
          if (matches.length === 0) activeIndex = 0;
          else activeIndex = Math.max(0, Math.min(activeIndex, matches.length - 1));
        }

        // Build decoration set
        let decos = DecorationSet.empty;
        if (matches.length > 0) {
          const decorations = matches.map((m, i) =>
            Decoration.inline(m.from, m.to, {
              class: i === activeIndex ? 'find-match find-match-active' : 'find-match',
            })
          );
          decos = DecorationSet.create(tr.doc, decorations);
        }

        // Fire count callback
        if (callbacks.onMatchCount) {
          callbacks.onMatchCount(
            matches.length > 0 ? activeIndex + 1 : 0,
            matches.length
          );
        }

        return { query, matches, activeIndex, decos };
      },
    },

    props: {
      decorations(state) {
        return this.getState(state).decos;
      },
    },
  });
}

// ─── Bar UI controller ──────────────────────────────────────────────────────

let _view = null; // set by setFindView()

export function setFindView(view) {
  _view = view;
}

function dispatch(meta) {
  if (!_view) return;
  _view.dispatch(_view.state.tr.setMeta(findReplaceKey, meta));
}

function getState() {
  if (!_view) return { query: '', matches: [], activeIndex: 0 };
  return findReplaceKey.getState(_view.state);
}

// ── Bar DOM elements (populated by initFindBar) ──────────────────────────

let findBar, findInput, findCount, replaceRow, replaceInput;

export function initFindBar() {
  findBar      = document.getElementById('find-bar');
  findInput    = document.getElementById('find-input');
  findCount    = document.getElementById('find-count');
  replaceRow   = document.getElementById('replace-row');
  replaceInput = document.getElementById('replace-input');

  // Live search as user types
  findInput.addEventListener('input', () => {
    dispatch({ query: findInput.value, activeIndex: 0 });
  });

  // Enter / Shift+Enter to navigate
  findInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.shiftKey ? findPrev() : findNext();
    } else if (e.key === 'Escape') {
      closeFindBar();
    }
  });

  replaceInput.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeFindBar();
  });

  document.getElementById('find-prev').addEventListener('click', findPrev);
  document.getElementById('find-next').addEventListener('click', findNext);
  document.getElementById('find-close').addEventListener('click', closeFindBar);
  document.getElementById('find-toggle-replace').addEventListener('click', toggleReplaceRow);
  document.getElementById('replace-one').addEventListener('click', replaceOne);
  document.getElementById('replace-all').addEventListener('click', replaceAll);
}

export function updateFindCount(current, total) {
  if (!findCount) return;
  findCount.textContent = total === 0 ? 'No results' : `${current}/${total}`;
}

// ── Public API ────────────────────────────────────────────────────────────

export function openFindBar(replaceMode = false) {
  if (!findBar) return;
  findBar.style.display = 'flex';
  if (replaceMode) replaceRow.style.display = 'flex';
  findInput.focus();
  findInput.select();
  // Re-run search with current query so highlights appear immediately
  dispatch({ query: findInput.value, activeIndex: 0 });
}

export function closeFindBar() {
  if (!findBar) return;
  findBar.style.display = 'none';
  replaceRow.style.display = 'none';
  // Clear all decorations
  dispatch({ query: '', activeIndex: 0 });
  if (_view) _view.focus();
}

export function findNext() {
  navigateTo(1);
}

export function findPrev() {
  navigateTo(-1);
}

function navigateTo(delta) {
  if (!_view) return;
  const { matches, activeIndex } = findReplaceKey.getState(_view.state);
  if (matches.length === 0) return;
  const next = (activeIndex + delta + matches.length) % matches.length;
  goToMatch(next, matches);
}

function goToMatch(index, matches) {
  if (!_view) return;
  const match = matches[index];
  if (!match) return;

  // Step 1: update activeIndex (re-renders decorations)
  const tr = _view.state.tr;
  tr.setMeta(findReplaceKey, { activeIndex: index });
  _view.dispatch(tr);

  // Step 2: scroll the editor pane to the match after the DOM has updated.
  // We use coordsAtPos on the updated state and scroll #editor-pane directly —
  // PM's built-in scrollIntoView targets the wrong ancestor in this layout.
  requestAnimationFrame(() => {
    if (!_view) return;
    try {
      const coords = _view.coordsAtPos(match.from);
      const pane = document.getElementById('editor-pane');
      if (!pane) return;
      const paneRect = pane.getBoundingClientRect();
      // Center the match vertically in the pane
      const matchMidY = (coords.top + coords.bottom) / 2;
      const offset = matchMidY - paneRect.top - paneRect.height / 2;
      pane.scrollBy({ top: offset, behavior: 'smooth' });
    } catch {}
  });
}

function toggleReplaceRow() {
  if (!replaceRow) return;
  const visible = replaceRow.style.display !== 'none';
  replaceRow.style.display = visible ? 'none' : 'flex';
  if (!visible) replaceInput.focus();
}

function replaceOne() {
  if (!_view) return;
  const { matches, activeIndex, query } = findReplaceKey.getState(_view.state);
  if (matches.length === 0) return;
  const match = matches[activeIndex];
  const replacement = replaceInput.value;
  const tr = _view.state.tr.insertText(replacement, match.from, match.to);
  tr.setMeta(findReplaceKey, { query, activeIndex });
  _view.dispatch(tr);
  // Advance after the doc settles
  setTimeout(() => navigateTo(0), 0);
}

function replaceAll() {
  if (!_view) return;
  const { matches, query } = getState();
  if (matches.length === 0) return;
  const replacement = replaceInput.value;
  // Replace from end to start so positions stay valid
  let tr = _view.state.tr;
  for (let i = matches.length - 1; i >= 0; i--) {
    tr = tr.insertText(replacement, matches[i].from, matches[i].to);
  }
  tr.setMeta(findReplaceKey, { query, activeIndex: 0 });
  _view.dispatch(tr);
}
