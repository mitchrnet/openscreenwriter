/**
 * node-views.js — Custom NodeViews for screenplay block types.
 *
 * Each block's ResizeObserver reports the actual rendered content height
 * (excluding pagination padding-bottom) in unzoomed logical CSS px.
 */

import { heightRegistry } from './height-registry.js';

const SCREENPLAY_BLOCK_TYPES = new Set([
  'scene_heading', 'action', 'character', 'dialogue',
  'parenthetical', 'transition', 'centered', 'lyric', 'note',
  // page_break excluded: atom node, zero height, special-cased in pagination
]);

const TYPE_TO_CLASS = {
  scene_heading: 'ws-scene-heading',
  action:        'ws-action',
  character:     'ws-character',
  dialogue:      'ws-dialogue',
  parenthetical: 'ws-parenthetical',
  transition:    'ws-transition',
  centered:      'ws-centered',
  lyric:         'ws-lyric',
  note:          'ws-note',
};

class ScreenplayBlockNodeView {
  constructor(node, view, getPos, getZoom) {
    this.getPos  = getPos;
    this.getZoom = getZoom;
    this._type   = node.type.name;

    this.dom = document.createElement('div');
    this.dom.className    = `ws-block ${TYPE_TO_CLASS[this._type]}`;
    this.dom.dataset.type = this._type;
    this.contentDOM = this.dom;  // ProseMirror places inline content here

    this.lastKnownPos = getPos();

    heightRegistry.registerNodeView(this);

    this._ro = new ResizeObserver(() => this._report());
    this._ro.observe(this.dom);
  }

  _report() {
    const pos = this.getPos();
    if (pos == null) return;

    // Keep lastKnownPos in sync so refreshPositions() has accurate data.
    if (pos !== this.lastKnownPos) {
      heightRegistry.delete(this.lastKnownPos);
      this.lastKnownPos = pos;
    }

    // Zoom correction:
    //   getBoundingClientRect().height is in zoomed CSS px.
    //   The inline style.paddingBottom (set by Decoration.node) is in
    //   unzoomed CSS px (the value written by pagination logic), but
    //   contributes rawPb * zoom to the bounding rect.
    //   So:  logicalH = rect.height / zoom - rawPb
    const zoom    = this.getZoom();
    const rawPb   = parseFloat(this.dom.style.paddingBottom) || 0;
    const rect    = this.dom.getBoundingClientRect();
    const logical = rect.height / (zoom || 1) - rawPb;

    heightRegistry.set(pos, logical);
  }

  update(node) {
    return node.type.name === this._type;
  }

  ignoreMutation(mutation) {
    // Pagination applies padding-bottom via Decoration.node as a style
    // attribute mutation. Tell ProseMirror to ignore it so the NodeView
    // isn't re-rendered. Also ignore class mutations (decoration attrs).
    const attr = mutation.attributeName;
    if (mutation.type === 'attributes' && (attr === 'style' || attr === 'class')) {
      return true;
    }
    return false;
  }

  destroy() {
    this._ro.disconnect();
    heightRegistry.unregisterNodeView(this);
  }
}

/**
 * Build the nodeViews map for the EditorView constructor.
 * @param {Schema}   schema  — ProseMirror schema
 * @param {Function} getZoom — () => number, returns current CSS zoom level
 */
export function buildNodeViews(schema, getZoom) {
  const nodeViews = {};
  for (const typeName of SCREENPLAY_BLOCK_TYPES) {
    if (!schema.nodes[typeName]) continue;
    nodeViews[typeName] = (node, view, getPos) =>
      new ScreenplayBlockNodeView(node, view, getPos, getZoom);
  }
  return nodeViews;
}
