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
 *
 * Special case: if the cursor is in a dialogue block inside a dual_col
 * and the block is empty, exit the entire dual_dialogue by inserting an
 * action block after it.
 */
export function smartEnter(state, dispatch) {
  const { $from } = state.selection;
  const parent = $from.parent;
  const parentType = parent.type.name;
  const hasContent = parent.textContent.trim().length > 0;

  // Exit dual dialogue on Enter in an empty dialogue block inside dual_col
  if ((parentType === 'dialogue' || parentType === 'character') && !hasContent) {
    // Walk up to see if we're inside a dual_col → dual_dialogue
    if ($from.depth >= 2) {
      const grandparent = $from.node($from.depth - 1);
      if (grandparent && grandparent.type.name === 'dual_col') {
        const greatgrandparent = $from.node($from.depth - 2);
        if (greatgrandparent && greatgrandparent.type.name === 'dual_dialogue') {
          if (dispatch) {
            const dualPos = $from.before($from.depth - 2);
            const dualNode = greatgrandparent;
            const insertPos = dualPos + dualNode.nodeSize;
            const tr = state.tr;
            // Delete the empty block
            tr.delete($from.before(), $from.after());
            // Insert action after dual_dialogue
            const actionNode = state.schema.nodes.action.createAndFill();
            tr.insert(insertPos - ($from.after() - $from.before()), actionNode);
            const finalPos = insertPos - ($from.after() - $from.before());
            tr.setSelection(state.selection.constructor.near(tr.doc.resolve(finalPos + 1)));
            tr.scrollIntoView();
            dispatch(tr);
          }
          return true;
        }
      }
    }
  }

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

/**
 * Wrap the current character+dialogue/parenthetical block and the preceding
 * character+dialogue/parenthetical block in a dual_dialogue container.
 *
 * Both sequences must exist and be consecutive (no non-dialogue content
 * between them). The current block's character becomes the right column;
 * the preceding becomes the left.
 */
export function wrapInDualDialogue(state, dispatch) {
  const { $from } = state.selection;
  const schema = state.schema;
  const dualDialogueType = schema.nodes.dual_dialogue;
  const dualColType      = schema.nodes.dual_col;

  if (!dualDialogueType || !dualColType) return false;

  // Must be inside a top-level character, dialogue, or parenthetical block
  const parent = $from.parent;
  const parentType = parent.type.name;
  if (!['character', 'dialogue', 'parenthetical'].includes(parentType)) return false;

  // Don't wrap if already inside a dual_dialogue
  for (let d = 1; d <= $from.depth; d++) {
    if ($from.node(d).type.name === 'dual_dialogue') return false;
  }

  // Walk back from the cursor to find the extent of the right column:
  // character + any following dialogue/parenthetical
  const rightNodes = [];
  let rightStart = $from.before(); // position of the character block

  // Find the character block for the right column by walking up to find
  // the character node that "owns" this block sequence
  let pos = $from.before();
  // Walk back to find the character block
  while (pos > 0) {
    const $pos = state.doc.resolve(pos);
    const node = $pos.nodeAfter;
    if (!node) { pos--; continue; }
    const t = node.type.name;
    if (t === 'character') { rightStart = pos; break; }
    if (t === 'dialogue' || t === 'parenthetical') { pos--; continue; }
    break;
  }

  // Collect right column nodes from rightStart forward
  let scanPos = rightStart;
  while (scanPos < state.doc.content.size) {
    const $scan = state.doc.resolve(scanPos);
    const node = $scan.nodeAfter;
    if (!node) break;
    const t = node.type.name;
    if (t === 'character' || t === 'dialogue' || t === 'parenthetical') {
      rightNodes.push(node);
      scanPos += node.nodeSize;
    } else {
      break;
    }
  }

  if (rightNodes.length === 0 || rightNodes[0].type.name !== 'character') return false;

  // Walk back from rightStart to find the left column (preceding character+dialogue sequence)
  const leftNodes = [];
  let leftEnd = rightStart;
  let leftStart = rightStart;
  let p = rightStart - 1;
  while (p > 0) {
    const $p = state.doc.resolve(p);
    const node = $p.nodeBefore;
    if (!node) break;
    const t = node.type.name;
    if (t === 'dialogue' || t === 'parenthetical') {
      leftNodes.unshift(node);
      leftEnd = p;
      p -= node.nodeSize;
    } else if (t === 'character') {
      leftNodes.unshift(node);
      leftStart = p - node.nodeSize;
      break;
    } else {
      break;
    }
  }

  if (leftNodes.length === 0 || leftNodes[0].type.name !== 'character') return false;

  if (dispatch) {
    const leftCol  = dualColType.create(null, leftNodes);
    const rightCol = dualColType.create(null, rightNodes);
    const dualNode = dualDialogueType.create(null, [leftCol, rightCol]);

    const tr = state.tr;
    // Replace the range [leftStart, rightStart + rightSize] with the dual_dialogue node
    const rightEnd = rightStart + rightNodes.reduce((s, n) => s + n.nodeSize, 0);
    tr.replaceWith(leftStart, rightEnd, dualNode);
    tr.scrollIntoView();
    dispatch(tr);
  }

  return true;
}
