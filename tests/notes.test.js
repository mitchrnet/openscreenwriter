/**
 * notes.test.js — Unit tests for the notes ProseMirror plugin
 *
 * Tests exercise the plugin's `state.apply()` logic directly — no DOM, no
 * EditorView. We create an EditorState with the notes plugin, apply
 * transactions with the relevant meta keys, and inspect the resulting
 * plugin state.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { screenplaySchema as schema } from '../renderer/editor/schema.js';
import {
  createNotesPlugin,
  notesPluginKey,
  addNote,
  deleteNote,
  getNotes,
  rehydrateNotes,
  generateNoteId,
} from '../renderer/editor/notes.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal doc with a single action block. */
function makeDoc(text = 'Hello world') {
  return schema.node('doc', null, [
    schema.node('action', null, text ? [schema.text(text)] : []),
  ]);
}

/** Create a fresh EditorState with the notes plugin. */
function makeState(doc = makeDoc()) {
  return EditorState.create({ doc, plugins: [createNotesPlugin()] });
}

/** Get plugin state from an EditorState. */
function pluginState(state) {
  return notesPluginKey.getState(state);
}

/**
 * Minimal mock of EditorView — enough for the public API helpers
 * (addNote, deleteNote, getNotes, rehydrateNotes) which call view.dispatch
 * and view.state.
 */
function makeView(initialState) {
  const view = {
    state: initialState,
    dispatch(tr) {
      view.state = view.state.apply(tr);
    },
  };
  return view;
}

// ─── generateNoteId ───────────────────────────────────────────────────────────

describe('generateNoteId', () => {
  it('returns a string starting with "note_"', () => {
    expect(generateNoteId()).toMatch(/^note_/);
  });

  it('returns unique ids on each call', () => {
    const ids = new Set(Array.from({ length: 20 }, generateNoteId));
    expect(ids.size).toBe(20);
  });
});

// ─── Plugin initial state ─────────────────────────────────────────────────────

describe('createNotesPlugin — initial state', () => {
  it('initialises with empty notes array', () => {
    const state = makeState();
    expect(pluginState(state).notes).toEqual([]);
  });

  it('initialises with empty DecorationSet (no decorations)', () => {
    const state = makeState();
    const decos = pluginState(state).decos;
    // DecorationSet.find returns an array; empty means no decorations
    expect(decos.find()).toHaveLength(0);
  });
});

// ─── addNote (via view helper) ────────────────────────────────────────────────

describe('addNote', () => {
  it('adds a note to plugin state', () => {
    const view = makeView(makeState());
    addNote(view, 1, 5, 'My note', 'yellow');
    const notes = pluginState(view.state).notes;
    expect(notes).toHaveLength(1);
    expect(notes[0].text).toBe('My note');
    expect(notes[0].color).toBe('yellow');
    expect(notes[0].from).toBe(1);
    expect(notes[0].to).toBe(5);
  });

  it('assigns a unique id to the note', () => {
    const view = makeView(makeState());
    addNote(view, 1, 3, 'Note A', 'yellow');
    addNote(view, 3, 6, 'Note B', 'green');
    const notes = pluginState(view.state).notes;
    expect(notes[0].id).not.toBe(notes[1].id);
  });

  it('defaults color to yellow when not specified', () => {
    const view = makeView(makeState());
    addNote(view, 1, 5, 'Default color');
    expect(pluginState(view.state).notes[0].color).toBe('yellow');
  });

  it('supports all three colors', () => {
    for (const color of ['yellow', 'green', 'pink']) {
      const view = makeView(makeState());
      addNote(view, 1, 5, 'Colored', color);
      expect(pluginState(view.state).notes[0].color).toBe(color);
    }
  });

  it('accumulates multiple notes', () => {
    const view = makeView(makeState());
    addNote(view, 1, 3, 'First', 'yellow');
    addNote(view, 4, 7, 'Second', 'green');
    addNote(view, 8, 10, 'Third', 'pink');
    expect(pluginState(view.state).notes).toHaveLength(3);
  });

  it('creates a decoration for the note', () => {
    const view = makeView(makeState());
    addNote(view, 1, 5, 'Decorated', 'pink');
    const decos = pluginState(view.state).decos.find();
    expect(decos).toHaveLength(1);
  });
});

