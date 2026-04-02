/**
 * index.js — Editor entry point (ProseMirror-based)
 *
 * Replaces the old app.js. Creates the ProseMirror editor, wires up all UI,
 * file operations, menus, and keyboard shortcuts.
 */

import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { history, undo, redo } from 'prosemirror-history';
import { toggleMark } from 'prosemirror-commands';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap } from 'prosemirror-commands';

import { screenplaySchema, ELEMENT_LABELS } from './schema.js';
import { fountainToDoc, docToFountain } from './serializer.js';
import { createScreenplayKeymap } from './keymap.js';
import { createPaginationPlugin } from './pagination.js';
import { buildNodeViews } from './node-views.js';
import { heightRegistry } from './height-registry.js';
import {
  createFindReplacePlugin, initFindBar, setFindView,
  openFindBar, closeFindBar, findNext, findPrev, updateFindCount,
} from './find-replace.js';
import { createAutocompletePlugin } from './autocomplete.js';
import {
  setBlockType as setBlockTypeCmd,
  insertPageBreak as insertPageBreakCmd,
  insertLineBreak as insertLineBreakCmd,
} from './commands.js';
import { updateCharacterList } from './character-list.js';
import {
  createNotesPlugin, notesPluginKey,
  addNote as addNoteToEditor, deleteNote as deleteNoteFromEditor,
  editNote as editNoteInEditor, getNotes, rehydrateNotes,
} from './notes.js';
import {
  getTitlePageData, setTitlePageData, hasTitlePage,
  parseTitlePageTokens, titlePageToFountain,
  renderTitlePageContainer, refreshTitlePageInEditor,
  syncSidePanelFromData, syncDataFromSidePanel,
  showTitlePageWizard, hideTitlePageWizard, submitTitlePageWizard,
} from './title-page.js';
import { parseFountain } from '../fountain.js';
import { tokensToFdx, fdxToFountain } from '../fdx.js';
import { createAutosaveController } from './autosave.js';

// --- DOM references ---
const wysiwygMount   = document.getElementById('wysiwyg-editor');
const editorPaper    = document.getElementById('editor-paper');
const statusFilename = document.getElementById('status-filename');
const statusAutosave = document.getElementById('status-autosave');
const statusPages    = document.getElementById('status-pages');
const statusWords    = document.getElementById('status-words');
const statusScenes   = document.getElementById('status-scenes');
const btnBold        = document.getElementById('btn-bold');
const btnItalic      = document.getElementById('btn-italic');
const btnUnderline   = document.getElementById('btn-underline');
const btnUndo        = document.getElementById('btn-undo');
const btnRedo        = document.getElementById('btn-redo');
const btnThemeToggle      = document.getElementById('btn-theme-toggle');
const btnAutosaveToggle   = document.getElementById('btn-autosave-toggle');
const elementPill         = document.getElementById('element-pill');
const elementDropdown     = document.getElementById('element-dropdown');
const elementDropdownWrap = document.getElementById('element-dropdown-wrapper');
const contextMenu         = document.getElementById('context-menu');
const sidePanel           = document.getElementById('side-panel');
const sceneNavList        = document.getElementById('scene-nav-list');
const btnSceneNav         = document.getElementById('btn-scene-nav');
const tabScenes           = document.getElementById('tab-scenes');
const tabScriptInfo       = document.getElementById('tab-script-info');
const tabCharacters       = document.getElementById('tab-characters');
const characterListEl     = document.getElementById('character-list');
const tabNotes            = document.getElementById('tab-notes');
const notesListEl         = document.getElementById('notes-list');
const addNoteModal        = document.getElementById('add-note-modal');
const titlePageWizardEl   = document.getElementById('title-page-wizard');
const startupModal        = document.getElementById('startup-modal');

// --- State ---
let editorView          = null;
let charSortBy          = 'name'; // 'name' | 'scenes'
let currentFilePath     = null;
let isDirty             = false;
let lastSavedDoc        = null;
let zoomLevel           = 1.0;
let currentPageCount    = 0;
let autosave            = null;  // autosave controller, set in init()

// ============================================================
// Editor creation
// ============================================================

function createEditor(doc) {
  // Tear down existing view if any
  if (editorView) {
    editorView.destroy();
  }

  const paginationPlugin = createPaginationPlugin({
    getEditorPaper: () => editorPaper,
    hasTitlePage,
    onPageCount: (n) => {
      if (n !== currentPageCount) {
        currentPageCount = n;
        statusPages.textContent = `~${n} page${n === 1 ? '' : 's'}`;
      }
    },
  });

  const state = EditorState.create({
    doc,
    schema: screenplaySchema,
    plugins: [
      // Autocomplete must be first so its handleKeyDown (Tab/Enter/Arrow/Escape)
      // runs before the screenplay keymap consumes those keys.
      createAutocompletePlugin(),
      history(),
      createScreenplayKeymap(screenplaySchema, {
        save: saveFile,
        saveAs: saveFileAs,
        open: openFile,
        exportFdx: exportFdx,
        resetZoom: () => {
          zoomLevel = 1.0;
          editorPaper.style.zoom = 1;
        },
        find:        () => openFindBar(false),
        findReplace: () => openFindBar(true),
        addNote:     () => openAddNoteModal(),
      }),
      keymap(baseKeymap),
      paginationPlugin,
      createFindReplacePlugin({ onMatchCount: updateFindCount }),
      createNotesPlugin(),
    ],
  });

  editorView = new EditorView(wysiwygMount, {
    state,
    nodeViews: buildNodeViews(screenplaySchema, () => zoomLevel),
    dispatchTransaction(tr) {
      const newState = editorView.state.apply(tr);
      editorView.updateState(newState);

      // Update UI after every transaction
      updateElementIndicator();
      updateFormatIndicators();

      // Dirty tracking
      if (tr.docChanged) {
        const isClean = lastSavedDoc && newState.doc.eq(lastSavedDoc);
        if (!isClean && !isDirty) setDirty(true);
        else if (isClean && isDirty) setDirty(false);

        // Trigger debounced autosave on every content change
        if (autosave && !isClean) autosave.notifyChange();

        // Side panel — update active tab
        if (sidePanel.classList.contains('is-open')) {
          const activeTab = getActiveTab();
          if (activeTab === 'scenes') updateSceneNav();
          else if (activeTab === 'characters') updateCharactersPanel();
          else if (activeTab === 'notes') updateNotesPanel();
        }

        updateWordSceneCount(newState.doc);
      }
    },

    handlePaste(view, event) {
      // If the clipboard contains ProseMirror's own serialized slice, let PM
      // handle it natively — block types and inline marks are fully preserved.
      const html = event.clipboardData.getData('text/html');
      if (html && html.includes('data-pm-slice')) return false;

      // External paste (plain text, another app, etc.) — parse as Fountain so
      // pasted markup gets proper block types instead of landing as plain text.
      const text = event.clipboardData.getData('text/plain');
      if (!text) return false;

      const { doc: pastedDoc } = fountainToDoc(text, screenplaySchema);
      const tr = view.state.tr;
      const { from, to } = view.state.selection;
      tr.replaceRange(from, to, pastedDoc.slice(0, pastedDoc.content.size));
      tr.scrollIntoView();
      view.dispatch(tr);
      return true;
    },

    // Redirect clicks on non-editable elements (title page container)
    handleClickOn(view, pos, node, nodePos, event, direct) {
      return false;
    },
  });

  lastSavedDoc = doc;
  updateWordSceneCount(doc);
  setFindView(editorView);
}

