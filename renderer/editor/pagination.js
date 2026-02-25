/**
 * pagination.js — Page break decorations for ProseMirror
 *
 * Page breaks are visual-only widgets (Decorations) that never touch the
 * document model or interfere with cursor state. This is the key architectural
 * fix over the old raw-contentEditable approach.
 *
 * Uses the `decorations` prop approach — decorations are computed lazily
 * in the view layer, not stored in editor state, avoiding dispatch loops.
 */

import { Plugin } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

// 8.5"x11" page, 1in top + 2in bottom padding → 8" content = 768px at 96 CSS px/in
const PAGE_CONTENT_H = 8 * 96;
const MARKER_H = 80;

/**
 * Create the pagination plugin.
 *
 * @param {object} options
 *   { getEditorPaper, hasTitlePage, onPageCount }
 */
export function createPaginationPlugin(options = {}) {
  const {
    getEditorPaper = () => document.getElementById('editor-paper'),
    hasTitlePage = () => false,
    onPageCount = () => {},
  } = options;

  // Cache decorations — only recompute when doc changes
  let cachedDecos = DecorationSet.empty;
  let cachedDoc = null;
  let pendingRAF = null;
  let currentView = null;

  function scheduleRecalc() {
    if (pendingRAF) return;
    pendingRAF = requestAnimationFrame(() => {
      pendingRAF = null;
      if (currentView) {
        recalculate(currentView);
        // Force a re-render so new decorations are picked up
        currentView.updateState(currentView.state);
      }
    });
  }

  function recalculate(view) {
    const { state } = view;
    const editorPaper = getEditorPaper();
    if (!editorPaper) return;

    const zoom = parseFloat(editorPaper.style.zoom) || 1;
    const decorations = [];
    let pageNum = 1;

    const editorDOM = view.dom;
    const editorRect = editorDOM.getBoundingClientRect();
    if (editorRect.height === 0) return;

    // Title page offset
    let titlePageOffset = 0;
    if (hasTitlePage()) {
      const tpContainer = editorDOM.parentElement?.querySelector('.ws-title-page-container');
      if (tpContainer) {
        titlePageOffset = tpContainer.getBoundingClientRect().height / zoom;
      }
    }

    // Walk top-level nodes and measure positions
    state.doc.forEach((node, offset) => {
      const domNode = view.nodeDOM(offset);
      if (!domNode || !domNode.getBoundingClientRect) return;

      const rect = domNode.getBoundingClientRect();
      const bottom = (rect.bottom - editorRect.top) / zoom - titlePageOffset;

      while (bottom > pageNum * PAGE_CONTENT_H) {
        decorations.push(Decoration.widget(offset, () => {
          const marker = document.createElement('div');
          marker.className = 'ws-block ws-page-break-marker ws-page-break-settled';
          marker.contentEditable = 'false';
          marker.dataset.page = `Page ${pageNum + 1}`;
          return marker;
        }, { side: -1 }));

        decorations.push(Decoration.widget(offset, () => {
          const el = document.createElement('div');
          el.className = 'ws-block ws-page-number';
          el.contentEditable = 'false';
          el.textContent = `${pageNum + 1}.`;
          return el;
        }, { side: -1 }));

        pageNum++;
      }
    });

    // Title page separator
    if (hasTitlePage()) {
      decorations.push(Decoration.widget(0, () => {
        const marker = document.createElement('div');
        marker.className = 'ws-block ws-page-break-marker ws-page-break-settled';
        marker.contentEditable = 'false';
        marker.dataset.page = '';
        return marker;
      }, { side: -1 }));
    }

    // Update paper min-height
    const totalPages = Math.max(1, pageNum);
    if (hasTitlePage()) {
      editorPaper.style.minHeight =
        `calc(22in + ${Math.max(0, totalPages - 1)} * (8in + ${MARKER_H}px + 0.5in))`;
    } else {
      editorPaper.style.minHeight =
        `calc(11in + ${totalPages - 1} * (8in + ${MARKER_H}px + 0.5in))`;
    }

    onPageCount(totalPages);

    cachedDecos = DecorationSet.create(state.doc, decorations);
    cachedDoc = state.doc;
  }

  return new Plugin({
    view(editorView) {
      currentView = editorView;

      // Initial calculation after layout
      setTimeout(scheduleRecalc, 100);

      return {
        update(view, prevState) {
          currentView = view;
          if (!prevState.doc.eq(view.state.doc)) {
            scheduleRecalc();
          }
        },
        destroy() {
          currentView = null;
          if (pendingRAF) cancelAnimationFrame(pendingRAF);
        },
      };
    },

    props: {
      decorations(state) {
        if (cachedDoc && cachedDoc.eq(state.doc)) {
          return cachedDecos;
        }
        // Return empty while waiting for rAF recalculation
        return DecorationSet.empty;
      },
    },
  });
}