// ─── deleteNote (via view helper) ─────────────────────────────────────────────

describe('deleteNote', () => {
  it('removes a note by id', () => {
    const view = makeView(makeState());
    addNote(view, 1, 5, 'To delete', 'yellow');
    const id = pluginState(view.state).notes[0].id;

    deleteNote(view, id);
    expect(pluginState(view.state).notes).toHaveLength(0);
  });

  it('only removes the targeted note, leaving others intact', () => {
    const view = makeView(makeState());
    addNote(view, 1, 3, 'Keep', 'yellow');
    addNote(view, 4, 6, 'Delete me', 'green');

    const idToDelete = pluginState(view.state).notes[1].id;
    deleteNote(view, idToDelete);

    const remaining = pluginState(view.state).notes;
    expect(remaining).toHaveLength(1);
    expect(remaining[0].text).toBe('Keep');
  });

  it('is a no-op for a non-existent id', () => {
    const view = makeView(makeState());
    addNote(view, 1, 5, 'Note', 'yellow');
    deleteNote(view, 'non_existent_id');
    expect(pluginState(view.state).notes).toHaveLength(1);
  });

  it('removes the corresponding decoration', () => {
    const view = makeView(makeState());
    addNote(view, 1, 5, 'To delete', 'yellow');
    const id = pluginState(view.state).notes[0].id;

    deleteNote(view, id);
    expect(pluginState(view.state).decos.find()).toHaveLength(0);
  });
});

// ─── getNotes (via view helper) ───────────────────────────────────────────────

describe('getNotes', () => {
  it('returns empty array when no notes exist', () => {
    const view = makeView(makeState());
    expect(getNotes(view)).toEqual([]);
  });

  it('returns current notes array', () => {
    const view = makeView(makeState());
    addNote(view, 1, 5, 'Hello', 'yellow');
    const notes = getNotes(view);
    expect(notes).toHaveLength(1);
    expect(notes[0].text).toBe('Hello');
  });
});

// ─── rehydrateNotes (via view helper) ─────────────────────────────────────────

describe('rehydrateNotes', () => {
  it('loads saved notes into plugin state', () => {
    const view = makeView(makeState());
    const saved = [
      { id: 'note_1', text: 'Restored', color: 'green', from: 1, to: 5 },
    ];
    rehydrateNotes(view, saved);
    const notes = pluginState(view.state).notes;
    expect(notes).toHaveLength(1);
    expect(notes[0].text).toBe('Restored');
  });

  it('replaces any existing notes (full replace, not merge)', () => {
    const view = makeView(makeState());
    addNote(view, 1, 3, 'Old note', 'yellow');

    const saved = [
      { id: 'note_2', text: 'New note', color: 'pink', from: 4, to: 7 },
    ];
    rehydrateNotes(view, saved);

    const notes = pluginState(view.state).notes;
    expect(notes).toHaveLength(1);
    expect(notes[0].text).toBe('New note');
  });

  it('clamps note positions to doc size', () => {
    const view = makeView(makeState(makeDoc('Hi'))); // small doc
    const docSize = view.state.doc.content.size;

    const saved = [
      { id: 'note_x', text: 'OOB', color: 'yellow', from: 0, to: docSize + 999 },
    ];
    rehydrateNotes(view, saved);

    const notes = pluginState(view.state).notes;
    expect(notes[0].to).toBeLessThanOrEqual(docSize);
  });

  it('drops notes that collapse to zero width after clamping', () => {
    const view = makeView(makeState(makeDoc('Hi')));
    const docSize = view.state.doc.content.size;

    // Both from and to are beyond the doc — after clamping they'll be equal
    const saved = [
      { id: 'note_y', text: 'Collapsed', color: 'yellow', from: docSize + 1, to: docSize + 5 },
    ];
    rehydrateNotes(view, saved);
    expect(pluginState(view.state).notes).toHaveLength(0);
  });

  it('is a no-op for null input', () => {
    const view = makeView(makeState());
    addNote(view, 1, 5, 'Existing', 'yellow');
    rehydrateNotes(view, null);
    // Notes should remain unchanged (rehydrate bails early for null/empty)
    expect(pluginState(view.state).notes).toHaveLength(1);
  });

  it('is a no-op for empty array input', () => {
    const view = makeView(makeState());
    addNote(view, 1, 5, 'Existing', 'yellow');
    rehydrateNotes(view, []);
    expect(pluginState(view.state).notes).toHaveLength(1);
  });
});

