/**
 * character-list.js — Character extraction and panel rendering
 *
 * extractCharacters(doc) — pure function; walks the ProseMirror doc and
 * returns per-character statistics. Used by the panel and by unit tests.
 *
 * updateCharacterList(container, doc, sortBy, view) — renders the list
 * into a DOM container.
 */

import { TextSelection } from 'prosemirror-state';

/**
 * Walk the doc and extract character statistics.
 *
 * Counting rules:
 * - sceneCount: number of distinct scenes (scene_heading regions) a character
 *   appears in. A character with no preceding scene_heading is counted in
 *   scene 0 (the pre-scene region).
 * - lineCount: number of dialogue nodes directly attributed to the character
 *   (parenthetical nodes between character and dialogue don't break attribution).
 *
 * @param {Node} doc - ProseMirror document node
 * @returns {{ name: string, sceneCount: number, lineCount: number, firstPos: number }[]}
 *   Sorted by first appearance in the document.
 */
export function extractCharacters(doc) {
  // Map: normalised name → { name, lineCount, firstPos, scenes: Set<number> }
  const chars = new Map();
  let currentSceneIdx = 0;    // incremented at each scene_heading
  let pendingCharacter = null; // name of the last character cue seen

  doc.forEach((node, offset) => {
    const type = node.type.name;

    if (type === 'scene_heading') {
      currentSceneIdx++;
      pendingCharacter = null;
      return;
    }

    if (type === 'character') {
      const name = node.textContent.trim().toUpperCase();
      if (!name) return;

      if (!chars.has(name)) {
        chars.set(name, { name, lineCount: 0, firstPos: offset, scenes: new Set() });
      }
      chars.get(name).scenes.add(currentSceneIdx);
      pendingCharacter = name;
      return;
    }

    if (type === 'dialogue' && pendingCharacter) {
      const entry = chars.get(pendingCharacter);
      if (entry) entry.lineCount++;
      // Keep pendingCharacter — multi-line dialogue keeps attribution
      return;
    }

    if (type === 'parenthetical' && pendingCharacter) {
      // Parenthetical between character cue and dialogue — preserve attribution
      return;
    }

    // Any other node type ends the current dialogue block
    pendingCharacter = null;
  });

  return Array.from(chars.values())
    .map(({ scenes, ...rest }) => ({ ...rest, sceneCount: scenes.size }))
    .sort((a, b) => a.firstPos - b.firstPos);
}

/**
 * Render character statistics into a DOM container.
 *
 * @param {HTMLElement} container - Element to render into (cleared on each call)
 * @param {Node} doc - ProseMirror document node
 * @param {'name'|'scenes'} sortBy - Sort order
 * @param {EditorView|null} view - ProseMirror view for click-to-jump (optional)
 */
export function updateCharacterList(container, doc, sortBy, view) {
  const characters = extractCharacters(doc);
  container.innerHTML = '';

  if (characters.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'scene-nav-empty';
    empty.textContent = 'No characters yet';
    container.appendChild(empty);
    return;
  }

  const sorted = [...characters];
  if (sortBy === 'name') {
    sorted.sort((a, b) => a.name.localeCompare(b.name));
  } else {
    // Sort by scene count descending, tie-break by name
    sorted.sort((a, b) => b.sceneCount - a.sceneCount || a.name.localeCompare(b.name));
  }

  for (const char of sorted) {
    const btn = document.createElement('button');
    btn.className = 'char-list-item';
    btn.title = `Jump to first appearance of ${char.name}`;

    btn.addEventListener('mousedown', e => e.preventDefault());
    btn.addEventListener('click', () => {
      if (!view) return;
      try {
        const pos = char.firstPos + 1;
        const tr = view.state.tr;
        tr.setSelection(TextSelection.near(tr.doc.resolve(pos)));
        tr.scrollIntoView();
        view.dispatch(tr);
        view.focus();
      } catch (_) {
        // Position may be stale if doc changed between renders
      }
    });

    const nameEl = document.createElement('span');
    nameEl.className = 'char-list-name';
    nameEl.textContent = char.name;

    const statsEl = document.createElement('span');
    statsEl.className = 'char-list-stats';
    const sceneLabel = char.sceneCount === 1 ? 'scene' : 'scenes';
    const lineLabel  = char.lineCount  === 1 ? 'line'  : 'lines';
    statsEl.textContent = `${char.sceneCount} ${sceneLabel} · ${char.lineCount} ${lineLabel}`;

    btn.appendChild(nameEl);
    btn.appendChild(statsEl);
    container.appendChild(btn);
  }
}