// ============================================================
// Element indicator
// ============================================================

function updateElementIndicator() {
  if (!editorView) return;
  const { $from } = editorView.state.selection;
  const type = $from.parent.type.name;
  elementPill.textContent = (ELEMENT_LABELS[type] || 'Action') + ' \u25BE';
  elementDropdown.querySelectorAll('.element-dropdown-item').forEach(item => {
    item.classList.toggle('active', item.dataset.setType === type);
  });
}

// ============================================================
// Format button state
// ============================================================

function updateWordSceneCount(doc) {
  const text = doc.textBetween(0, doc.content.size, ' ');
  const words = text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
  let scenes = 0;
  doc.forEach(node => { if (node.type.name === 'scene_heading') scenes++; });
  statusWords.textContent = words.toLocaleString() + ' words';
  statusScenes.textContent = scenes + (scenes === 1 ? ' scene' : ' scenes');
}

function updateFormatIndicators() {
  if (!editorView) {
    btnBold.classList.remove('active');
    btnItalic.classList.remove('active');
    btnUnderline.classList.remove('active');
    return;
  }

  const state = editorView.state;
  const { from, $from, to, empty } = state.selection;

  function isMarkActive(markType) {
    if (empty) {
      // Check stored marks or marks at cursor
      const marks = state.storedMarks || $from.marks();
      return marks.some(m => m.type === markType);
    }
    return state.doc.rangeHasMark(from, to, markType);
  }

  btnBold.classList.toggle('active', isMarkActive(screenplaySchema.marks.bold));
  btnItalic.classList.toggle('active', isMarkActive(screenplaySchema.marks.italic));
  btnUnderline.classList.toggle('active', isMarkActive(screenplaySchema.marks.underline));
}

// ============================================================
// Element dropdown
// ============================================================

function toggleElementDropdown() {
  const visible = elementDropdown.style.display !== 'none';
  elementDropdown.style.display = visible ? 'none' : 'block';
}

function hideElementDropdown() {
  elementDropdown.style.display = 'none';
}

// ============================================================
// Scene navigation
// ============================================================

function updateSceneNav() {
  if (!editorView) return;
  const doc = editorView.state.doc;
  sceneNavList.innerHTML = '';

  const headings = [];
  doc.forEach((node, offset) => {
    if (node.type.name === 'scene_heading') {
      headings.push({ text: node.textContent.trim() || 'UNTITLED', offset });
    }
  });

  if (headings.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'scene-nav-empty';
    empty.textContent = 'No scenes yet';
    sceneNavList.appendChild(empty);
    return;
  }

  for (const h of headings) {
    const btn = document.createElement('button');
    btn.className = 'scene-nav-item';
    btn.textContent = h.text;
    btn.addEventListener('mousedown', e => e.preventDefault());
    btn.addEventListener('click', () => {
      // Set selection inside this node and scroll to it
      const tr = editorView.state.tr;
      const pos = h.offset + 1; // inside the node
      tr.setSelection(TextSelection.near(tr.doc.resolve(pos)));
      tr.scrollIntoView();
      editorView.dispatch(tr);
      editorView.focus();
    });
    sceneNavList.appendChild(btn);
  }
}

function updateCharactersPanel() {
  if (!editorView) return;
  updateCharacterList(characterListEl, editorView.state.doc, charSortBy, editorView);
}

