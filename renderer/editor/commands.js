/**
 * commands.js — Custom ProseMirror commands for screenplay editing
 */

import { TAB_CYCLE } from './schema.js';

/**
 * Determine the next block type after Enter based on the current block type.
 */
function getNextBlockType(currentType, hasContent) {
  if (currentType === 'character')     return 'dialogue';
  if (currentType === 'parenthetical') return 'dialogue';
  if (currentType === 'dialogue' && hasContent) return 'dialogue';
  return 'action';
}

/**
 * Smart Enter — creates a new block after the current one with a
 * context-appropriate type.
 */
export function smartEnter(state, dispatch) {
  const { $from } = state.selection;
  const parent = $from.parent;
  const parentType = parent.type.name;
  const hasContent = parent.textContent.trim().length > 0;
  const nextTypeName = getNextBlockType(parentType, hasContent);
  const nextType = state.schema.nodes[nextTypeName];

  if (!nextType) return false;

  if (dispatch) {
    // Find the end of the current block
    const endOfBlock = $from.end();
    const tr = state.tr;

    // Check if cursor is at the end of the block
    const atEnd = $from.pos === endOfBlock;
    const atStart = $from.pos === $from.start();

    if (atEnd) {
      // Insert a new empty block after the current one
      const insertPos = $from.after();
      const newNode = nextType.createAndFill();
      tr.insert(insertPos, newNode);
      // Place cursor at the start of the new block
      tr.setSelection(state.selection.constructor.near(tr.doc.resolve(insertPos + 1)));
    } else if (atStart && !hasContent) {
      // Empty block — just insert after
      const insertPos = $from.after();
      const newNode = nextType.createAndFill();
      tr.insert(insertPos, newNode);
      tr.setSelection(state.selection.constructor.near(tr.doc.resolve(insertPos + 1)));
    } else {
      // Split the current block, then change the new block's type
      tr.split($from.pos);
      const newPos = tr.doc.resolve($from.pos + 1);
      // The split created a copy of the current block type — change it to nextType
      tr.setNodeMarkup(newPos.before(), nextType);
    }

    tr.scrollIntoView();
    dispatch(tr);
  }

  return true;
}

/**
 * Cycle block type forward: action → scene_heading → character → parenthetical → transition
 */
export function cycleBlockType(state, dispatch) {
  const { $from } = state.selection;
  const parent = $from.parent;
  const currentType = parent.type.name;

  const curIdx = TAB_CYCLE.indexOf(currentType);
  const nextIdx = (curIdx + 1) % TAB_CYCLE.length;
  const nextTypeName = TAB_CYCLE[nextIdx];
  const nextType = state.schema.nodes[nextTypeName];

  if (!nextType) return false;

  if (dispatch) {
    const pos = $from.before();
    const tr = state.tr.setNodeMarkup(pos, nextType);
    dispatch(tr.scrollIntoView());
  }

  return true;
}

/**
 * Cycle block type backward (Shift+Tab)
 */
export function cycleBlockTypeBackward(state, dispatch) {
  const { $from } = state.selection;
  const parent = $from.parent;
  const currentType = parent.type.name;

  const curIdx = TAB_CYCLE.indexOf(currentType);
  const prevIdx = (curIdx - 1 + TAB_CYCLE.length) % TAB_CYCLE.length;
  const prevTypeName = TAB_CYCLE[prevIdx];
  const prevType = state.schema.nodes[prevTypeName];

  if (!prevType) return false;

  if (dispatch) {
    const pos = $from.before();
    const tr = state.tr.setNodeMarkup(pos, prevType);
    dispatch(tr.scrollIntoView());
  }

  return true;
}

/**
 * Set the current block to a specific type (used by element dropdown).
 */
export function setBlockType(typeName) {
  return (state, dispatch) => {
    const { $from } = state.selection;
    const nodeType = state.schema.nodes[typeName];
    if (!nodeType) return false;

    if (dispatch) {
      const pos = $from.before();
      const tr = state.tr.setNodeMarkup(pos, nodeType);
      dispatch(tr.scrollIntoView());
    }

    return true;
  };
}

/**
 * Insert a page break after the current block, then an empty action block.
 */
export function insertPageBreak(state, dispatch) {
  const { $from } = state.selection;
  const schema = state.schema;

  if (dispatch) {
    const insertPos = $from.after();
    const tr = state.tr;

    const pageBreakNode = schema.nodes.page_break.create();
    const actionNode = schema.nodes.action.createAndFill();

    tr.insert(insertPos, pageBreakNode);
    tr.insert(insertPos + pageBreakNode.nodeSize, actionNode);

    // Place cursor in the new action block
    const cursorPos = insertPos + pageBreakNode.nodeSize + 1;
    tr.setSelection(state.selection.constructor.near(tr.doc.resolve(cursorPos)));
    tr.scrollIntoView();
    dispatch(tr);
  }

  return true;
}

/**
 * Insert an empty action block after the current block.
 */
export function insertLineBreak(state, dispatch) {
  const { $from } = state.selection;
  const schema = state.schema;

  if (dispatch) {
    const insertPos = $from.after();
    const tr = state.tr;
    const actionNode = schema.nodes.action.createAndFill();
    tr.insert(insertPos, actionNode);
    const cursorPos = insertPos + 1;
    tr.setSelection(state.selection.constructor.near(tr.doc.resolve(cursorPos)));
    tr.scrollIntoView();
    dispatch(tr);
  }

  return true;
}

/**
 * Custom backspace guard — prevent merging across different block types
 * when cursor is at the start of a block.
 */
export function backspaceGuard(state, dispatch) {
  const { $from, empty } = state.selection;
  if (!empty) return false; // non-collapsed selection — let default handle

  // Only intervene at the very start of a block
  if ($from.parentOffset !== 0) return false;

  const parent = $from.parent;

  // If the block is empty, delete it and move cursor to previous block
  if (parent.textContent.trim() === '' && $from.depth > 0) {
    const posBefore = $from.before();

    // Don't delete if it's the only block in the doc
    if (state.doc.childCount <= 1) return false;

    // Find the position to place cursor (end of previous block)
    if (posBefore === 0) return false; // first block

    if (dispatch) {
      const tr = state.tr;
      tr.delete(posBefore, posBefore + parent.nodeSize);
      // Place cursor at end of previous block
      const newPos = tr.doc.resolve(Math.max(0, posBefore - 1));
      tr.setSelection(state.selection.constructor.near(newPos, -1));
      tr.scrollIntoView();
      dispatch(tr);
    }
    return true;
  }

  // Non-empty block at start — don't merge with previous block
  // (preserves block boundaries like the old editor)
  return true;
}
