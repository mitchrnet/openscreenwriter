/**
 * notes.js — Non-printing annotation system
 *
 * Notes are stored as ProseMirror decorations — not in document content — so
 * they never appear in Fountain export or PDF. Positions are remapped through
 * edits automatically. Notes that collapse (their text is fully deleted) are
 * removed automatically.
 *
 * Plugin state shape: { notes: Note[], decos: DecorationSet }
 *   Note: { id: string, text: string, color: 'yellow'|'green'|'pink', from: number, to: number }
 *
 * Public API:
 *   createNotesPlugin()        → Plugin
 *   addNote(view, from, to, text, color) → void
 *   deleteNote(view, id)       → void
 *   getNotes(view)             → Note[]
 *   rehydrateNotes(view, notes) → void  (call after opening a file)
 */

import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

export const notesPluginKey = new PluginKey('notes');

let _idCounter = 0;
export function generateNoteId() {
  return `note_${Date.now()}_${++_idCounter}`;
}

/** Build a DecorationSet from a notes array and a doc. */
function buildDecorations(notes, doc) {
  const decos = notes.map(n =>
    Decoration.inline(n.from, n.to, {
      class: `note-highlight note-color-${n.color}`,
      'data-note-id': n.id,
    })
  );
  return DecorationSet.create(doc, decos);
}

export function createNotesPlugin() {
  return new Plugin({
    key: notesPluginKey,

    state: {
      init() {
        return { notes: [], decos: DecorationSet.empty };
      },

      apply(tr, pluginState) {
        const add       = tr.getMeta('addNote');
        const remove    = tr.getMeta('deleteNote');
        const rehydrate = tr.getMeta('rehydrateNotes');
        const update    = tr.getMeta('editNote');
        const docChanged = tr.docChanged;

        // Shortcut: nothing to do
        if (!docChanged && !add && !remove && !rehydrate && !update) return pluginState;

        // Remap positions through the transaction
        let notes = docChanged
          ? pluginState.notes
              .map(n => ({
                ...n,
                from: tr.mapping.map(n.from),
                to:   tr.mapping.map(n.to, -1),
              }))
              .filter(n => n.from < n.to) // drop collapsed notes
          : pluginState.notes;

        if (add) {
          notes = [...notes, add];
        }

        if (remove) {
          notes = notes.filter(n => n.id !== remove.id);
        }

        if (update) {
          notes = notes.map(n => n.id === update.id ? { ...n, text: update.text, color: update.color } : n);
        }

        if (rehydrate) {
          // Clamp positions to valid doc range to be safe when loading old files
          const size = tr.doc.content.size;
          notes = rehydrate
            .map(n => ({ ...n, from: Math.min(n.from, size), to: Math.min(n.to, size) }))
            .filter(n => n.from < n.to);
        }

        return { notes, decos: buildDecorations(notes, tr.doc) };
      },
    },

    props: {
      decorations(state) {
        return this.getState(state).decos;
      },
    },
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Add a note covering [from, to) in the document. */
export function addNote(view, from, to, text, color = 'yellow') {
  const id = generateNoteId();
  const tr = view.state.tr.setMeta('addNote', { id, text, color, from, to });
  view.dispatch(tr);
}

/** Remove a note by id. */
export function deleteNote(view, id) {
  const tr = view.state.tr.setMeta('deleteNote', { id });
  view.dispatch(tr);
}

/** Return the current notes array (with current document positions). */
export function getNotes(view) {
  return notesPluginKey.getState(view.state)?.notes ?? [];
}

/** Update a note's text and color by id. */
export function editNote(view, id, text, color) {
  const tr = view.state.tr.setMeta('editNote', { id, text, color });
  view.dispatch(tr);
}

/** Load saved notes into the editor (call after opening a file and creating editor). */
export function rehydrateNotes(view, notes) {
  if (!notes || notes.length === 0) return;
  const tr = view.state.tr.setMeta('rehydrateNotes', notes);
  view.dispatch(tr);
}
