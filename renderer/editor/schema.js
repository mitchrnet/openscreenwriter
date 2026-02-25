/**
 * schema.js — ProseMirror schema for screenplay documents
 *
 * Defines node types for all Fountain elements and marks for inline formatting.
 * Uses existing ws-* CSS classes so all current styling works unchanged.
 */

import { Schema } from 'prosemirror-model';

/**
 * Helper: create a standard block node spec.
 * Each screenplay block renders as <div class="ws-block ws-{cssClass}" data-type="{type}">
 */
function blockSpec(type, cssClass, extras = {}) {
  return {
    content: 'inline*',
    group: 'block',
    attrs: {},
    toDOM() {
      return ['div', { class: `ws-block ${cssClass}`, 'data-type': type }, 0];
    },
    parseDOM: [{ tag: `div[data-type="${type}"]` }],
    ...extras,
  };
}

export const screenplaySchema = new Schema({
  nodes: {
    doc: {
      content: 'block+',
    },

    // -- Screenplay block types --
    scene_heading:  blockSpec('scene_heading',  'ws-scene-heading'),
    action:         blockSpec('action',         'ws-action'),
    character:      blockSpec('character',      'ws-character'),
    dialogue:       blockSpec('dialogue',       'ws-dialogue'),
    parenthetical:  blockSpec('parenthetical',  'ws-parenthetical'),
    transition:     blockSpec('transition',      'ws-transition'),
    centered:       blockSpec('centered',        'ws-centered'),
    lyric:          blockSpec('lyric',            'ws-lyric'),
    note:           blockSpec('note',             'ws-note'),

    // Page break — atom node, not editable inline
    page_break: {
      group: 'block',
      atom: true,
      toDOM() {
        return ['div', {
          class: 'ws-block ws-empty',
          'data-type': 'page_break',
          contenteditable: 'false',
        }, '==='];
      },
      parseDOM: [{ tag: 'div[data-type="page_break"]' }],
    },

    // -- Inline nodes --
    text: {
      group: 'inline',
    },

    hard_break: {
      inline: true,
      group: 'inline',
      selectable: false,
      toDOM() { return ['br']; },
      parseDOM: [{ tag: 'br' }],
    },
  },

  marks: {
    bold: {
      toDOM() { return ['strong', 0]; },
      parseDOM: [
        { tag: 'strong' },
        { tag: 'b' },
        { style: 'font-weight', getAttrs: v => /^(bold|[7-9]\d{2,})$/.test(v) && null },
      ],
    },

    italic: {
      toDOM() { return ['em', 0]; },
      parseDOM: [
        { tag: 'em' },
        { tag: 'i' },
        { style: 'font-style=italic' },
      ],
    },

    underline: {
      toDOM() { return ['u', 0]; },
      parseDOM: [
        { tag: 'u' },
        { style: 'text-decoration', getAttrs: v => v === 'underline' && null },
      ],
    },
  },
});

/** Map from node type name to human-readable label for the element pill */
export const ELEMENT_LABELS = {
  scene_heading:  'Scene Heading',
  action:         'Action',
  character:      'Character',
  dialogue:       'Dialogue',
  parenthetical:  'Parenthetical',
  transition:     'Transition',
  centered:       'Centered',
  lyric:          'Lyric',
  note:           'Note',
  page_break:     'Page Break',
};

/** Tab cycle order */
export const TAB_CYCLE = [
  'action',
  'scene_heading',
  'character',
  'parenthetical',
  'transition',
];
