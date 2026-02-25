/**
 * title-page.js — Title page data model, wizard, and side panel sync
 *
 * Extracted from the old app.js. The title page is rendered outside
 * ProseMirror as a non-editable container above the editor mount point.
 */

// --- State ---
let titlePageData = {
  title: '', credit: '', author: '',
  source: '', draftDate: '', contact: '',
  contactPosition: 'left',
};

// --- Accessors ---

export function getTitlePageData() {
  return titlePageData;
}

export function setTitlePageData(data) {
  titlePageData = { ...titlePageData, ...data };
}

export function hasTitlePage() {
  return titlePageData.title.trim() !== '';
}

// --- Title page key mapping ---

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
 * Parse title page tokens from parseFountain() output into the data model.
 */
export function parseTitlePageTokens(tokens) {
  titlePageData = {
    title: '', credit: '', author: '',
    source: '', draftDate: '', contact: '',
    contactPosition: 'left',
  };
  for (const t of tokens) {
    if (t.type !== 'title_page') continue;
    const match = /^([^:]+):\s*(.*)$/.exec(t.text);
    if (!match) continue;
    const key = match[1].trim().toLowerCase();
    const val = match[2].trim();
    const field = TP_KEY_MAP[key];
    if (field) titlePageData[field] = val;
  }
}

/**
 * Serialize title page data to Fountain text block.
 */
export function titlePageToFountain() {
  const lines = [];
  if (titlePageData.title)     lines.push(`Title: ${titlePageData.title}`);
  if (titlePageData.credit)    lines.push(`Credit: ${titlePageData.credit}`);
  if (titlePageData.author)    lines.push(`Author: ${titlePageData.author}`);
  if (titlePageData.source)    lines.push(`Source: ${titlePageData.source}`);
  if (titlePageData.draftDate) lines.push(`Draft date: ${titlePageData.draftDate}`);
  if (titlePageData.contact)   lines.push(`Contact: ${titlePageData.contact}`);
  if (titlePageData.contactPosition && titlePageData.contactPosition !== 'left')
    lines.push(`Contact position: ${titlePageData.contactPosition}`);
  if (lines.length === 0) return '';
  return lines.join('\n') + '\n\n';
}

/**
 * Render the title page as a non-editable DOM container.
 */
export function renderTitlePageContainer() {
  const container = document.createElement('div');
  container.className = 'ws-block ws-title-page-container';
  container.contentEditable = 'false';

  if (titlePageData.title) {
    const el = document.createElement('div');
    el.className = 'ws-tp-title';
    el.textContent = titlePageData.title;
    container.appendChild(el);
  }
  if (titlePageData.credit) {
    const el = document.createElement('div');
    el.className = 'ws-tp-credit';
    el.textContent = titlePageData.credit;
    container.appendChild(el);
  }
  if (titlePageData.author) {
    const el = document.createElement('div');
    el.className = 'ws-tp-author';
    el.textContent = titlePageData.author;
    container.appendChild(el);
  }
  if (titlePageData.source) {
    const el = document.createElement('div');
    el.className = 'ws-tp-source';
    el.textContent = titlePageData.source;
    container.appendChild(el);
  }
  if (titlePageData.draftDate) {
    const el = document.createElement('div');
    el.className = 'ws-tp-draft-date';
    el.textContent = titlePageData.draftDate;
    container.appendChild(el);
  }
  if (titlePageData.contact) {
    const el = document.createElement('div');
    el.className = `ws-tp-contact ${titlePageData.contactPosition || 'left'}`;
    el.textContent = titlePageData.contact;
    container.appendChild(el);
  }

  return container;
}

/**
 * Refresh the title page container in the editor DOM.
 * Called when title page data changes.
 */
export function refreshTitlePageInEditor(editorMount) {
  const existing = editorMount.querySelector('.ws-title-page-container');
  if (existing) existing.remove();

  if (hasTitlePage()) {
    const container = renderTitlePageContainer();
    editorMount.insertBefore(container, editorMount.firstChild);
  }
}

// --- Side panel sync ---

export function syncSidePanelFromData() {
  document.getElementById('sp-title').value      = titlePageData.title;
  document.getElementById('sp-credit').value      = titlePageData.credit;
  document.getElementById('sp-author').value      = titlePageData.author;
  document.getElementById('sp-source').value      = titlePageData.source;
  document.getElementById('sp-draft-date').value  = titlePageData.draftDate;
  document.getElementById('sp-contact').value     = titlePageData.contact;

  const pos = titlePageData.contactPosition || 'left';
  const tabScriptInfo = document.getElementById('tab-script-info');
  tabScriptInfo.querySelectorAll('.sp-toggle-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.pos === pos);
  });
}

export function syncDataFromSidePanel() {
  titlePageData.title     = document.getElementById('sp-title').value.trim();
  titlePageData.credit    = document.getElementById('sp-credit').value.trim();
  titlePageData.author    = document.getElementById('sp-author').value.trim();
  titlePageData.source    = document.getElementById('sp-source').value.trim();
  titlePageData.draftDate = document.getElementById('sp-draft-date').value.trim();
  titlePageData.contact   = document.getElementById('sp-contact').value.trim();
}

// --- Title page wizard ---

export function showTitlePageWizard() {
  const wiz = document.getElementById('title-page-wizard');
  document.getElementById('tp-wiz-title').value      = titlePageData.title;
  document.getElementById('tp-wiz-credit').value      = titlePageData.credit || 'Written by';
  document.getElementById('tp-wiz-author').value      = titlePageData.author;
  document.getElementById('tp-wiz-source').value      = titlePageData.source;
  document.getElementById('tp-wiz-draft-date').value  = titlePageData.draftDate;
  document.getElementById('tp-wiz-contact').value     = titlePageData.contact;

  const pos = titlePageData.contactPosition || 'left';
  document.getElementById('tp-wiz-pos-left').classList.toggle('active', pos === 'left');
  document.getElementById('tp-wiz-pos-right').classList.toggle('active', pos === 'right');

  document.getElementById('tp-wiz-submit').textContent =
    hasTitlePage() ? 'Update Title Page' : 'Insert Title Page';

  wiz.style.display = 'flex';
  document.getElementById('tp-wiz-title').focus();
}

export function hideTitlePageWizard(focusTarget) {
  document.getElementById('title-page-wizard').style.display = 'none';
  if (focusTarget) focusTarget.focus();
}

/**
 * Submit the wizard form. Returns true if successful.
 * Caller should handle refreshing the editor and marking dirty.
 */
export function submitTitlePageWizard() {
  const title = document.getElementById('tp-wiz-title').value.trim();
  if (!title) {
    document.getElementById('tp-wiz-title').focus();
    return false;
  }

  titlePageData.title     = title;
  titlePageData.credit    = document.getElementById('tp-wiz-credit').value.trim();
  titlePageData.author    = document.getElementById('tp-wiz-author').value.trim();
  titlePageData.source    = document.getElementById('tp-wiz-source').value.trim();
  titlePageData.draftDate = document.getElementById('tp-wiz-draft-date').value.trim();
  titlePageData.contact   = document.getElementById('tp-wiz-contact').value.trim();

  const posLeft = document.getElementById('tp-wiz-pos-left');
  titlePageData.contactPosition = posLeft.classList.contains('active') ? 'left' : 'right';

  return true;
}