function updateNotesPanel() {
  if (!editorView) return;
  const notes = getNotes(editorView);
  notesListEl.innerHTML = '';

  if (notes.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'notes-empty';
    empty.textContent = 'No notes yet';
    notesListEl.appendChild(empty);
    return;
  }

  for (const note of notes) {
    const item = document.createElement('div');
    item.className = 'note-item';

    const dot = document.createElement('div');
    dot.className = `note-item-dot note-item-dot-${note.color}`;

    const body = document.createElement('div');
    body.className = 'note-item-body';

    const textEl = document.createElement('div');
    textEl.className = 'note-item-text';
    textEl.textContent = note.text;

    // Show a short excerpt of the annotated text as context
    const contextEl = document.createElement('div');
    contextEl.className = 'note-item-context';
    try {
      const excerpt = editorView.state.doc.textBetween(note.from, note.to, ' ');
      contextEl.textContent = '"' + excerpt.slice(0, 50) + (excerpt.length > 50 ? '…' : '') + '"';
    } catch {}

    body.appendChild(textEl);
    body.appendChild(contextEl);

    const editBtn = document.createElement('button');
    editBtn.className = 'note-item-edit';
    editBtn.textContent = 'Edit';
    editBtn.title = 'Edit note';
    editBtn.addEventListener('mousedown', e => e.preventDefault());
    editBtn.addEventListener('click', e => {
      e.stopPropagation();
      openEditNoteModal(note);
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'note-item-delete';
    delBtn.textContent = '✕';
    delBtn.title = 'Delete note';
    delBtn.addEventListener('mousedown', e => e.preventDefault());
    delBtn.addEventListener('click', e => {
      e.stopPropagation();
      deleteNoteFromEditor(editorView, note.id);
      saveNotesSidecar();
      updateNotesPanel();
    });

    item.appendChild(dot);
    item.appendChild(body);
    item.appendChild(editBtn);
    item.appendChild(delBtn);

    // Click anywhere on the item (except buttons) to jump to position
    item.addEventListener('mousedown', e => e.preventDefault());
    item.addEventListener('click', () => {
      if (!editorView) return;
      try {
        const tr = editorView.state.tr;
        const $pos = tr.doc.resolve(Math.min(note.from, tr.doc.content.size));
        tr.setSelection(TextSelection.near($pos));
        tr.scrollIntoView();
        editorView.dispatch(tr);
        editorView.focus();
      } catch {}
    });

    notesListEl.appendChild(item);
  }
}

// ============================================================
// Notes sidecar persistence
// ============================================================

async function saveNotesSidecar() {
  if (!currentFilePath || !editorView) return;
  const notes = getNotes(editorView);
  await window.screenwriterAPI.notesWrite({ filePath: currentFilePath, notes });
}

async function loadNotesSidecar(filePath) {
  if (!filePath || !editorView) return;
  const notes = await window.screenwriterAPI.notesRead({ filePath });
  if (notes && notes.length > 0) {
    rehydrateNotes(editorView, notes);
  }
}

// ============================================================
// Add Note modal
// ============================================================

let _pendingNoteRange = null; // { from, to } for new note; null when editing
let _editingNoteId    = null; // id of note being edited; null when adding
let _selectedNoteColor = 'yellow';

function openAddNoteModal() {
  if (!editorView) return;
  const { from, to, empty } = editorView.state.selection;
  if (empty) return;

  _pendingNoteRange = { from, to };
  _editingNoteId    = null;
  _selectedNoteColor = 'yellow';

  document.getElementById('add-note-text').value = '';
  document.getElementById('add-note-submit').textContent = 'Add Note';
  addNoteModal.querySelectorAll('.note-color-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.noteColor === 'yellow');
  });

  addNoteModal.style.display = 'flex';
  setTimeout(() => document.getElementById('add-note-text').focus(), 50);
}

function openEditNoteModal(note) {
  _pendingNoteRange  = null;
  _editingNoteId     = note.id;
  _selectedNoteColor = note.color;

  document.getElementById('add-note-text').value = note.text;
  document.getElementById('add-note-submit').textContent = 'Save';
  addNoteModal.querySelectorAll('.note-color-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.noteColor === note.color);
  });

  addNoteModal.style.display = 'flex';
  setTimeout(() => document.getElementById('add-note-text').focus(), 50);
}

function closeAddNoteModal() {
  addNoteModal.style.display = 'none';
  _pendingNoteRange = null;
  _editingNoteId    = null;
  if (editorView) editorView.focus();
}

function submitAddNoteModal() {
  if (!editorView) return;
  const text = document.getElementById('add-note-text').value.trim();
  if (!text) return;

  if (_editingNoteId) {
    editNoteInEditor(editorView, _editingNoteId, text, _selectedNoteColor);
  } else if (_pendingNoteRange) {
    addNoteToEditor(editorView, _pendingNoteRange.from, _pendingNoteRange.to, text, _selectedNoteColor);
  } else {
    return;
  }

  saveNotesSidecar();
  if (sidePanel.classList.contains('is-open') && getActiveTab() === 'notes') {
    updateNotesPanel();
  }

  closeAddNoteModal();
}

function getActiveTab() {
  const active = sidePanel.querySelector('.side-panel-tab.active');
  return active ? active.dataset.tab : 'scenes';
}

function toggleSidePanel() {
  const visible = sidePanel.classList.contains('is-open');
  sidePanel.classList.toggle('is-open', !visible);
  btnSceneNav.classList.toggle('active', !visible);
  if (!visible) {
    updateSceneNav();
    updateCharactersPanel();
    updateNotesPanel();
  }
}

function toggleCharacterPanel() {
  const visible = sidePanel.classList.contains('is-open');
  const onCharTab = getActiveTab() === 'characters';

  if (visible && onCharTab) {
    // Already open on Characters tab — close the panel
    sidePanel.classList.remove('is-open');
    btnSceneNav.classList.remove('active');
    return;
  }

  // Open the panel (if not already) and switch to Characters tab
  sidePanel.classList.add('is-open');
  btnSceneNav.classList.add('active');

  sidePanel.querySelectorAll('.side-panel-tab').forEach(t => t.classList.remove('active'));
  sidePanel.querySelector('[data-tab="characters"]').classList.add('active');
  tabScenes.style.display     = 'none';
  tabCharacters.style.display = 'block';
  tabNotes.style.display      = 'none';

  updateCharactersPanel();
}

// ============================================================
// Context menu
// ============================================================

function showContextMenu(x, y) {
  // Show/hide "Add Note" based on whether text is selected
  const addNoteItem = document.getElementById('ctx-add-note');
  if (addNoteItem && editorView) {
    const hasSelection = !editorView.state.selection.empty;
    addNoteItem.style.display = hasSelection ? '' : 'none';
    addNoteItem.previousElementSibling.style.display = hasSelection ? '' : 'none'; // divider
  }

  contextMenu.style.display = 'block';
  const rect = contextMenu.getBoundingClientRect();
  const maxX = window.innerWidth - rect.width - 4;
  const maxY = window.innerHeight - rect.height - 4;
  contextMenu.style.left = Math.min(x, maxX) + 'px';
  contextMenu.style.top  = Math.min(y, maxY) + 'px';
}

function hideContextMenu() {
  contextMenu.style.display = 'none';
}

