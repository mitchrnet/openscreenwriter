'use strict';

const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');

// Must be set before app.whenReady() so the macOS menu bar shows the correct name
app.setName('OpenScreenwriter');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

// Per-window state
const filePathByWindow        = new Map(); // windowId → current file path (or null)
const windowFileToOpen        = new Map(); // windowId → file path to pass to renderer on first init
const dirtyByWindow           = new Map(); // windowId → bool (unsaved changes)
const autosaveEnabledByWindow = new Map(); // windowId → bool (autosave on/off)
const closingBypass           = new Set(); // windowIds that should skip the close dialog

let pendingFilePath = null; // set by open-file before any window exists

// ─── File-association event handling ────────────────────────────────────────

// Must be registered before app.whenReady() to catch early macOS open-file events
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  if (app.isReady()) {
    // App already running — always open in a new window so the existing document is safe
    createWindow(filePath);
  } else {
    // Cold launch — store for first window to pick up via getPendingFile IPC
    pendingFilePath = filePath;
  }
});

/**
 * On Windows, a file opened via file-association is passed as a CLI argument.
 * Returns the first .fountain arg, or null.
 */
function getArgFilePath() {
  if (process.platform === 'darwin') return null;
  const args = process.argv.slice(app.isPackaged ? 1 : 2);
  return args.find(a => !a.startsWith('-') && /\.fountain$/i.test(a)) || null;
}

// ─── Per-window helpers ──────────────────────────────────────────────────────

function getWin(event) {
  return BrowserWindow.fromWebContents(event.sender);
}

function getFocusedWin() {
  return BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
}

function getFilePath(win) {
  return filePathByWindow.get(win.id) ?? null;
}

function setFilePath(win, filePath) {
  filePathByWindow.set(win.id, filePath);
}

// ─── Autosave helpers ────────────────────────────────────────────────────────

function getAutosaveDir() {
  const dir = path.join(app.getPath('userData'), 'autosave');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function autosavePathFor(filePath) {
  const key = filePath
    ? crypto.createHash('sha1').update(filePath).digest('hex')
    : 'untitled';
  return path.join(getAutosaveDir(), `${key}.fountain`);
}

function writeSidecar(autosavePath, originalPath) {
  const sidecar = autosavePath + '.json';
  fs.writeFileSync(sidecar, JSON.stringify({ originalPath: originalPath || null }), 'utf-8');
}

function readSidecar(autosavePath) {
  const sidecar = autosavePath + '.json';
  try { return JSON.parse(fs.readFileSync(sidecar, 'utf-8')); } catch { return null; }
}

function deleteAutosave(autosavePath) {
  try { fs.unlinkSync(autosavePath); } catch {}
  try { fs.unlinkSync(autosavePath + '.json'); } catch {}
}

// ─── Window creation ─────────────────────────────────────────────────────────

/**
 * Create a new editor window.
 * @param {string|null} fileToOpen  Optional file to open instead of showing the startup modal.
 */
function createWindow(fileToOpen = null) {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'OpenScreenwriter',
    backgroundColor: '#0a0c10',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  filePathByWindow.set(win.id, null);
  dirtyByWindow.set(win.id, false);
  autosaveEnabledByWindow.set(win.id, true);
  if (fileToOpen) windowFileToOpen.set(win.id, fileToOpen);

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Prevent Electron's built-in Ctrl+scroll / pinch zoom from zooming the
  // entire webContents. The renderer handles zoom itself (editor paper only).
  win.webContents.on('did-finish-load', () => {
    win.webContents.setVisualZoomLevelLimits(1, 1);
  });

  // ── Unsaved-changes guard ────────────────────────────────────────────────
  win.on('close', async (e) => {
    if (closingBypass.has(win.id)) {
      closingBypass.delete(win.id);
      return; // bypass: already handled (save-then-close or don't-save)
    }

    const dirty      = dirtyByWindow.get(win.id) ?? false;
    const autosaveOn = autosaveEnabledByWindow.get(win.id) ?? true;
    const filePath   = getFilePath(win);

    // If autosave is running and the file has a real path, it's already saved.
    if (!dirty || (autosaveOn && filePath)) return;

    e.preventDefault();

    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      message: 'You have unsaved changes.',
      detail: 'Do you want to save your changes before closing?',
      buttons: ['Save', "Don't Save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
    });

    if (response === 0) {
      // Save → ask renderer to save, then close
      win.webContents.send('window:saveAndClose');
    } else if (response === 1) {
      // Don't Save → close without saving
      closingBypass.add(win.id);
      win.close();
    }
    // Cancel → do nothing; window stays open
  });

  win.on('closed', () => {
    filePathByWindow.delete(win.id);
    windowFileToOpen.delete(win.id);
    dirtyByWindow.delete(win.id);
    autosaveEnabledByWindow.delete(win.id);
    closingBypass.delete(win.id);
  });

  return win;
}

