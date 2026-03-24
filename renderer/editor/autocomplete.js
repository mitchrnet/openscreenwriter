/**
 * autocomplete.js — Character name autocomplete for ProseMirror
 *
 * When the cursor is in a `character` block with 1+ characters typed,
 * shows a filtered dropdown of previously used character names.
 * Tab or Enter accepts the top suggestion; Escape dismisses.
 */

import { Plugin, PluginKey, TextSelection } from 'prosemirror-state';

export const autocompleteKey = new PluginKey('autocomplete');

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Collect all unique character names from the doc, sorted alphabetically. */
function collectCharacterNames(doc) {
  const names = new Set();
  doc.forEach(node => {
    if (node.type.name === 'character') {
      const name = node.textContent.trim();
      if (name) names.add(name.toUpperCase());
    }
  });
  return [...names].sort();
}

/** Filter names that start with `prefix` (case-insensitive), excluding exact matches. */
function filterNames(names, prefix) {
  const upper = prefix.toUpperCase();
  return names.filter(n => n.startsWith(upper) && n !== upper);
}

// ─── Dropdown DOM ────────────────────────────────────────────────────────────

let dropdown = null;
let selectedIndex = 0;
let currentSuggestions = [];
let _view = null;

function createDropdown() {
  dropdown = document.createElement('div');
  dropdown.id = 'autocomplete-dropdown';
  dropdown.style.display = 'none';
  document.body.appendChild(dropdown);
}

function showDropdown(suggestions, cursorCoords) {
  if (!dropdown) createDropdown();
  currentSuggestions = suggestions;
  selectedIndex = 0;
  renderDropdown();

  // Position below cursor
  dropdown.style.display = 'block';
  const dropRect = dropdown.getBoundingClientRect();
  let left = cursorCoords.left;
  let top = cursorCoords.bottom + 2;

  // Keep within viewport
  if (left + dropRect.width > window.innerWidth - 8) {
    left = window.innerWidth - dropRect.width - 8;
  }
  if (top + dropRect.height > window.innerHeight - 8) {
    top = cursorCoords.top - dropRect.height - 2;
  }

  dropdown.style.left = `${left}px`;
  dropdown.style.top  = `${top}px`;
}

function renderDropdown() {
  if (!dropdown) return;
  dropdown.innerHTML = '';
  currentSuggestions.forEach((name, i) => {
    const item = document.createElement('div');
    item.className = 'autocomplete-item' + (i === selectedIndex ? ' active' : '');
    item.textContent = name;
    item.addEventListener('mousedown', e => {
      e.preventDefault(); // don't steal focus
      acceptCurrentSuggestion(_view, name);
    });
    dropdown.appendChild(item);
  });
}

function hideDropdown() {
  if (dropdown) dropdown.style.display = 'none';
  currentSuggestions = [];
  selectedIndex = 0;
}

function isDropdownVisible() {
  return dropdown && dropdown.style.display !== 'none' && currentSuggestions.length > 0;
}

function moveSelection(delta) {
  if (!isDropdownVisible()) return false;
  selectedIndex = (selectedIndex + delta + currentSuggestions.length) % currentSuggestions.length;
  renderDropdown();
  return true;
}

// ─── Plugin ─────────────────────────────────────────────────────────────────

export function createAutocompletePlugin() {
  return new Plugin({
    key: autocompleteKey,

    view(editorView) {
      _view = editorView;
      return {
        update(view, prevState) {
          const state = view.state;
          const { $from } = state.selection;

          // Only in character blocks
          if ($from.parent.type.name !== 'character') {
            hideDropdown();
            return;
          }

          const text = $from.parent.textContent.trim();
          if (!text) {
            hideDropdown();
            return;
          }

          const allNames = collectCharacterNames(state.doc);
          const suggestions = filterNames(allNames, text);

          if (suggestions.length === 0) {
            hideDropdown();
            return;
          }

          // Position the dropdown at the cursor
          const coords = view.coordsAtPos($from.pos);
          showDropdown(suggestions, coords);
        },
        destroy() {
          hideDropdown();
          if (dropdown) dropdown.remove();
          dropdown = null;
          _view = null;
        },
      };
    },

    props: {
      handleKeyDown(view, event) {
        if (!isDropdownVisible()) return false;

        if (event.key === 'ArrowDown') {
          event.preventDefault();
          moveSelection(1);
          return true;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          moveSelection(-1);
          return true;
        }
        if (event.key === 'Escape') {
          hideDropdown();
          return true;
        }
        if (event.key === 'Tab' || event.key === 'Enter') {
          const suggestion = currentSuggestions[selectedIndex];
          if (suggestion) {
            event.preventDefault();
            acceptCurrentSuggestion(view, suggestion);
            return true;
          }
        }
        return false;
      },
    },
  });
}

/**
 * Replace the current character block's text with the accepted suggestion.
 */
function acceptCurrentSuggestion(view, suggestion) {
  const { $from } = view.state.selection;
  if ($from.parent.type.name !== 'character') return;

  // Replace entire content of the character node
  const nodeStart = $from.before($from.depth); // position before the node
  const nodeEnd   = $from.after($from.depth);  // position after the node
  const innerStart = nodeStart + 1;
  const innerEnd   = nodeEnd   - 1;

  const tr = view.state.tr;
  tr.insertText(suggestion, innerStart, innerEnd);
  // Move cursor to end of the inserted text
  tr.setSelection(
    TextSelection.near(tr.doc.resolve(innerStart + suggestion.length))
  );
  view.dispatch(tr);
  hideDropdown();
}
