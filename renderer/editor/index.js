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
  setBlockType as setBlockTypeCmd,
  insertPageBreak as insertPageBreakCmd,
  insertLineBreak as insertLineBreakCmd,
} from './commands.js';
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
const sourceEditor   = document.getElementById('source-editor');
const editorPaper    = document.getElementById('editor-paper');
const statusFilename = document.getElementById('status-filename');
const statusAutosave = document.getElementById('status-autosave');
const statusPages    = document.getElementById('status-pages');
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
const titlePageWizardEl   = document.getElementById('title-page-wizard');
const startupModal        = document.getElementById('startup-modal');

// --- State ---
let editorView       = null;
let sourceMode       = false;
let currentFilePath  = null;
let isDirty          = false;
let lastSavedDoc     = null;
let zoomLevel        = 1.0;
let currentPageCount = 0;
let autosave         = null;  // autosave controller, set in init()

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
      history(),
      createScreenplayKeymap(screenplaySchema, {
        save: saveFile,
        saveAs: saveFileAs,
        open: openFile,
        exportFdx: exportFdx,
        toggleSourceMode: toggleSourceMode,
        resetZoom: () => {
          zoomLevel = 1.0;
          editorPaper.style.zoom = 1;
        },
      }),
      keymap(baseKeymap),
      paginationPlugin,
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

        // Scene nav
        if (sidePanel.classList.contains('is-open')) {
          updateSceneNav();
        }
      }
    },

    handlePaste(view, event) {
      const text = event.clipboardData.getData('text/plain');
      if (!text) return false;

      // Parse pasted text as Fountain and insert as proper block types
      const { doc: pastedDoc } = fountainToDoc(text, screenplaySchema);

      const tr = view.state.tr;
      const { from, to } = view.state.selection;

      // Replace selection with pasted content
      const slice = pastedDoc.slice(0, pastedDoc.content.size);
      tr.replaceRange(from, to, slice);
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
}

// ============================================================
// Element indicator
// ============================================================

function updateElementIndicator() {
  if (!editorView || sourceMode) return;
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

function updateFormatIndicators() {
  if (!editorView || sourceMode) {
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
  if (sourceMode) return;
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
  if (!editorView || sourceMode) return;
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

function toggleSidePanel() {
  const visible = sidePanel.classList.contains('is-open');
  sidePanel.classList.toggle('is-open', !visible);
  btnSceneNav.classList.toggle('active', !visible);
  if (!visible) updateSceneNav();
}

// ============================================================
// Context menu
// ============================================================

function showContextMenu(x, y) {
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
    case 'cut': {
      const { from, to } = editorView.state.selection;
      const text = editorView.state.doc.textBetween(from, to);
      try {
        await navigator.clipboard.writeText(text);
        editorView.dispatch(editorView.state.tr.deleteSelection());
      } catch {}
      break;
    }
    case 'copy': {
      const { from, to } = editorView.state.selection;
      const text = editorView.state.doc.textBetween(from, to);
      try { await navigator.clipboard.writeText(text); } catch {}
      break;
    }
    case 'paste': {
      try {
        const text = await navigator.clipboard.readText();
        editorView.dispatch(editorView.state.tr.insertText(text));
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
  }
  editorView.focus();
}

// ============================================================
// Source mode
// ============================================================

function getCurrentFountainText() {
  if (!editorView) return '';
  return docToFountain(editorView.state.doc, getTitlePageData());
}

function toggleSourceMode() {
  sourceMode = !sourceMode;

  if (sourceMode) {
    const text = getCurrentFountainText();
    wysiwygMount.style.display = 'none';
    sourceEditor.style.display = 'block';
    sourceEditor.value = text;
    sourceEditor.focus();
  } else {
    const text = sourceEditor.value;
    sourceEditor.style.display = 'none';
    wysiwygMount.style.display = 'block';

    const { doc, titlePageData } = fountainToDoc(text, screenplaySchema);
    setTitlePageData(titlePageData);
    createEditor(doc);

    refreshTitlePageInEditor(editorPaper);
    if (editorView) editorView.dispatch(editorView.state.tr);
    syncSidePanelFromData();
    editorView.focus();
    if (sidePanel.classList.contains('is-open')) updateSceneNav();
  }

  statusFilename.classList.toggle('source-mode-active', sourceMode);
}

// ============================================================
// File operations
// ============================================================

function getFountainText() {
  if (sourceMode) return sourceEditor.value;
  return getCurrentFountainText();
}

async function openFile(preloaded = null) {
  const result = preloaded || await window.screenwriterAPI.openFile();
  if (!result) return;

  // Exit source mode if active
  if (sourceMode) {
    sourceMode = false;
    sourceEditor.style.display = 'none';
    wysiwygMount.style.display = 'block';
    statusFilename.classList.remove('source-mode-active');
  }

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

  // Clean up autosave after a successful Save As
  if (autosave) await autosave.onManualSave(savedPath, previousPath);
}

async function exportFdx() {
  const text = getFountainText();
  const tokens = parseFountain(text);
  const fdxContent = tokensToFdx(tokens);
  await window.screenwriterAPI.exportFdx({ fdxContent });
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

function init() {
  // Create initial empty editor
  const { doc } = fountainToDoc('', screenplaySchema);
  createEditor(doc);

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
    if (sourceMode) return;
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
      tabScenes.style.display     = target === 'scenes'      ? 'block' : 'none';
      tabScriptInfo.style.display = target === 'script-info'  ? 'block' : 'none';
    });
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
    if (sourceMode) return;
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

  // Source editor dirty tracking + autosave trigger
  sourceEditor.addEventListener('input', () => {
    setDirty(true);
    if (autosave) autosave.notifyChange();
  });

  // --- Menu commands from main process ---
  window.screenwriterAPI.onMenuOpen(openFile);
  window.screenwriterAPI.onMenuSave(saveFile);
  window.screenwriterAPI.onMenuSaveAs(saveFileAs);
  window.screenwriterAPI.onMenuExportFdx(exportFdx);
  window.screenwriterAPI.onMenuToggleSourceMode(toggleSourceMode);
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
  }
  btnAutosaveToggle.addEventListener('mousedown', e => e.preventDefault());
  btnAutosaveToggle.addEventListener('click', () => {
    autosave.setEnabled(!autosave.isEnabled());
    updateAutosaveToggleBtn();
  });
  updateAutosaveToggleBtn();

  // Toggle autosave from View menu (also updates toolbar button)
  window.screenwriterAPI.onMenuToggleAutosave((checked) => {
    autosave.setEnabled(checked);
    updateAutosaveToggleBtn();
  });

  // Open a file passed via file-association (macOS open-file / Windows CLI arg)
  window.screenwriterAPI.onMenuOpenPath(async (filePath) => {
    const result = await window.screenwriterAPI.readFileByPath({ filePath });
    if (result) await openFile(result);
  });

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

  // Show startup modal
  showStartupModal();
}

document.addEventListener('DOMContentLoaded', init);
