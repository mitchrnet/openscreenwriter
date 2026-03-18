/**
 * height-registry.js — Shared cache of screenplay block content heights.
 *
 * NodeViews write measured heights here. PaginationPlugin reads them.
 * Margin-top values are probed from actual CSS once per type, then cached.
 */

const heightMap   = new Map();  // pos → logical content height (px, unzoomed)
const marginCache = new Map();  // typeName → marginTop (px, unzoomed)
const nodeViewSet = new Set();  // all active ScreenplayBlockNodeView instances

let onChangeCb = null;
let rafHandle  = null;

// Maps schema node type names to CSS class names
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
  page_break:    'ws-page-break-atom',
};

function scheduleOnChange() {
  if (rafHandle !== null) return;
  rafHandle = requestAnimationFrame(() => {
    rafHandle = null;
    if (onChangeCb) onChangeCb();
  });
}

function probeMarginTop(typeName) {
  // Append to body (not #editor-paper) so CSS zoom doesn't inflate the value.
  // ws-* classes are global, so the correct margin-top is still applied.
  const el = document.createElement('div');
  el.className = `ws-block ${TYPE_TO_CLASS[typeName] ?? 'ws-action'}`;
  el.style.cssText = 'position:fixed;left:-9999px;top:0;visibility:hidden;pointer-events:none';
  document.body.appendChild(el);
  const mt = parseFloat(getComputedStyle(el).marginTop) || 0;
  document.body.removeChild(el);
  return mt;
}

export const heightRegistry = {
  set(pos, logicalH) {
    if (heightMap.get(pos) === logicalH) return;
    heightMap.set(pos, logicalH);
    scheduleOnChange();
  },

  // NOTE: intentionally does NOT call scheduleOnChange. Triggering recalculate
  // from a delete races with ResizeObserver (RAF fires before layout/RO). The
  // pagination plugin's tr.docChanged handler owns recalculate for deletions.
  delete(pos) {
    heightMap.delete(pos);
  },

  registerNodeView(nv) {
    nodeViewSet.add(nv);
  },

  unregisterNodeView(nv) {
    nodeViewSet.delete(nv);
    heightMap.delete(nv.lastKnownPos);
  },

  // Re-sync registry positions from each NodeView's current getPos().
  // Called at the start of recalculate() to fix stale entries caused by
  // document insertions/deletions shifting node positions without changing heights.
  refreshPositions() {
    for (const nv of nodeViewSet) {
      const cur = nv.getPos();
      if (cur == null) continue;
      if (cur !== nv.lastKnownPos) {
        const h = heightMap.get(nv.lastKnownPos);
        if (h !== undefined) {
          heightMap.delete(nv.lastKnownPos);
          heightMap.set(cur, h);
        }
        nv.lastKnownPos = cur;
      }
    }
  },

  isEmpty() {
    return heightMap.size === 0;
  },

  // Returns true only when every active NodeView has reported a height.
  // While new NodeViews exist but haven't fired ResizeObserver yet, this
  // returns false — preventing pagination from running with stale/zero heights.
  allReported() {
    for (const nv of nodeViewSet) {
      if (!heightMap.has(nv.lastKnownPos)) return false;
    }
    return true;
  },

  getContentHeight(pos) {
    return heightMap.get(pos) ?? 0;
  },

  getMarginTop(typeName) {
    if (!marginCache.has(typeName)) {
      marginCache.set(typeName, probeMarginTop(typeName));
    }
    return marginCache.get(typeName);
  },

  // Called by pagination plugin to register its recalc callback.
  setOnChange(cb) {
    onChangeCb = cb;
  },

  // Call after theme changes or CSS edits (rare, defensive).
  invalidateMarginCache() {
    marginCache.clear();
  },
};
