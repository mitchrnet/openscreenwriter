/**
 * serializer.js — Fountain text <-> ProseMirror doc conversion
 *
 * fountainToDoc: parses Fountain text via parseFountain(), builds a ProseMirror doc
 * docToFountain: walks ProseMirror doc, serializes back to Fountain text
 */

import { parseFountain } from '../fountain.js';

// Title page key mapping (same as old app.js)
const TP_KEY_MAP = {
  'title':            'title',
  'credit':           'credit',
  'author':           'author',
  'authors':          'author',
  'source':           'source',
  'draft date':       'draftDate',
  'contact':          'contact',
  'contact position': 'contactPosition',
};

/**
 * Parse Fountain inline markup (bold, italic, underline) into ProseMirror
 * text nodes with marks, rather than HTML.
 *
 * Returns an array of { text, marks } objects where marks is an array
 * of mark type names.
 */
function parseInlineMarks(text) {
  const segments = [];
  let remaining = text;

  // Regex matches Fountain inline markup patterns
  // Order matters: bold+italic first, then bold, italic, underline
  const patterns = [
    { re: /\*\*\*(.+?)\*\*\*/, marks: ['bold', 'italic'] },
    { re: /\*\*(.+?)\*\*/,     marks: ['bold'] },
    { re: /\*(.+?)\*/,         marks: ['italic'] },
    { re: /_(.+?)_/,           marks: ['underline'] },
  ];

  while (remaining.length > 0) {
    let earliest = null;
    let earliestIdx = Infinity;
    let earliestPattern = null;

    for (const p of patterns) {
      const m = p.re.exec(remaining);
      if (m && m.index < earliestIdx) {
        earliest = m;
        earliestIdx = m.index;
        earliestPattern = p;
      }
    }

    if (!earliest) {
      // No more markup — rest is plain text
      if (remaining) segments.push({ text: remaining, marks: [] });
      break;
    }

    // Text before the match
    if (earliestIdx > 0) {
      segments.push({ text: remaining.slice(0, earliestIdx), marks: [] });
    }

    // The marked text
    segments.push({ text: earliest[1], marks: earliestPattern.marks });

    remaining = remaining.slice(earliestIdx + earliest[0].length);
  }

  return segments;
}

/**
 * Create ProseMirror text nodes from a text string with Fountain inline markup.
 */
function createTextNodes(text, schema) {
  if (!text) return [];

  const segments = parseInlineMarks(text);
  const nodes = [];

  for (const seg of segments) {
    if (!seg.text) continue;
    const marks = seg.marks.map(m => schema.marks[m].create());
    nodes.push(schema.text(seg.text, marks));
  }

  return nodes;
}

/**
 * Convert Fountain text to a ProseMirror doc.
 *
 * @param {string} text - Raw Fountain text
 * @param {Schema} schema - The ProseMirror schema
 * @returns {{ doc: Node, titlePageData: object }}
 */
export function fountainToDoc(text, schema) {
  const titlePageData = {
    title: '', credit: '', author: '',
    source: '', draftDate: '', contact: '',
    contactPosition: 'left',
  };

  if (!text || text.trim() === '') {
    return {
      doc: schema.node('doc', null, [
        schema.node('action', null),
      ]),
      titlePageData,
    };
  }

  const tokens = parseFountain(text);

  // Extract title page data
  for (const t of tokens) {
    if (t.type !== 'title_page') continue;
    const match = /^([^:]+):\s*(.*)$/.exec(t.text);
    if (!match) continue;
    const key = match[1].trim().toLowerCase();
    const val = match[2].trim();
    const field = TP_KEY_MAP[key];
    if (field) titlePageData[field] = val;
  }

  // Build ProseMirror nodes from body tokens (skip title_page and empty)
  const nodes = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (token.type === 'title_page') continue;
    if (token.type === 'empty') continue;

    if (token.type === 'page_break') {
      nodes.push(schema.node('page_break'));
      continue;
    }

    // Dual dialogue: when a character token has dual:true, retroactively
    // wrap the previous character+dialogue sequence and this one in a
    // dual_dialogue container.
    if (token.type === 'character' && token.dual) {
      // Pop previous character+dialogue/parenthetical nodes from the end of `nodes`
      const leftNodes = [];
      while (nodes.length > 0) {
        const last = nodes[nodes.length - 1];
        const t = last.type.name;
        if (t === 'character' || t === 'dialogue' || t === 'parenthetical') {
          leftNodes.unshift(nodes.pop());
        } else {
          break;
        }
      }

      // Build right col: this character + its following dialogue/parenthetical tokens
      const rightNodes = [];
      const charText = createTextNodes(token.text, schema);
      rightNodes.push(schema.node('character', null, charText.length ? charText : undefined));
      while (i + 1 < tokens.length) {
        const next = tokens[i + 1];
        if (next.type === 'dialogue' || next.type === 'parenthetical') {
          const tnodes = createTextNodes(next.text, schema);
          rightNodes.push(schema.node(next.type, null, tnodes.length ? tnodes : undefined));
          i++;
        } else {
          break;
        }
      }

      if (leftNodes.length > 0 && rightNodes.length > 0) {
        const leftCol  = schema.node('dual_col', null, leftNodes);
        const rightCol = schema.node('dual_col', null, rightNodes);
        nodes.push(schema.node('dual_dialogue', null, [leftCol, rightCol]));
      } else {
        // Malformed — fall back to pushing nodes without dual grouping
        nodes.push(...leftNodes);
        nodes.push(...rightNodes);
      }
      continue;
    }

    // Map token type to schema node type
    const nodeType = schema.nodes[token.type];
    if (!nodeType) {
      // Unknown type — fallback to action
      const textNodes = createTextNodes(token.text, schema);
      nodes.push(schema.node('action', null, textNodes.length ? textNodes : undefined));
      continue;
    }

    const textNodes = createTextNodes(token.text, schema);
    nodes.push(schema.node(token.type, null, textNodes.length ? textNodes : undefined));
  }

  // Ensure at least one block
  if (nodes.length === 0) {
    nodes.push(schema.node('action', null));
  }

  return {
    doc: schema.node('doc', null, nodes),
    titlePageData,
  };
}