// ─── Menu ────────────────────────────────────────────────────────────────────

function buildMenu() {
  const isMac = process.platform === 'darwin';

  // Menu item clicks are routed to the focused window
  const send = (channel, ...args) => () => {
    const win = getFocusedWin();
    if (win) win.webContents.send(channel, ...args);
  };

  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { label: 'About OpenScreenwriter', click: send('menu:about') },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Window', accelerator: 'CmdOrCtrl+N', click: () => createWindow() },
        { type: 'separator' },
        { label: 'Open...', accelerator: 'CmdOrCtrl+O', click: send('menu:open') },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: send('menu:save') },
        { label: 'Save As...', accelerator: 'CmdOrCtrl+Shift+S', click: send('menu:saveAs') },
        { type: 'separator' },
        { label: 'Export as FDX...', accelerator: 'CmdOrCtrl+E', click: send('menu:exportFdx') },
        { label: 'Export as PDF...', accelerator: 'CmdOrCtrl+Shift+E', click: send('menu:exportPdf') },
        { label: 'Print...', accelerator: 'CmdOrCtrl+P', click: send('menu:print') },
        { type: 'separator' },
        ...(isMac ? [] : [{ role: 'quit' }]),
      ],
    },
    { label: 'Edit', role: 'editMenu' },
    {
      label: 'Insert',
      submenu: [
        { label: 'Title Page...', click: send('menu:insertTitlePage') },
        { type: 'separator' },
        { label: 'Page Break', click: send('menu:insertPageBreak') },
        { label: 'Line Break', click: send('menu:insertLineBreak') },
        { type: 'separator' },
        { label: 'Add Note...', accelerator: 'CmdOrCtrl+Shift+N', click: send('menu:addNote') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Side Panel', accelerator: 'CmdOrCtrl+\\', click: send('menu:toggleSidePanel') },
        { type: 'separator' },
        {
          label: 'Autosave',
          type: 'checkbox',
          checked: true,
          click: (menuItem) => {
            const win = getFocusedWin();
            if (win) win.webContents.send('menu:toggleAutosave', menuItem.checked);
          },
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        ...(isMac ? [] : [{ label: 'About OpenScreenwriter', click: send('menu:about') }]),
        { label: 'View on GitHub', click: () => shell.openExternal('https://github.com/mitchrnet/openscreenwriter') },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ─── IPC Handlers ────────────────────────────────────────────────────────────

ipcMain.handle('dialog:openFile', async (event) => {
  const win = getWin(event);
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    filters: [
      { name: 'Screenplay', extensions: ['fountain', 'fdx', 'txt'] },
      { name: 'All Files', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });
  if (canceled || filePaths.length === 0) return null;
  const filePath = filePaths[0];
  let content;
  try { content = fs.readFileSync(filePath, 'utf-8'); } catch { return null; }
  const isFdx = path.extname(filePath).toLowerCase() === '.fdx';
  setFilePath(win, isFdx ? null : filePath);
  return { filePath, content };
});

ipcMain.handle('dialog:saveFile', async (event, { content, filePath }) => {
  const win = getWin(event);
  const targetPath = filePath || getFilePath(win);
  if (!targetPath) {
    const { canceled, filePath: chosen } = await dialog.showSaveDialog(win, {
      defaultPath: 'untitled.fountain',
      filters: [{ name: 'Fountain', extensions: ['fountain'] }],
    });
    if (canceled || !chosen) return null;
    try { fs.writeFileSync(chosen, content, 'utf-8'); } catch { return null; }
    setFilePath(win, chosen);
    return chosen;
  }
  try { fs.writeFileSync(targetPath, content, 'utf-8'); } catch { return null; }
  setFilePath(win, targetPath);
  return targetPath;
});

ipcMain.handle('dialog:saveFileAs', async (event, { content }) => {
  const win = getWin(event);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: getFilePath(win) || 'untitled.fountain',
    filters: [{ name: 'Fountain', extensions: ['fountain'] }],
  });
  if (canceled || !filePath) return null;
  try { fs.writeFileSync(filePath, content, 'utf-8'); } catch { return null; }
  setFilePath(win, filePath);
  return filePath;
});

ipcMain.handle('dialog:exportFdx', async (event, { fdxContent }) => {
  const win = getWin(event);
  const currentPath = getFilePath(win);
  const base = currentPath
    ? path.basename(currentPath, path.extname(currentPath))
    : 'screenplay';
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: `${base}.fdx`,
    filters: [{ name: 'Final Draft', extensions: ['fdx'] }],
  });
  if (canceled || !filePath) return null;
  try { fs.writeFileSync(filePath, fdxContent, 'utf-8'); } catch { return null; }
  return filePath;
});