// ─── Position remapping through edits ─────────────────────────────────────────

describe('position remapping', () => {
  it('remaps note positions when text is inserted before the note', () => {
    // doc: "Hello world" — action node, text at positions 1–11
    const view = makeView(makeState(makeDoc('Hello world')));
    // Note covers "world" (positions 7–11 inside the node content: 1 + 6 = 7, 1 + 11 = 12)
    addNote(view, 7, 12, 'World note', 'yellow');

    // Insert "Dear " (5 chars) at position 1 (start of action text)
    const tr = view.state.tr.insertText('Dear ', 1);
    view.dispatch(tr);

    const notes = pluginState(view.state).notes;
    expect(notes).toHaveLength(1);
    // Positions should have shifted by 5
    expect(notes[0].from).toBe(12);
    expect(notes[0].to).toBe(17);
  });

  it('remaps note positions when text is inserted after the note', () => {
    const view = makeView(makeState(makeDoc('Hello world')));
    // Note covers "Hello" (positions 1–5)
    addNote(view, 1, 6, 'Hello note', 'green');

    // Insert text after the note — should not shift the note
    const tr = view.state.tr.insertText('!!!', 12);
    view.dispatch(tr);

    const notes = pluginState(view.state).notes;
    expect(notes[0].from).toBe(1);
    expect(notes[0].to).toBe(6);
  });

  it('drops a note when all its text is deleted', () => {
    const view = makeView(makeState(makeDoc('Hello world')));
    // Note covers positions 1–12 (entire action text)
    addNote(view, 1, 12, 'Full note', 'yellow');

    // Delete the entire text content
    const tr = view.state.tr.delete(1, 12);
    view.dispatch(tr);

    // Note should be dropped (from === to after remap)
    expect(pluginState(view.state).notes).toHaveLength(0);
  });

  it('keeps notes that survive a partial deletion', () => {
    const view = makeView(makeState(makeDoc('Hello world')));
    // Note covers "world" ~ positions 7–12
    addNote(view, 7, 12, 'World note', 'pink');

    // Delete only "Hello " (positions 1–7)
    const tr = view.state.tr.delete(1, 7);
    view.dispatch(tr);

    const notes = pluginState(view.state).notes;
    expect(notes).toHaveLength(1);
    // "world" now starts at position 1
    expect(notes[0].from).toBe(1);
    expect(notes[0].to).toBe(6);
  });

  it('preserves decorations after remapping', () => {
    const view = makeView(makeState(makeDoc('Hello world')));
    addNote(view, 7, 12, 'World note', 'yellow');

    const tr = view.state.tr.insertText('Dear ', 1);
    view.dispatch(tr);

    const decos = pluginState(view.state).decos.find();
    expect(decos).toHaveLength(1);
    expect(decos[0].from).toBe(12);
    expect(decos[0].to).toBe(17);
  });
});

// ─── No-op shortcut ───────────────────────────────────────────────────────────

describe('apply shortcut — returns same state when nothing changed', () => {
  it('returns the same plugin state object for a no-op selection change', () => {
    const view = makeView(makeState());
    addNote(view, 1, 5, 'Note', 'yellow');
    const before = pluginState(view.state);

    // Selection-only transaction (no docChanged, no meta)
    const tr = view.state.tr.setSelection(
      view.state.selection
    );
    view.dispatch(tr);

    // Plugin state object should be the same reference
    expect(pluginState(view.state)).toBe(before);
  });
});