async function handleContextAction(action) {
  hideContextMenu();
  if (!editorView) return;

  switch (action) {
    case 'cut':
    case 'copy': {
      // Focus the editor and let PM's native event handler write the full
      // clipboard payload (text/html with data-pm-slice + text/plain).
      // execCommand is deprecated in web specs but fully supported in Electron.
      editorView.focus();
      document.execCommand(action);
      break;
    }
    case 'paste': {
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          const { doc: pastedDoc } = fountainToDoc(text, screenplaySchema);
          const tr = editorView.state.tr;
          const { from, to } = editorView.state.selection;
          tr.replaceRange(from, to, pastedDoc.slice(0, pastedDoc.content.size));
          tr.scrollIntoView();
          editorView.dispatch(tr);
        }
      } catch {}
      break;
    }
    case 'bold':
      toggleMark(screenplaySchema.marks.bold)(editorView.state, editorView.dispatch);
      break;
    case 'italic':
      toggleMark(screenplaySchema.marks.italic)(editorView.state, editorView.dispatch);
      break;
    case 'underline':
      toggleMark(screenplaySchema.marks.underline)(editorView.state, editorView.dispatch);
      break;
    case 'addNote':
      openAddNoteModal();
      return; // don't call editorView.focus() below — modal needs focus
  }
  editorView.focus();
}

// ============================================================
// File text helpers
// ============================================================

function getCurrentFountainText() {
  if (!editorView) return '';
  return docToFountain(editorView.state.doc, getTitlePageData());
}

// ============================================================
// File operations
// ============================================================

function getFountainText() {
  return getCurrentFountainText();
}

async function openFile(preloaded = null) {
  const result = preloaded || await window.screenwriterAPI.openFile();
  if (!result) return;

  // Always dismiss the startup modal when a file is opened, regardless of how
  // the open was triggered (menu, file association, Cmd+O while modal is up, etc.)
  startupModal.style.display = 'none';

  const isFdx = result.filePath.toLowerCase().endsWith('.fdx');
  let fountainText = isFdx ? fdxToFountain(result.content) : result.content;

  // Named files no longer use recovery files — autosave writes to the real file directly.
  // Only check recovery for untitled (FDX import treated as untitled).
  if (autosave && isFdx) {
    const recovered = await autosave.checkRecovery(null);
    if (recovered !== null) {
      fountainText = recovered;
    }
  }
  if (autosave) autosave.onFilePathChange();

  const { doc, titlePageData } = fountainToDoc(fountainText, screenplaySchema);
  setTitlePageData(titlePageData);
  createEditor(doc);

  refreshTitlePageInEditor(editorPaper);
  if (editorView) editorView.dispatch(editorView.state.tr);
  syncSidePanelFromData();

  if (isFdx) {
    // FDX import: treat as unsaved Fountain — don't bind currentFilePath to the .fdx path
    currentFilePath = null;
    setDirty(false);
    statusFilename.textContent = 'untitled.fountain';
    window.screenwriterAPI.setTitle({ title: 'untitled.fountain \u2014 OpenScreenwriter' });
  } else {
    currentFilePath = result.filePath;
    setCurrentFile(result.filePath);
    isDirty = false;
    addRecentFile(result.filePath);
  }

  // Load notes sidecar for named (non-FDX) files
  if (!isFdx && result.filePath) {
    await loadNotesSidecar(result.filePath);
  }

  editorView.focus();
  if (sidePanel.classList.contains('is-open')) updateSceneNav();
}

async function saveFile() {
  const content = getFountainText();
  const previousPath = currentFilePath;
  const savedPath = await window.screenwriterAPI.saveFile({
    content,
    filePath: currentFilePath,
  });
  if (!savedPath) return;

  if (editorView) lastSavedDoc = editorView.state.doc;
  setCurrentFile(savedPath);
  currentFilePath = savedPath;
  setDirty(false);
  addRecentFile(savedPath);

  // Save notes alongside the document
  await saveNotesSidecar();

  // Clean up autosave after a successful manual save
  if (autosave) await autosave.onManualSave(savedPath, previousPath);
}

async function saveFileAs() {
  const content = getFountainText();
  const previousPath = currentFilePath;
  const savedPath = await window.screenwriterAPI.saveFileAs({ content });
  if (!savedPath) return;

  if (editorView) lastSavedDoc = editorView.state.doc;
  setCurrentFile(savedPath);
  currentFilePath = savedPath;
  setDirty(false);
  addRecentFile(savedPath);

  // Save notes alongside the document
  await saveNotesSidecar();

  // Clean up autosave after a successful Save As
  if (autosave) await autosave.onManualSave(savedPath, previousPath);
}

