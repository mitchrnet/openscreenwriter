/**
 * stats.js — Script statistics extraction and panel rendering
 *
 * extractStats(doc) — pure function; walks the ProseMirror doc and returns
 *   aggregate statistics about the screenplay.
 *
 * updateStatsPanel(container, doc) — renders stats into a DOM container.
 */

const INT_RE  = /^(INT\.?|INT\/EXT\.?|I\/E\.?)\s*/i;
const EXT_RE  = /^(EXT\.?)\s*/i;
const DAY_RE  = /\s-\s*(DAY|DAWN|MORNING|AFTERNOON|NOON|DUSK)\s*$/i;
const NIGHT_RE = /\s-\s*(NIGHT|EVENING|MIDNIGHT|LATE)\s*$/i;

/**
 * Extract statistics from a ProseMirror document.
 *
 * @param {Node} doc - ProseMirror document node
 * @returns {{
 *   sceneCount: number,
 *   wordCount: number,
 *   dialogueLineCount: number,
 *   intCount: number,
 *   extCount: number,
 *   dayCount: number,
 *   nightCount: number,
 *   topChars: { name: string, lineCount: number }[],
 * }}
 */
export function extractStats(doc) {
  let sceneCount       = 0;
  let wordCount        = 0;
  let dialogueLineCount = 0;
  let intCount         = 0;
  let extCount         = 0;
  let dayCount         = 0;
  let nightCount       = 0;
  const charLines      = new Map(); // name → lineCount
  let pendingChar      = null;

  function countWords(text) {
    return text.trim() ? text.trim().split(/\s+/).length : 0;
  }

  function walk(node) {
    const type = node.type.name;

    if (type === 'scene_heading') {
      sceneCount++;
      const text = node.textContent;
      if (INT_RE.test(text))  intCount++;
      if (EXT_RE.test(text))  extCount++;
      if (DAY_RE.test(text))  dayCount++;
      if (NIGHT_RE.test(text)) nightCount++;
      wordCount += countWords(text);
      pendingChar = null;
      return;
    }

    if (type === 'action' || type === 'transition' || type === 'centered' ||
        type === 'lyric' || type === 'note') {
      wordCount += countWords(node.textContent);
      pendingChar = null;
      return;
    }

    if (type === 'character') {
      const name = node.textContent.trim().toUpperCase();
      pendingChar = name || null;
      return;
    }

    if (type === 'dialogue') {
      dialogueLineCount++;
      wordCount += countWords(node.textContent);
      if (pendingChar) {
        charLines.set(pendingChar, (charLines.get(pendingChar) || 0) + 1);
      }
      return;
    }

    if (type === 'parenthetical') {
      wordCount += countWords(node.textContent);
      return;
    }

    // dual_dialogue / dual_col — recurse into children
    if (type === 'dual_dialogue' || type === 'dual_col') {
      node.forEach(child => walk(child));
    }
  }

  doc.forEach(node => walk(node));

  // Sort characters by line count, take top 8
  const topChars = Array.from(charLines.entries())
    .map(([name, lineCount]) => ({ name, lineCount }))
    .sort((a, b) => b.lineCount - a.lineCount)
    .slice(0, 8);

  return {
    sceneCount,
    wordCount,
    dialogueLineCount,
    intCount,
    extCount,
    dayCount,
    nightCount,
    topChars,
  };
}

/**
 * Render statistics into a DOM container.
 *
 * @param {HTMLElement} container
 * @param {Node}        doc        - ProseMirror document node
 * @param {number}      pageCount  - current page count from pagination
 */
export function updateStatsPanel(container, doc, pageCount) {
  const s = extractStats(doc);
  const runtime = pageCount; // 1 page ≈ 1 minute

  container.innerHTML = `
    <div class="stats-grid">
      <div class="stats-item">
        <span class="stats-value">${pageCount}</span>
        <span class="stats-label">pages</span>
      </div>
      <div class="stats-item">
        <span class="stats-value">~${runtime} min</span>
        <span class="stats-label">est. runtime</span>
      </div>
      <div class="stats-item">
        <span class="stats-value">${s.wordCount.toLocaleString()}</span>
        <span class="stats-label">words</span>
      </div>
      <div class="stats-item">
        <span class="stats-value">${s.sceneCount}</span>
        <span class="stats-label">scenes</span>
      </div>
    </div>

    <div class="stats-section">
      <div class="stats-section-title">Scene Breakdown</div>
      <div class="stats-breakdown-row">
        <span class="stats-badge stats-badge-int">INT</span>
        <span class="stats-breakdown-count">${s.intCount}</span>
        <span class="stats-badge stats-badge-ext">EXT</span>
        <span class="stats-breakdown-count">${s.extCount}</span>
      </div>
      <div class="stats-breakdown-row">
        <span class="stats-badge stats-badge-day">DAY</span>
        <span class="stats-breakdown-count">${s.dayCount}</span>
        <span class="stats-badge stats-badge-night">NIGHT</span>
        <span class="stats-breakdown-count">${s.nightCount}</span>
      </div>
    </div>

    ${s.topChars.length > 0 ? `
    <div class="stats-section">
      <div class="stats-section-title">Top Characters</div>
      <div class="stats-char-list">
        ${s.topChars.map(c => `
          <div class="stats-char-row">
            <span class="stats-char-name">${c.name}</span>
            <div class="stats-char-bar-wrap">
              <div class="stats-char-bar" style="width:${Math.round((c.lineCount / s.topChars[0].lineCount) * 100)}%"></div>
            </div>
            <span class="stats-char-count">${c.lineCount}</span>
          </div>
        `).join('')}
      </div>
    </div>
    ` : ''}
  `;
}