ipcMain.handle('dialog:exportPdf', async (event, { html }) => {
  const win = getWin(event);
  const currentPath = getFilePath(win);
  const base = currentPath
    ? path.basename(currentPath, path.extname(currentPath))
    : 'screenplay';
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: `${base}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (canceled || !filePath) return null;

  // Write the print HTML to a temp file so the hidden window can load it
  // as a file:// URL (avoids data URI encoding issues with special characters).
  const tmpHtml = path.join(os.tmpdir(), `openscreenwriter-print-${Date.now()}.html`);
  try {
    fs.writeFileSync(tmpHtml, html, 'utf-8');

    const printWin = new BrowserWindow({
      show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });

    await printWin.loadFile(tmpHtml);

    const pdfData = await printWin.webContents.printToPDF({
      printBackground: false,
      pageSize: 'Letter',
      margins: { marginType: 'none' },
    });

    printWin.close();
    fs.writeFileSync(filePath, pdfData);
    return filePath;
  } catch {
    return null;
  } finally {
    try { fs.unlinkSync(tmpHtml); } catch {}
  }
});

ipcMain.handle('dialog:print', async (event, { html }) => {
  const tmpHtml = path.join(os.tmpdir(), `openscreenwriter-print-${Date.now()}.html`);
  let printWin;
  try {
    fs.writeFileSync(tmpHtml, html, 'utf-8');
    printWin = new BrowserWindow({
      show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });
    await printWin.loadFile(tmpHtml);
    await new Promise((resolve, reject) => {
      printWin.webContents.print({ silent: false, printBackground: false }, (success, reason) => {
        if (!success && reason !== 'cancelled') reject(new Error(reason));
        else resolve();
      });
    });
    return true;
  } catch {
    return false;
  } finally {
    try { fs.unlinkSync(tmpHtml); } catch {}
    if (printWin && !printWin.isDestroyed()) printWin.close();
  }
});

ipcMain.handle('app:getVersion', () => app.getVersion());

ipcMain.handle('shell:openExternal', (_, url) => shell.openExternal(url));

ipcMain.handle('window:setTitle', (event, { title }) => {
  getWin(event).setTitle(title);
});

/**
 * Read a file directly by path (no dialog). Used when a file path is already
 * known (file-association open, CLI arg).
 */
ipcMain.handle('file:readPath', (event, { filePath }) => {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    setFilePath(getWin(event), filePath);
    return { filePath, content };
  } catch {
    return null;
  }
});

/**
 * Called by the renderer during init. Returns a file path if this window was
 * created to open a specific file (file-association / CLI arg), or null for a
 * normal startup.
 */
ipcMain.handle('app:getPendingFile', (event) => {
  const win = getWin(event);

  // Check if this window was created specifically to open a file
  const windowFile = windowFileToOpen.get(win.id);
  if (windowFile) {
    windowFileToOpen.delete(win.id);
    return windowFile;
  }

  // Check global pending (set by open-file on cold launch before any window existed)
  const filePath = pendingFilePath || getArgFilePath();
  pendingFilePath = null;
  return filePath || null;
});

// ─── Close-guard IPC ─────────────────────────────────────────────────────────

// Renderer notifies main whenever dirty state changes
ipcMain.on('window:dirtyChanged', (event, isDirty) => {
  const win = getWin(event);
  if (win) dirtyByWindow.set(win.id, isDirty);
});

// Renderer notifies main whenever autosave is toggled
ipcMain.on('window:autosaveChanged', (event, enabled) => {
  const win = getWin(event);
  if (win) autosaveEnabledByWindow.set(win.id, enabled);
});

// Renderer signals that a save-then-close is complete
ipcMain.on('window:readyToClose', (event) => {
  const win = getWin(event);
  if (!win) return;
  closingBypass.add(win.id);
  win.close();
});

// ─── Autosave IPC ────────────────────────────────────────────────────────────

ipcMain.handle('autosave:writeRealFile', (event, { content, filePath }) => {
  if (!filePath) return false;
  try { fs.writeFileSync(filePath, content, 'utf-8'); return true; } catch { return false; }
});

ipcMain.handle('autosave:write', (event, { content, filePath }) => {
  try {
    const dest = autosavePathFor(filePath || null);
    fs.writeFileSync(dest, content, 'utf-8');
    writeSidecar(dest, filePath || null);
    return true;
  } catch { return false; }
});

ipcMain.handle('autosave:delete', (event, { filePath }) => {
  try { deleteAutosave(autosavePathFor(filePath || null)); return true; } catch { return false; }
});

ipcMain.handle('autosave:check', (event, { filePath }) => {
  const dest = autosavePathFor(filePath || null);
  if (!fs.existsSync(dest)) return { exists: false };
  const sidecar = readSidecar(dest);
  return { exists: true, autosavePath: dest, originalPath: sidecar?.originalPath || null };
});

ipcMain.handle('autosave:read', (event, { filePath }) => {
  const dest = autosavePathFor(filePath || null);
  try { return fs.readFileSync(dest, 'utf-8'); } catch { return null; }
});

ipcMain.handle('autosave:listAll', () => {
  const dir = getAutosaveDir();
  if (!fs.existsSync(dir)) return [];
  const results = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.fountain')) continue;
    const full = path.join(dir, name);
    const sidecar = readSidecar(full);
    results.push({ autosavePath: full, originalPath: sidecar?.originalPath || null });
  }
  return results;
});

ipcMain.on('autosave:cleanQuit', (event, { filePath }) => {
  try { deleteAutosave(autosavePathFor(filePath || null)); } catch {}
});

// ─── Notes sidecar ───────────────────────────────────────────────────────────

ipcMain.handle('notes:write', (event, { filePath, notes }) => {
  try {
    fs.writeFileSync(filePath + '.notes.json', JSON.stringify(notes), 'utf8');
    return true;
  } catch { return false; }
});

ipcMain.handle('notes:read', (event, { filePath }) => {
  try {
    const raw = fs.readFileSync(filePath + '.notes.json', 'utf8');
    return JSON.parse(raw);
  } catch { return null; }
});

ipcMain.handle('notes:delete', (event, { filePath }) => {
  try {
    fs.unlinkSync(filePath + '.notes.json');
    return true;
  } catch { return false; }
});

// ─── App lifecycle ───────────────────────────────────────────────────────────

app.whenReady().then(() => {
  buildMenu();
  createWindow();

  // On macOS: re-create a window if the dock icon is clicked with no windows open
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
