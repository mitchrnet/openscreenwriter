/**
 * pagination.js — Page break decorations for ProseMirror
 *
 * ResizeObserver approach: block heights are reported by ScreenplayBlockNodeViews
 * via heightRegistry. This makes pagination zoom-aware, font-aware, and resilient
 * to CSS changes — no hardcoded CSS values in JS.
 *
 * Each "page" is padded to look exactly 11in tall by adding a Decoration.node
 * padding-bottom to the last block before each break, giving true WYSIWYG output.
 */

import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { heightRegistry } from './height-registry.js';

const paginationKey = new PluginKey('pagination');

// 8.5"×11" page, 1in top + 1in bottom padding → 9in content = 864px at 96 CSS px/in
const PAGE_CONTENT_H = 9 * 96; // 864px
// 80px dark strip + 1in (96px) white border-top + 1in (96px) white border-bottom.
// The borders represent the bottom margin of the outgoing page and the top margin
// of the incoming page, making every page visually 1in+9in+1in = 11in.
const MARKER_H = 272;

// Page number widgets are zero-height (overlaid visually in the break marker gap).
const PAGE_NUM_H  = 0;
const PAGE1_NUM_H = 0;

// ─── Widget factory helpers ───────────────────────────────────────────────────

function createMarker(pageNum) {
  const marker = document.createElement('div');
  marker.className = 'ws-block ws-page-break-marker ws-page-break-settled';
  marker.contentEditable = 'false';
  marker.dataset.page = pageNum > 0 ? `Page ${pageNum}` : '';
  return marker;
}

function createPageNum(pageNum) {
  const el = document.createElement('div');
  el.className = 'ws-block ws-page-number';
  el.contentEditable = 'false';
  el.textContent = `${pageNum}.`;
  return el;
}

// ─── Core algorithm ───────────────────────────────────────────────────────────

/**
 * Build a DecorationSet with:
 *   - Decoration.widget  — page-break gutters and page-number labels
 *   - Decoration.node    — padding-bottom on the last block before each break,
 *                          so every page section fills exactly PAGE_CONTENT_H px
 *                          and looks like a consistent 8.5"×11" sheet.
 */