async function exportFdx() {
  const text = getFountainText();
  const tokens = parseFountain(text);
  const fdxContent = tokensToFdx(tokens);
  await window.screenwriterAPI.exportFdx({ fdxContent });
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inlineMarksToHtml(node) {
  if (node.isText) {
    let text = escapeHtml(node.text);
    node.marks.forEach(mark => {
      if (mark.type.name === 'bold')      text = `<strong>${text}</strong>`;
      if (mark.type.name === 'italic')    text = `<em>${text}</em>`;
      if (mark.type.name === 'underline') text = `<u>${text}</u>`;
    });
    return text;
  }
  let inner = '';
  node.forEach(child => { inner += inlineMarksToHtml(child); });
  return inner;
}

function generatePrintHtml() {
  const doc = editorView.state.doc;
  const tpData = getTitlePageData();
  const hasTP = hasTitlePage();

  // Block type → CSS class mapping (matches style.css definitions)
  const blockClass = {
    scene_heading: 'scene-heading',
    action:        'action',
    character:     'character',
    dialogue:      'dialogue',
    parenthetical: 'parenthetical',
    transition:    'transition',
    centered:      'centered',
    lyric:         'lyric',
    note:          'note',
  };

  let body = '';
  doc.forEach(node => {
    const type = node.type.name;
    if (type === 'page_break') {
      body += '<div class="page-break"></div>\n';
      return;
    }
    if (type === 'title_page' || type === 'title_page_block') return; // skip title page nodes
    const cls = blockClass[type] || 'action';
    const inner = inlineMarksToHtml(node) || '&nbsp;';
    body += `<p class="${cls}">${inner}</p>\n`;
  });

  // Build title page HTML block (only when title page data is present)
  let titlePageHtml = '';
  if (hasTP) {
    const esc = (s) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const title      = esc(tpData.title);
    const credit     = esc(tpData.credit);
    const author     = esc(tpData.author);
    const source     = esc(tpData.source);
    const draftDate  = esc(tpData.draftDate);
    const contact    = esc(tpData.contact);
    const contactPos = tpData.contactPosition === 'right' ? 'right' : 'left';

    titlePageHtml =
`<div class="title-page">
  <div class="tp-top-gap"></div>
  <div class="tp-center">
    <div class="tp-title">${title}</div>
    ${credit ? `<div class="tp-credit">${credit}</div>` : ''}
    ${author ? `<div class="tp-author">by\n${author}</div>` : ''}
    ${source ? `<div class="tp-source">${source}</div>` : ''}
  </div>
  <div class="tp-mid-gap"></div>
  ${(contact || draftDate) ? `<div class="tp-contact tp-contact-${contactPos}">${contact ? `<div>${contact.replace(/\n/g, '<br>')}</div>` : ''}${draftDate ? `<div>${draftDate}</div>` : ''}</div>` : ''}
</div>\n`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
/* Page setup — explicit margins so all pages are identical; page numbers via
   CSS @page margin boxes; title page unnumbered via @page :first */
@page {
  size: letter;
  margin: 1in 1in 1in 1.5in;
  @top-right {
    content: counter(page) ".";
    font-family: 'Courier New', Courier, monospace;
    font-size: 12pt;
  }
}
@page :first {
  @top-right { content: none; }
}

/* Base */
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: 'Courier New', Courier, monospace;
  font-size: 12pt;
  line-height: 1.0;
  color: #000;
  background: #fff;
}

/* All blocks share vertical spacing — no first-child exception,
   matching the WYSIWYG where the page-number widget precedes content */
p { margin-top: 1em; }

/* Block types */
.scene-heading {
  text-transform: uppercase;
  text-decoration: underline;
  break-after: avoid;   /* keep heading with its first action line */
  break-before: auto;
}
.action {
  orphans: 2;
  widows: 2;
}
.character {
  margin-left: 2.2in;
  text-transform: uppercase;
  break-after: avoid;   /* keep character name with dialogue/parenthetical */
  break-before: avoid-page;
}
.dialogue {
  margin-left: 1.0in;
  margin-right: 1.5in;
  orphans: 2;
  widows: 2;
}
.parenthetical {
  margin-left: 1.6in;
  margin-right: 1.5in;
  break-after: avoid;   /* keep parenthetical with following dialogue */
  break-before: avoid-page;
}
.transition {
  text-align: right;
  font-style: italic;
}
.centered { text-align: center; }
.lyric { font-style: italic; }
.note { color: #666; }

/* Manual page break */
.page-break { page-break-before: always; }

/* Title page layout — flexbox so dimensions are reliable in print context */
.title-page {
  display: flex;
  flex-direction: column;
  height: 9in;       /* @page margin is 1in top + 1in bottom; content area = 9in */
  page-break-after: always;
}
.tp-top-gap  { flex: 0 0 3.6in; }   /* 40% of 9in pushes title to ~40% down */
.tp-center   { flex: 0 0 auto; text-align: center; }
.tp-mid-gap  { flex: 1 1 auto; }    /* remaining space before contact */
.tp-title    { font-size: 12pt; text-transform: uppercase; margin-bottom: 1em; }
.tp-credit   { font-size: 12pt; margin-bottom: 0.25em; }
.tp-author   { font-size: 12pt; white-space: pre-line; }
.tp-source   { font-size: 12pt; margin-top: 1em; }
.tp-contact  { flex: 0 0 auto; font-size: 12pt; line-height: 1.5; }
.tp-contact-left  { text-align: left;  }
.tp-contact-right { text-align: right; }
${document.body.classList.contains('scene-numbers-on') ? `
/* Scene numbers */
body { counter-reset: scene-num; }
.scene-heading { counter-increment: scene-num; position: relative; }
.scene-heading::before {
  content: counter(scene-num);
  position: absolute;
  left: -1.15in;
  font-family: 'Courier New', Courier, monospace;
  font-size: 12pt;
  font-weight: normal;
  text-decoration: none;
}
` : ''}
</style>
</head>
<body>
${titlePageHtml}${body}
</body>
</html>`;
}

async function exportPdf() {
  const html = generatePrintHtml();
  await window.screenwriterAPI.exportPdf({ html });
}

function printScript() {
  const html = generatePrintHtml();
  // Use a hidden iframe so the native print dialog opens in the current window
  // context (reliable on all platforms) rather than a background BrowserWindow.
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:0;height:0;border:none;';
  document.body.appendChild(iframe);
  const cleanup = () => { try { document.body.removeChild(iframe); } catch {} };
  iframe.addEventListener('load', () => {
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } finally {
      // Small delay so the print dialog can fully initialise before we remove the iframe
      setTimeout(cleanup, 1000);
    }
  });
  const blob = new Blob([html], { type: 'text/html' });
  iframe.src = URL.createObjectURL(blob);
}

// ============================================================
// Recent files
// ============================================================

const RECENT_MAX = 5;
const RECENT_KEY = 'recentFiles';

function getRecentFiles() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; }
}

function addRecentFile(filePath) {
  if (!filePath) return;
  let recents = getRecentFiles().filter(p => p !== filePath);
  recents.unshift(filePath);
  if (recents.length > RECENT_MAX) recents = recents.slice(0, RECENT_MAX);
  localStorage.setItem(RECENT_KEY, JSON.stringify(recents));
}

function removeRecentFile(filePath) {
  const recents = getRecentFiles().filter(p => p !== filePath);
  localStorage.setItem(RECENT_KEY, JSON.stringify(recents));
}

function renderRecentFiles() {
  const section = document.getElementById('startup-recent-section');
  const list    = document.getElementById('startup-recent-list');
  if (!section || !list) return;

  const recents = getRecentFiles();
  section.style.display = recents.length ? '' : 'none';
  list.innerHTML = '';

  for (const filePath of recents) {
    const parts    = filePath.replace(/\\/g, '/').split('/');
    const name     = parts.pop();
    const dir      = parts.join('/') || '/';

    const btn = document.createElement('button');
    btn.className = 'startup-recent-item';
    btn.title     = filePath;

    const nameEl = document.createElement('span');
    nameEl.className   = 'startup-recent-name';
    nameEl.textContent = name;

    const dirEl = document.createElement('span');
    dirEl.className   = 'startup-recent-dir';
    dirEl.textContent = dir;

    btn.appendChild(nameEl);
    btn.appendChild(dirEl);

    btn.addEventListener('click', async () => {
      const result = await window.screenwriterAPI.readFileByPath({ filePath });
      if (!result) {
        removeRecentFile(filePath);
        renderRecentFiles();
        return;
      }
      await openFile(result);
    });

    list.appendChild(btn);
  }
}

// ============================================================
// Dirty state & title
// ============================================================

function setDirty(dirty) {
  isDirty = dirty;
  const name = currentFilePath
    ? currentFilePath.split(/[\\/]/).pop()
    : 'untitled.fountain';

  if (dirty) {
    statusFilename.textContent = `${name} \u25CF`;
    statusFilename.classList.add('dirty');
  } else {
    statusFilename.textContent = name;
    statusFilename.classList.remove('dirty');
  }

  const prefix = dirty ? '\u25CF ' : '';
  window.screenwriterAPI.setTitle({ title: `${prefix}${name} \u2014 OpenScreenwriter` });
  window.screenwriterAPI.notifyDirtyState(dirty);
}

function setCurrentFile(filePath) {
  currentFilePath = filePath;
  const name = filePath.split(/[\\/]/).pop();
  statusFilename.textContent = name;
  statusFilename.classList.remove('dirty');
  window.screenwriterAPI.setTitle({ title: `${name} \u2014 OpenScreenwriter` });
}

// ============================================================
// Theme
// ============================================================

function updateThemeBtn() {
  const theme = document.body.getAttribute('data-theme') || 'dark';
  btnThemeToggle.textContent = theme === 'dark' ? '\u2600' : '\u263E';
}

function applyTheme(theme) {
  document.body.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
  updateThemeBtn();
}

// ============================================================
// Startup modal
// ============================================================

function showStartupModal() {
  const savedTheme = localStorage.getItem('theme') || 'dark';
  applyTheme(savedTheme);

  startupModal.querySelectorAll('[data-theme-btn]').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.themeBtn === savedTheme);
  });

  renderRecentFiles();
  startupModal.style.display = 'flex';
}

function dismissStartup(action) {
  startupModal.style.display = 'none';
  if (action === 'open') {
    openFile();
  }
  if (editorView) editorView.focus();
}

// ============================================================
// Zoom
// ============================================================

window.addEventListener('resize', () => {
  // ResizeObservers on NodeViews fire automatically when text reflows.
  // Invalidate margin cache in case window resize changes computed styles.
  heightRegistry.invalidateMarginCache();
});

document.addEventListener('wheel', e => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  zoomLevel += e.deltaY < 0 ? 0.1 : -0.1;
  zoomLevel = Math.max(0.5, Math.min(2.5, Math.round(zoomLevel * 10) / 10));
  editorPaper.style.zoom = zoomLevel;
}, { passive: false });

// ============================================================
// Init
// ============================================================

async function init() {
  // Create initial empty editor
  const { doc } = fountainToDoc('', screenplaySchema);
  createEditor(doc);

  // Initialize find bar UI
  initFindBar();

  // --- Format buttons ---
  [btnBold, btnItalic, btnUnderline].forEach(btn => {
    btn.addEventListener('mousedown', e => e.preventDefault());
  });
  btnBold.addEventListener('click', () => {
    toggleMark(screenplaySchema.marks.bold)(editorView.state, editorView.dispatch);
    editorView.focus();
  });
  btnItalic.addEventListener('click', () => {
    toggleMark(screenplaySchema.marks.italic)(editorView.state, editorView.dispatch);
    editorView.focus();
  });
  btnUnderline.addEventListener('click', () => {
    toggleMark(screenplaySchema.marks.underline)(editorView.state, editorView.dispatch);
    editorView.focus();
  });

  // --- Undo / Redo buttons ---
  [btnUndo, btnRedo].forEach(btn => btn.addEventListener('mousedown', e => e.preventDefault()));
  btnUndo.addEventListener('click', () => {
    undo(editorView.state, editorView.dispatch);
    editorView.focus();
  });
  btnRedo.addEventListener('click', () => {
    redo(editorView.state, editorView.dispatch);
    editorView.focus();
  });

  // --- Theme toggle ---
  btnThemeToggle.addEventListener('mousedown', e => e.preventDefault());
  btnThemeToggle.addEventListener('click', () => {
    const next = (document.body.getAttribute('data-theme') === 'dark') ? 'light' : 'dark';
    applyTheme(next);
    startupModal.querySelectorAll('[data-theme-btn]').forEach(b =>
      b.classList.toggle('selected', b.dataset.themeBtn === next)
    );
  });

  // --- Element dropdown ---
  elementPill.addEventListener('mousedown', e => e.preventDefault());
  elementPill.addEventListener('click', toggleElementDropdown);
  elementDropdown.querySelectorAll('.element-dropdown-item').forEach(item => {
    item.addEventListener('mousedown', e => e.preventDefault());
    item.addEventListener('click', () => {
      const cmd = setBlockTypeCmd(item.dataset.setType);
      cmd(editorView.state, editorView.dispatch);
      hideElementDropdown();
      editorView.focus();
    });
  });

  // --- Context menu ---
  wysiwygMount.addEventListener('contextmenu', e => {
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY);
  });
  contextMenu.querySelectorAll('.context-menu-item').forEach(item => {
    item.addEventListener('mousedown', e => e.preventDefault());
    item.addEventListener('click', () => handleContextAction(item.dataset.action));
  });

  // --- Side panel ---
  btnSceneNav.addEventListener('mousedown', e => e.preventDefault());
  btnSceneNav.addEventListener('click', toggleSidePanel);

  // Tab switching
  sidePanel.querySelectorAll('.side-panel-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      sidePanel.querySelectorAll('.side-panel-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.tab;
      tabScenes.style.display     = target === 'scenes'     ? 'block' : 'none';
      tabCharacters.style.display = target === 'characters' ? 'block' : 'none';
      tabNotes.style.display      = target === 'notes'      ? 'block' : 'none';
      if (target === 'characters') updateCharactersPanel();
      if (target === 'notes') updateNotesPanel();
    });
  });

  // Character list sort buttons
  tabCharacters.querySelectorAll('.char-sort-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      tabCharacters.querySelectorAll('.char-sort-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      charSortBy = btn.dataset.sort;
      updateCharactersPanel();
    });
  });

  // Script Info footer button — toggles the drawer below the panel footer
  const btnScriptInfo = document.getElementById('btn-script-info');
  btnScriptInfo.addEventListener('mousedown', e => e.preventDefault());
  btnScriptInfo.addEventListener('click', () => {
    const open = tabScriptInfo.classList.contains('is-open');
    tabScriptInfo.classList.toggle('is-open', !open);
    btnScriptInfo.classList.toggle('active', !open);
  });

  // Script Info field inputs → update title page
  ['sp-title', 'sp-credit', 'sp-author', 'sp-source', 'sp-draft-date', 'sp-contact'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
      syncDataFromSidePanel();
      refreshTitlePageInEditor(editorPaper);
      if (editorView) editorView.dispatch(editorView.state.tr);
      setDirty(true);
    });
  });

  // Contact position toggle in side panel
  tabScriptInfo.querySelectorAll('.sp-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      tabScriptInfo.querySelectorAll('.sp-toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const data = getTitlePageData();
      data.contactPosition = btn.dataset.pos;
      setTitlePageData(data);
      refreshTitlePageInEditor(editorPaper);
      if (editorView) editorView.dispatch(editorView.state.tr);
      setDirty(true);
    });
  });

  // Delete title page button
  document.getElementById('sp-delete-title-page').addEventListener('click', () => {
    setTitlePageData({ title: '', credit: '', author: '', source: '', draftDate: '', contact: '', contactPosition: 'left' });
    refreshTitlePageInEditor(editorPaper);
    if (editorView) editorView.dispatch(editorView.state.tr);
    syncSidePanelFromData();
    setDirty(true);
  });

  // --- Title page wizard ---
  document.getElementById('tp-wiz-cancel').addEventListener('click', () => {
    hideTitlePageWizard(editorView?.dom);
  });
  document.getElementById('tp-wiz-submit').addEventListener('click', () => {
    if (submitTitlePageWizard()) {
      hideTitlePageWizard(editorView?.dom);
      refreshTitlePageInEditor(editorPaper);
      if (editorView) editorView.dispatch(editorView.state.tr);
      syncSidePanelFromData();
      setDirty(true);
    }
  });

  // Wizard contact position toggles
  [document.getElementById('tp-wiz-pos-left'), document.getElementById('tp-wiz-pos-right')].forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('tp-wiz-pos-left').classList.toggle('active', btn.dataset.pos === 'left');
      document.getElementById('tp-wiz-pos-right').classList.toggle('active', btn.dataset.pos === 'right');
    });
  });

  // --- Close overlays ---
  document.addEventListener('mousedown', e => {
    if (!elementDropdownWrap.contains(e.target)) hideElementDropdown();
    if (!contextMenu.contains(e.target)) hideContextMenu();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      hideElementDropdown();
      hideContextMenu();
      if (addNoteModal.style.display !== 'none') {
        closeAddNoteModal();
        return;
      }
      if (titlePageWizardEl.style.display !== 'none') {
        hideTitlePageWizard(editorView?.dom);
      }
      const aboutModal = document.getElementById('about-modal');
      if (aboutModal && aboutModal.style.display !== 'none') {
        aboutModal.style.display = 'none';
      }
    }
  });

  // --- Focus lock — clicking paper margins refocuses ProseMirror ---
  document.getElementById('editor-pane').addEventListener('mousedown', e => {
    if (sidePanel.contains(e.target)) return;
    if (editorView && !editorView.dom.contains(e.target)) {
      // Don't prevent default on title page container clicks
      const tpContainer = editorPaper.querySelector('.ws-title-page-container');
      if (tpContainer && tpContainer.contains(e.target)) {
        e.preventDefault();
        editorView.focus();
        return;
      }
      e.preventDefault();
      editorView.focus();
    }
  });

  // --- Menu commands from main process ---
  window.screenwriterAPI.onMenuOpen(openFile);
  window.screenwriterAPI.onMenuSave(saveFile);
  window.screenwriterAPI.onMenuSaveAs(saveFileAs);
  window.screenwriterAPI.onMenuExportFdx(exportFdx);
  window.screenwriterAPI.onMenuExportPdf(exportPdf);
  window.screenwriterAPI.onMenuPrint(printScript);
  window.screenwriterAPI.onMenuToggleSidePanel(toggleSidePanel);
  window.screenwriterAPI.onMenuInsertTitlePage(showTitlePageWizard);
  window.screenwriterAPI.onMenuInsertPageBreak(() => {
    if (editorView) {
      insertPageBreakCmd(editorView.state, editorView.dispatch);
      editorView.focus();
    }
  });
  window.screenwriterAPI.onMenuInsertLineBreak(() => {
    if (editorView) {
      insertLineBreakCmd(editorView.state, editorView.dispatch);
      editorView.focus();
    }
  });
  window.screenwriterAPI.onMenuAddNote(() => openAddNoteModal());

  // --- Notes panel button ---
  document.getElementById('btn-add-note').addEventListener('mousedown', e => e.preventDefault());
  document.getElementById('btn-add-note').addEventListener('click', () => openAddNoteModal());

  // --- Add Note modal ---
  addNoteModal.querySelectorAll('.note-color-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      addNoteModal.querySelectorAll('.note-color-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _selectedNoteColor = btn.dataset.noteColor;
    });
  });
  document.getElementById('add-note-cancel').addEventListener('click', closeAddNoteModal);
  document.getElementById('add-note-submit').addEventListener('click', submitAddNoteModal);
  document.getElementById('add-note-text').addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submitAddNoteModal();
    }
    if (e.key === 'Escape') {
      closeAddNoteModal();
    }
  });
  addNoteModal.addEventListener('mousedown', e => {
    if (e.target === addNoteModal) closeAddNoteModal();
  });

  window.screenwriterAPI.onMenuAbout(async () => {
    const version = await window.screenwriterAPI.getVersion();
    document.getElementById('about-version').textContent = `v${version}`;
    document.getElementById('about-modal').style.display = 'flex';
  });

  // --- About modal ---
  document.getElementById('about-close').addEventListener('click', () => {
    document.getElementById('about-modal').style.display = 'none';
  });
  document.getElementById('about-modal').addEventListener('mousedown', e => {
    if (e.target === document.getElementById('about-modal')) {
      document.getElementById('about-modal').style.display = 'none';
    }
  });
  document.getElementById('about-github-link').addEventListener('click', e => {
    e.preventDefault();
    window.screenwriterAPI.openExternal('https://github.com/mitchrnet/openscreenwriter');
  });

  // --- Startup modal ---
  startupModal.querySelectorAll('[data-theme-btn]').forEach(btn => {
    btn.addEventListener('click', () => {
      const theme = btn.dataset.themeBtn;
      applyTheme(theme);
      startupModal.querySelectorAll('[data-theme-btn]').forEach(b =>
        b.classList.toggle('selected', b === btn)
      );
    });
  });
  document.getElementById('startup-new').addEventListener('click', () => dismissStartup('new'));
  document.getElementById('startup-open').addEventListener('click', () => dismissStartup('open'));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && startupModal.style.display !== 'none') {
      dismissStartup('new');
    }
  });

  // --- Autosave ---
  autosave = createAutosaveController({
    getContent:  getFountainText,
    getFilePath: () => currentFilePath,
    indicatorEl: statusAutosave,
  });

  // On clean quit, remove the untitled recovery file so we don't offer recovery next launch.
  // Named files don't need cleanup — the last autosave IS the current file on disk.
  window.addEventListener('beforeunload', () => {
    autosave.cleanQuit();
    autosave.stop();
  });

  // Autosave toolbar toggle button
  function updateAutosaveToggleBtn() {
    const on = autosave.isEnabled();
    btnAutosaveToggle.classList.toggle('active', on);
    btnAutosaveToggle.title = on ? 'Autosave: On (click to disable)' : 'Autosave: Off (click to enable)';
    btnAutosaveToggle.innerHTML = `Autosave <span class="autosave-status ${on ? 'on' : 'off'}">${on ? 'ON' : 'OFF'}</span>`;
  }
  btnAutosaveToggle.addEventListener('mousedown', e => e.preventDefault());
  btnAutosaveToggle.addEventListener('click', () => {
    autosave.setEnabled(!autosave.isEnabled());
    updateAutosaveToggleBtn();
    window.screenwriterAPI.notifyAutosaveState(autosave.isEnabled());
  });
  updateAutosaveToggleBtn();

  // Toggle autosave from View menu (also updates toolbar button)
  window.screenwriterAPI.onMenuToggleAutosave((checked) => {
    autosave.setEnabled(checked);
    updateAutosaveToggleBtn();
    window.screenwriterAPI.notifyAutosaveState(checked);
  });

  // Scene numbers — restore from localStorage, then listen for menu toggle
  const sceneNumbersKey = 'sceneNumbers';
  function applySceneNumbers(on) {
    document.body.classList.toggle('scene-numbers-on', on);
    localStorage.setItem(sceneNumbersKey, String(on));
    window.screenwriterAPI.notifySceneNumbersState(on);
  }
  applySceneNumbers(localStorage.getItem(sceneNumbersKey) === 'true');
  window.screenwriterAPI.onMenuToggleSceneNumbers((checked) => applySceneNumbers(checked));

  // Save-then-close: main process asks us to save before the window closes
  window.screenwriterAPI.onSaveAndClose(async () => {
    await saveFile();
    window.screenwriterAPI.notifyReadyToClose();
  });

  // Open a file passed via file-association (macOS open-file / Windows CLI arg)
  window.screenwriterAPI.onMenuOpenPath(async (filePath) => {
    const result = await window.screenwriterAPI.readFileByPath({ filePath });
    if (result) await openFile(result);
  });

  // Check if the app was launched via file association (double-click in Finder/Explorer).
  // If so, open the file directly and skip the startup modal.
  const pendingFile = await window.screenwriterAPI.getPendingFile();
  if (pendingFile) {
    const result = await window.screenwriterAPI.readFileByPath({ filePath: pendingFile });
    if (result) {
      await openFile(result);
      return; // startup modal stays hidden
    }
  }

  // Check for a recovery on startup (for untitled / no file open yet)
  // This runs after the startup modal so the editor is ready.
  // We defer slightly to let the startup modal appear first.
  setTimeout(async () => {
    if (startupModal.style.display !== 'none') return; // let startup modal handle it
    const recovered = await autosave.checkRecovery(null);
    if (recovered !== null) {
      const { doc, titlePageData } = fountainToDoc(recovered, screenplaySchema);
      setTitlePageData(titlePageData);
      createEditor(doc);
      refreshTitlePageInEditor(editorPaper);
      if (editorView) editorView.dispatch(editorView.state.tr);
      syncSidePanelFromData();
      setDirty(true);
    }
  }, 500);

  // Show startup modal (normal launch — no file specified)
  showStartupModal();
}

document.addEventListener('DOMContentLoaded', () => init());