/**
 * Serialize inline marks back to Fountain markup.
 * Walks a ProseMirror node's inline content and emits Fountain text.
 */
function serializeInline(node) {
  let out = '';
  node.forEach(child => {
    if (child.isText) {
      let text = child.text;
      const hasBold = child.marks.some(m => m.type.name === 'bold');
      const hasItalic = child.marks.some(m => m.type.name === 'italic');
      const hasUnderline = child.marks.some(m => m.type.name === 'underline');

      if (hasBold && hasItalic) {
        text = `***${text}***`;
      } else if (hasBold) {
        text = `**${text}**`;
      } else if (hasItalic) {
        text = `*${text}*`;
      }

      if (hasUnderline) {
        text = `_${text}_`;
      }

      out += text;
    }
  });
  return out;
}

/**
 * Convert a ProseMirror doc to Fountain text.
 *
 * @param {Node} doc - ProseMirror document node
 * @param {object} titlePageData - Title page data model
 * @returns {string} Fountain text
 */
export function docToFountain(doc, titlePageData) {
  const lines = [];
  let prevType = null;

  doc.forEach((node, _offset, index) => {
    const type = node.type.name;

    if (type === 'page_break') {
      if (prevType !== null) lines.push('');
      lines.push('===');
      lines.push('');
      prevType = type;
      return;
    }

    // Dual dialogue: serialize left col normally, right col with ^ on character name
    if (type === 'dual_dialogue') {
      if (prevType !== null && prevType !== 'page_break') lines.push('');
      node.forEach((col, _colOffset, colIndex) => {
        const isRight = colIndex === 1;
        col.forEach((block, _blockOffset, blockIndex) => {
          const bt = block.type.name;
          const blockText = serializeInline(block);
          if (bt === 'character') {
            // Right column character: add blank line before (required by Fountain parser)
            // so the `^` line is preceded by an empty line.
            if (isRight) {
              lines.push('');
              lines.push(blockText.toUpperCase() + ' ^');
            } else {
              lines.push(blockText.toUpperCase());
            }
          } else {
            lines.push(blockText);
          }
        });
      });
      lines.push('');
      prevType = type;
      return;
    }

    const text = serializeInline(node);

    // Add blank line separators based on Fountain formatting rules
    if (prevType !== null) {
      // Scene headings, characters, and transitions need a blank line before them
      if (type === 'scene_heading' || type === 'character' || type === 'transition' ||
          type === 'action' || type === 'centered' || type === 'lyric') {
        // Don't double-blank after page breaks (already handled)
        if (prevType !== 'page_break') {
          lines.push('');
        }
      }
      // Dialogue/parenthetical after character or dialogue — no blank line
    }

    switch (type) {
      case 'scene_heading':
        lines.push(text.toUpperCase());
        break;
      case 'character':
        lines.push(text.toUpperCase());
        break;
      case 'centered':
        lines.push(`> ${text} <`);
        break;
      case 'lyric':
        lines.push(`~ ${text}`);
        break;
      case 'note':
        lines.push(`[[${text}]]`);
        break;
      default:
        lines.push(text);
        break;
    }

    prevType = type;
  });

  // Prepend title page if present
  const tpText = titlePageToFountain(titlePageData);
  return tpText + lines.join('\n');
}

/**
 * Generate Fountain title page block from data model.
 */
function titlePageToFountain(data) {
  if (!data || !data.title) return '';
  const lines = [];
  if (data.title)     lines.push(`Title: ${data.title}`);
  if (data.credit)    lines.push(`Credit: ${data.credit}`);
  if (data.author)    lines.push(`Author: ${data.author}`);
  if (data.source)    lines.push(`Source: ${data.source}`);
  if (data.draftDate) lines.push(`Draft date: ${data.draftDate}`);
  if (data.contact)   lines.push(`Contact: ${data.contact}`);
  if (data.contactPosition && data.contactPosition !== 'left')
    lines.push(`Contact position: ${data.contactPosition}`);
  if (lines.length === 0) return '';
  return lines.join('\n') + '\n\n';
}