function buildDecorations(state, hasTitlePage) {

  const decorations = [];
  let pageNum = 1;

  // cumulativeH tracks vertical space consumed on the current page, starting
  // with the page-number widget's own height (it occupies real content-area
  // space). Page 1's number has padding-top:0 when there's no title page.
  let cumulativeH = hasTitlePage() ? PAGE_NUM_H : PAGE1_NUM_H;

  // Track the previous node so we can pad it to fill the remaining page space
  // when the *next* node overflows.
  let prevOffset   = -1;
  let prevNodeSize = 0;

  state.doc.forEach((node, offset) => {
    if (node.type.name === 'page_break') {
      // Manual break: reset accumulator for the new page.
      pageNum++;
      cumulativeH  = PAGE_NUM_H;
      prevOffset   = -1;
      return;
    }

    const nodeH   = heightRegistry.getContentHeight(offset);
    // Screenplay blocks are never the CSS :first-child (the page-number widget
    // is), so their margin-top is always rendered — include it unconditionally.
    const mt      = heightRegistry.getMarginTop(node.type.name);
    const effectH = nodeH + mt;

    if (prevOffset >= 0 && cumulativeH + effectH > PAGE_CONTENT_H) {
      // This node overflows the current page.
      // 1. Pad the PREVIOUS node (last block on the current page) so the page
      //    section fills exactly PAGE_CONTENT_H px, giving a uniform 11" card.
      const remainingSpace = PAGE_CONTENT_H - cumulativeH;
      if (remainingSpace > 0) {
        decorations.push(Decoration.node(prevOffset, prevOffset + prevNodeSize, {
          style: `padding-bottom: ${Math.round(remainingSpace)}px`,
        }));
      }

      // 2. Insert the gutter and page-number label before the overflowing node.
      const pg = pageNum + 1;
      decorations.push(Decoration.widget(offset, () => createMarker(pg),  { side: -1 }));
      decorations.push(Decoration.widget(offset, () => createPageNum(pg), { side: -1 }));

      pageNum++;
      // Start the new page's accumulator: page-number widget + this node.
      // This node's margin IS rendered (page-number widget precedes it).
      cumulativeH = PAGE_NUM_H + effectH;
    } else {
      cumulativeH += effectH;
    }

    prevOffset   = offset;
    prevNodeSize = node.nodeSize;
  });

  // Pad the last page to PAGE_CONTENT_H just like every intermediate page.
  // Without this, the last page is naturally shorter (no overflow triggers it),
  // making all pages look inconsistent. Every page should be a fixed 9in card.
  if (prevOffset >= 0) {
    const lastPageRemaining = PAGE_CONTENT_H - cumulativeH;
    if (lastPageRemaining > 0) {
      decorations.push(Decoration.node(prevOffset, prevOffset + prevNodeSize, {
        style: `padding-bottom: ${Math.round(lastPageRemaining)}px`,
      }));
    }
  }

  // Title page separator at offset 0 (before all screenplay content)
  if (hasTitlePage()) {
    decorations.push(Decoration.widget(0, () => createMarker(0), { side: -1 }));
  }

  // Page 1 number — always at the very top of script content.
  decorations.push(Decoration.widget(0,
    () => createPageNum(1), { side: -1 }));

  return { decoSet: DecorationSet.create(state.doc, decorations), pageCount: pageNum };
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

/**
 * Create the pagination plugin.
 *
 * @param {object} options
 *   { getEditorPaper, hasTitlePage, onPageCount }
 */
export function createPaginationPlugin(options = {}) {
  const {
    getEditorPaper = () => document.getElementById('editor-paper'),
    hasTitlePage   = () => false,
    onPageCount    = () => {},
  } = options;

  let currentView      = null;
  let docChangeTimeout = null;
  let retryTimeout     = null;

  function scheduleDocChangeRecalc(view, immediate = false) {
    // Immediate path (0ms): used when the document structure changes (nodes
    // added/removed) so page breaks update within the same frame rather than
    // after a visible delay. Falls back to a 16ms debounce for plain typing so
    // rapid keystrokes are coalesced and don't thrash layout.
    if (docChangeTimeout !== null) clearTimeout(docChangeTimeout);
    docChangeTimeout = setTimeout(() => {
      docChangeTimeout = null;
      if (currentView) recalculate(currentView);
    }, immediate ? 0 : 16);
  }

  function recalculate(view) {
    const editorPaper = getEditorPaper();
    if (!editorPaper) return;

    // Sync any stale positions caused by document insertions/deletions that
    // shifted nodes without changing their heights.
    heightRegistry.refreshPositions();

    // Wait until every active NodeView has reported a height. If we run while
    // new NodeViews are still initializing (ResizeObserver hasn't fired yet),
    // their heights read as 0, the accumulator never overflows PAGE_CONTENT_H,
    // and pages grow infinitely. Returning here keeps the existing (mapped)
    // decorations alive.
    if (!heightRegistry.allReported()) {
      // Primary recovery: onChange fires when the last NodeView reports.
      // Fallback: schedule a retry in case ResizeObserver stalls (e.g. a
      // zero-height element the browser skips) so decorations don't get stuck.
      if (retryTimeout === null) {
        retryTimeout = setTimeout(() => {
          retryTimeout = null;
          if (currentView) recalculate(currentView);
        }, 32);
      }
      return;
    }

    // We have complete height data — clear any pending fallback retry.
    if (retryTimeout !== null) {
      clearTimeout(retryTimeout);
      retryTimeout = null;
    }

    const { decoSet, pageCount } = buildDecorations(view.state, hasTitlePage);
    updatePaperMinHeight(editorPaper, pageCount, hasTitlePage());
    onPageCount(pageCount);
    view.dispatch(view.state.tr.setMeta(paginationKey, decoSet));
  }

  function updatePaperMinHeight(editorPaper, totalPages, withTitlePage) {
    // All pages (including the last) now fill exactly PAGE_CONTENT_H.
    // Total height = CSS margins (2in) + pages * PAGE_CONTENT_H + gaps * MARKER_H
    // Title page adds an extra 11in section before page 1.
    if (withTitlePage) {
      editorPaper.style.minHeight =
        `calc(11in + ${totalPages} * ${PAGE_CONTENT_H}px + ${totalPages} * ${MARKER_H}px)`;
    } else {
      editorPaper.style.minHeight =
        `calc(2in + ${totalPages} * ${PAGE_CONTENT_H}px + ${totalPages - 1} * ${MARKER_H}px)`;
    }
  }

  return new Plugin({
    key: paginationKey,

    state: {
      init() {
        return DecorationSet.empty;
      },
      apply(tr, decoSet) {
        const fresh = tr.getMeta(paginationKey);
        if (fresh) return fresh;
        return decoSet.map(tr.mapping, tr.doc);
      },
    },

    view(editorView) {
      currentView = editorView;
      let prevHasTitlePage = hasTitlePage();

      // Register recalc callback — heightRegistry owns the RAF debounce.
      // NodeViews fire this automatically when any block height changes.
      heightRegistry.setOnChange(() => {
        if (currentView) recalculate(currentView);
      });

      return {
        update(view, prevState) {
          currentView = view;
          const nowHasTitlePage = hasTitlePage();
          if (nowHasTitlePage !== prevHasTitlePage) {
            prevHasTitlePage = nowHasTitlePage;
            recalculate(view);
            return;
          }
          // Re-paginate after any document change (handles deletions and cases
          // where node positions shift without height changes). Deferred via
          // setTimeout(0) so the current frame's ResizeObserver callbacks run
          // first and populate the registry before recalculate reads it.
          if (prevState.doc !== view.state.doc) {
            // Use the immediate path when the number of top-level nodes changes
            // (Enter pressed, node deleted) to avoid visible layout glitches.
            const structural = view.state.doc.childCount !== prevState.doc.childCount;
            scheduleDocChangeRecalc(view, structural);
          }
        },
        destroy() {
          currentView = null;
          if (docChangeTimeout !== null) {
            clearTimeout(docChangeTimeout);
            docChangeTimeout = null;
          }
          if (retryTimeout !== null) {
            clearTimeout(retryTimeout);
            retryTimeout = null;
          }
          heightRegistry.setOnChange(null);
        },
      };
    },

    props: {
      decorations(state) {
        return paginationKey.getState(state);
      },
    },
  });
}
