/**
 * fountain.js — Fountain markup parser
 *
 * Spec: https://fountain.io/syntax
 *
 * Returns an array of tokens:
 *   { type: string, text: string, lineIndex: number }
 *
 * Token types:
 *   title_page, scene_heading, action, character, dialogue,
 *   parenthetical, transition, centered, page_break, note,
 *   lyric, empty
 */

// Matches title page key: value pairs (e.g. "Title: My Script")
const TITLE_PAGE_RE = /^([A-Za-z][^:]+):\s*(.*)$/;

// Auto scene heading prefixes
const SCENE_PREFIX_RE = /^(INT|EXT|INT\.\/EXT|I\/E)[.\s]/i;

// Auto transition: ends with TO: (all caps), or specific phrases
const AUTO_TRANSITION_RE = /^[A-Z\s]+TO:$/;
const TRANSITION_PHRASES = new Set(['FADE OUT.', 'FADE TO BLACK.', 'SMASH CUT TO:', 'IRIS OUT.']);

/**
 * Strip inline notes [[...]] from a line of text.
 * @param {string} text
 * @returns {string}
 */
function stripNotes(text) {
  return text.replace(/\[\[[\s\S]*?\]\]/g, '').trim();
}

/**
 * Attempt to parse the title page block at the start of the script.
 * The title page is a block of "key: value" lines before the first blank line.
 * Returns { tokens, bodyStart } where bodyStart is the character offset into
 * the stripped (no-boneyard) text where the body begins.
 *
 * @param {string[]} lines
 * @returns {{ tokens: object[], bodyEnd: number }}
 */
function extractTitlePage(lines) {
  const tokens = [];
  let i = 0;

  // Check if the document starts with a title page block
  // A title page block must begin with a "key: value" line
  if (lines.length === 0 || !TITLE_PAGE_RE.test(lines[0].trim())) {
    return { tokens, bodyEnd: 0 };
  }

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === '') {
      // Blank line ends the title page
      i++; // consume the blank line
      break;
    }

    const match = TITLE_PAGE_RE.exec(trimmed);
    if (match) {
      tokens.push({ type: 'title_page', text: trimmed, lineIndex: i });
    } else {
      // Non-key:value line in the middle of a title page block — stop
      break;
    }
    i++;
  }

  return { tokens, bodyEnd: i };
}

/**
 * Parse a Fountain-formatted string into a token array.
 *
 * @param {string} rawText
 * @returns {Array<{ type: string, text: string, lineIndex: number }>}
 */
