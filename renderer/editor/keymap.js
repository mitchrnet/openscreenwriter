/**
 * keymap.js — ProseMirror keybindings for screenplay editing
 */

import { keymap } from 'prosemirror-keymap';
import { toggleMark } from 'prosemirror-commands';
import { undo, redo } from 'prosemirror-history';
import {
  smartEnter,
  cycleBlockType,
  cycleBlockTypeBackward,
  backspaceGuard,
} from './commands.js';

/**
 * Create the screenplay keymap plugin.
 *
 * @param {Schema} schema - The ProseMirror schema
 * @param {object} callbacks - External callbacks for file ops, etc.
 *   { save, saveAs, open, exportFdx, resetZoom, find, findReplace, print }
 * @returns {Plugin}
 */
export function createScreenplayKeymap(schema, callbacks = {}) {
  const bindings = {
    'Enter': smartEnter,
    'Tab': cycleBlockType,
    'Shift-Tab': cycleBlockTypeBackward,
    'Backspace': backspaceGuard,

    // Inline formatting
    'Mod-b': toggleMark(schema.marks.bold),
    'Mod-i': toggleMark(schema.marks.italic),
    'Mod-u': toggleMark(schema.marks.underline),

    // Undo / Redo
    'Mod-z': undo,
    'Mod-y': redo,
    'Mod-Shift-z': redo,
  };

  // File operations — bound to callbacks if provided
  if (callbacks.save) {
    bindings['Mod-s'] = () => { callbacks.save(); return true; };
  }
  if (callbacks.saveAs) {
    bindings['Mod-Shift-s'] = () => { callbacks.saveAs(); return true; };
  }
  if (callbacks.open) {
    bindings['Mod-o'] = () => { callbacks.open(); return true; };
  }
  if (callbacks.exportFdx) {
    bindings['Mod-e'] = () => { callbacks.exportFdx(); return true; };
  }
  if (callbacks.resetZoom) {
    bindings['Mod-0'] = () => { callbacks.resetZoom(); return true; };
  }
  if (callbacks.find) {
    bindings['Mod-f'] = () => { callbacks.find(); return true; };
  }
  if (callbacks.findReplace) {
    bindings['Mod-h'] = () => { callbacks.findReplace(); return true; };
  }
  return keymap(bindings);
}
