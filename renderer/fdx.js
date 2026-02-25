/**
 * fdx.js — Final Draft XML exporter / importer
 *
 * tokensToFdx: Converts a Fountain token array to a valid .fdx string.
 * fdxToFountain: Converts a .fdx XML string to Fountain plain text.
 *
 * FDX spec reference: Final Draft 11/12 reads Version 5 files correctly.
 */

/** Map Fountain token types to FDX Paragraph types */
const FDX_TYPE_MAP = {
  scene_heading:  'Scene Heading',
  action:         'Action',
  character:      'Character',
  dialogue:       'Dialogue',
  parenthetical:  'Parenthetical',
  transition:     'Transition',
  centered:       'Action',   // No centered type in FDX; Action is closest
  lyric:          'Action',
  // Skipped: empty, note, title_page, page_break (handled separately)
};

/**
 * Escape special XML characters in a text string.
 * @param {string} str
 * @returns {string}
 */
function xmlEscape(str) {
  return str
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&apos;');
}

/**
 * Build the title page XML block from title_page tokens.
 * @param {Array<{ type: string, text: string }>} titleTokens
 * @returns {string}
 */
function buildTitlePage(titleTokens) {
  if (titleTokens.length === 0) return '';

  const lines = ['  <TitlePage>'];
  for (const token of titleTokens) {
    // token.text is "Key: value"
    const colonIdx = token.text.indexOf(':');
    if (colonIdx === -1) continue;
    const key   = token.text.slice(0, colonIdx).trim();
    const value = xmlEscape(token.text.slice(colonIdx + 1).trim());
    // FDX title page content uses a specific element structure
    lines.push(`    <Content>`);
    lines.push(`      <Paragraph Type="Action">`);
    lines.push(`        <Text>${xmlEscape(key)}: ${value}</Text>`);
    lines.push(`      </Paragraph>`);
    lines.push(`    </Content>`);
  }
  lines.push('  </TitlePage>');
  return lines.join('\n');
}

/**
 * Convert a Fountain token array to a Final Draft XML string.
 *
 * @param {Array<{ type: string, text: string, lineIndex: number }>} tokens
 * @returns {string} Complete .fdx XML string
 */
export function tokensToFdx(tokens) {
  const titleTokens = tokens.filter(t => t.type === 'title_page');
  const bodyTokens  = tokens.filter(t => t.type !== 'title_page');

  const lines = [
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
    '<FinalDraft DocumentType="Script" Template="No" Version="5">',
  ];

  // Title page (optional)
  const titlePageXml = buildTitlePage(titleTokens);
  if (titlePageXml) lines.push(titlePageXml);

  lines.push('  <Content>');

  let pendingPageBreak = false;

  for (const token of bodyTokens) {
    // Track page breaks — applied as attribute on the NEXT paragraph
    if (token.type === 'page_break') {
      pendingPageBreak = true;
      continue;
    }

    // Skip non-content tokens
    if (token.type === 'empty' || token.type === 'note') continue;

    const fdxType = FDX_TYPE_MAP[token.type];
    if (!fdxType) continue;

    const pageAttr = pendingPageBreak ? ' StartsNewPage="Yes"' : '';
    pendingPageBreak = false;

    const escapedText = xmlEscape(token.text);
    lines.push(`    <Paragraph Type="${fdxType}"${pageAttr}>`);
    lines.push(`      <Text>${escapedText}</Text>`);
    lines.push(`    </Paragraph>`);
  }

  lines.push('  </Content>');
  lines.push('</FinalDraft>');

  return lines.join('\n');
}

// ─── FDX → Fountain ──────────────────────────────────────────────────────────

/**
 * Extract text content from an FDX <Paragraph> element, preserving inline
 * Bold/Italic/Underline as Fountain markup (**bold**, *italic*, _underline_).
 * @param {Element} paraEl
 * @returns {string}
 */
function extractParaText(paraEl) {
  const textEls = paraEl.querySelectorAll('Text');
  if (textEls.length === 0) return paraEl.textContent.trim();

  let result = '';
  textEls.forEach(textEl => {
    const style   = textEl.getAttribute('Style') || '';
    const content = textEl.textContent;
    if (!content) return;

    const isBold      = style.includes('Bold');
    const isItalic    = style.includes('Italic');
    const isUnderline = style.includes('Underline');

    if (!isBold && !isItalic && !isUnderline) {
      result += content;
      return;
    }

    let wrapped = content;
    if (isBold && isItalic) wrapped = `***${content}***`;
    else if (isBold)        wrapped = `**${content}**`;
    else if (isItalic)      wrapped = `*${content}*`;
    if (isUnderline)        wrapped = `_${wrapped}_`;
    result += wrapped;
  });
  return result.trim();
}

/**
 * Convert a Final Draft XML string to Fountain plain text.
 *
 * @param {string} fdxXml - Raw .fdx file contents
 * @returns {string} Fountain-format screenplay text
 */
export function fdxToFountain(fdxXml) {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(fdxXml, 'text/xml');

  // Bail on parse errors
  if (xmlDoc.querySelector('parsererror')) return '';

  const output = [];

  // --- Title page ---
  const titleContent = xmlDoc.querySelector('TitlePage > Content');
  if (titleContent) {
    const paras = Array.from(titleContent.children).filter(el => el.tagName === 'Paragraph');
    paras.forEach(para => {
      const text = extractParaText(para);
      if (text) output.push(text);
    });
    if (output.length > 0) output.push('');
  }

  // --- Body ---
  const bodyContent = xmlDoc.querySelector('FinalDraft > Content');
  if (!bodyContent) return output.join('\n');

  const paragraphs = Array.from(bodyContent.children).filter(el => el.tagName === 'Paragraph');

  // These types start a new "beat" and need a blank line before them
  const needsBlankLine = new Set([
    'Scene Heading', 'Action', 'Shot', 'General', 'Transition', 'Character',
  ]);

  let prevType = null;

  paragraphs.forEach(para => {
    const type = para.getAttribute('Type') || 'Action';
    const text = extractParaText(para);
    if (!text) { prevType = type; return; }

    // Insert blank line before certain element types (but not at the very start)
    if (prevType !== null && needsBlankLine.has(type)) {
      output.push('');
    }

    switch (type) {
      case 'Scene Heading':
        output.push(text); // already uppercase in FDX
        break;
      case 'Character':
        output.push(text.toUpperCase());
        break;
      case 'Dialogue':
        output.push(text);
        break;
      case 'Parenthetical': {
        const t = text.trim();
        output.push((t.startsWith('(') && t.endsWith(')')) ? t : `(${t})`);
        break;
      }
      case 'Transition': {
        // Auto-recognized in Fountain if it ends in "TO:" — otherwise use ">"
        const t = text.trim();
        output.push(/^[A-Z ]+:$/.test(t) ? t : `> ${t}`);
        break;
      }
      default: // Action, Shot, General, etc.
        output.push(text);
        break;
    }

    prevType = type;
  });

  return output.join('\n');
}