export function parseFountain(rawText) {
  if (!rawText || rawText.trim() === '') return [];

  // --- 1. Strip boneyard (/* ... */) ---
  const noBoneyard = rawText.replace(/\/\*[\s\S]*?\*\//g, '');

  // --- 2. Split into lines ---
  const lines = noBoneyard.split('\n');

  // --- 3. Extract title page ---
  const { tokens, bodyEnd } = extractTitlePage(lines);
  const bodyLines = lines.slice(bodyEnd);

  // --- 4. Parse the body line by line ---
  const bodyTokens = parseBody(bodyLines, bodyEnd);

  return [...tokens, ...bodyTokens];
}

/**
 * Parse the screenplay body (everything after the title page).
 *
 * @param {string[]} lines
 * @param {number} lineOffset  Offset to add to lineIndex values (title page length)
 * @returns {Array<{ type: string, text: string, lineIndex: number }>}
 */
function parseBody(lines, lineOffset) {
  const tokens = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const absIndex = i + lineOffset;

    // Helper: look at previous and next non-adjusted trimmed lines
    const prev = i > 0 ? lines[i - 1].trim() : null;
    const next = i < lines.length - 1 ? lines[i + 1].trim() : null;

    // ---- Page break ----
    if (/^={3,}\s*$/.test(trimmed)) {
      tokens.push({ type: 'page_break', text: '', lineIndex: absIndex });
      continue;
    }

    // ---- Centered text: >text< ----
    if (trimmed.startsWith('>') && trimmed.endsWith('<')) {
      tokens.push({
        type: 'centered',
        text: stripNotes(trimmed.slice(1, -1).trim()),
        lineIndex: absIndex,
      });
      continue;
    }

    // ---- Forced scene heading: .text (not ..) ----
    if (trimmed.startsWith('.') && !trimmed.startsWith('..')) {
      tokens.push({
        type: 'scene_heading',
        text: stripNotes(trimmed.slice(1).trim()),
        lineIndex: absIndex,
      });
      continue;
    }

    // ---- Auto scene heading: INT./EXT./I/E + preceded by blank or start ----
    if (SCENE_PREFIX_RE.test(trimmed) && (prev === '' || prev === null)) {
      tokens.push({
        type: 'scene_heading',
        text: stripNotes(trimmed),
        lineIndex: absIndex,
      });
      continue;
    }

    // ---- Forced transition: >text (no trailing <) ----
    if (trimmed.startsWith('>') && !trimmed.endsWith('<')) {
      tokens.push({
        type: 'transition',
        text: stripNotes(trimmed.slice(1).trim()),
        lineIndex: absIndex,
      });
      continue;
    }

    // ---- Auto transition: uppercase ending in TO: or known phrases ----
    if (
      (AUTO_TRANSITION_RE.test(trimmed) || TRANSITION_PHRASES.has(trimmed)) &&
      (prev === '' || prev === null) &&
      (next === '' || next === null)
    ) {
      tokens.push({ type: 'transition', text: stripNotes(trimmed), lineIndex: absIndex });
      continue;
    }

    // ---- Forced character: @text ----
    if (trimmed.startsWith('@')) {
      tokens.push({
        type: 'character',
        text: stripNotes(trimmed.slice(1).trim()),
        lineIndex: absIndex,
      });
      continue;
    }

    // ---- Auto character: ALL CAPS + blank prev + non-blank next ----
    if (
      trimmed.length > 0 &&
      trimmed === trimmed.toUpperCase() &&
      /[A-Z]/.test(trimmed) &&
      !trimmed.startsWith('INT') && !trimmed.startsWith('EXT') && // don't steal scene headings
      (prev === '' || prev === null) &&
      next !== null && next !== ''
    ) {
      tokens.push({ type: 'character', text: stripNotes(trimmed), lineIndex: absIndex });
      continue;
    }

    // ---- Dialogue context: lines immediately after character/dialogue/parenthetical ----
    const lastType = tokens.length > 0 ? tokens[tokens.length - 1].type : null;
    if (lastType === 'character' || lastType === 'dialogue' || lastType === 'parenthetical') {
      if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
        tokens.push({
          type: 'parenthetical',
          text: stripNotes(trimmed),
          lineIndex: absIndex,
        });
        continue;
      }
      if (trimmed !== '') {
        tokens.push({ type: 'dialogue', text: stripNotes(trimmed), lineIndex: absIndex });
        continue;
      }
      // Blank line with exactly two spaces = blank line within dialogue (Fountain spec)
      if (line === '  ') {
        tokens.push({ type: 'dialogue', text: '', lineIndex: absIndex });
        continue;
      }
      // Otherwise: truly blank — fall through to empty
    }

    // ---- Lyric: ~text ----
    if (trimmed.startsWith('~')) {
      tokens.push({ type: 'lyric', text: stripNotes(trimmed.slice(1).trim()), lineIndex: absIndex });
      continue;
    }

    // ---- Forced action: !text ----
    if (trimmed.startsWith('!')) {
      tokens.push({ type: 'action', text: stripNotes(trimmed.slice(1).trim()), lineIndex: absIndex });
      continue;
    }

    // ---- Inline note only (nothing else on line) ----
    if (/^\[\[[\s\S]*?\]\]$/.test(trimmed)) {
      tokens.push({ type: 'note', text: trimmed.slice(2, -2).trim(), lineIndex: absIndex });
      continue;
    }

    // ---- Empty line ----
    if (trimmed === '') {
      tokens.push({ type: 'empty', text: '', lineIndex: absIndex });
      continue;
    }

    // ---- Default: action ----
    tokens.push({ type: 'action', text: stripNotes(trimmed), lineIndex: absIndex });
  }

  return tokens;
}

// ============================================================
// Inline markup processor (used by preview renderer)
// ============================================================

/**
 * Escape HTML special characters.
 * @param {string} str
 * @returns {string}
 */
function htmlEscape(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Process Fountain inline markup into HTML tags.
 * Handles bold+italic (***text***), bold (**text**), italic (*text*),
 * and underline (_text_). Escapes HTML before applying patterns.
 *
 * @param {string} text
 * @returns {string} HTML string safe for innerHTML
 */
export function processInlineMarkup(text) {
  const escaped = htmlEscape(text);
  return escaped
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g,     '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,         '<em>$1</em>')
    .replace(/_(.+?)_/g,           '<u>$1</u>');
}
