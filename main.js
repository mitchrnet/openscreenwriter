'use strict';

const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

let mainWindow;
let currentFilePath  = null;
let pendingFilePath  = null;  // set by open-file before window is ready

// Capture macOS open-file events (fires before app.whenReady on cold launch)
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('menu:openPath', filePath);
  } else {
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

// --- Autosave helpers ---

/**
 * Return the autosave directory inside userData.
 * Creates it on first call if it doesn't exist.
 */
function getAutosaveDir() {
  const dir = path.join(app.getPath('userData'), 'autosave');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Map an original file path (or null for untitled) to a stable
 * autosave filename. Uses a SHA-1 hex of the full path so the
 * mapping is deterministic and filesystem-safe.
 */
function autosavePathFor(filePath) {
  const key = filePath
    ? crypto.createHash('sha1').update(filePath).digest('hex')
    : 'untitled';
  return path.join(getAutosaveDir(), `${key}.fountain`);
}

/**
 * Persist a small JSON sidecar alongside the autosave so we know
 * which original path the blob belongs to.
 */
function writeSidecar(autosavePath, originalPath) {
  const sidecar = autosavePath + '.json';
  fs.writeFileSync(sidecar, JSON.stringify({ originalPath: originalPath || null }), 'utf-8');
}

function readSidecar(autosavePath) {
  const sidecar = autosavePath + '.json';
  try {
    return JSON.parse(fs.readFileSync(sidecar, 'utf-8'));
  } catch {
    return null;
  }
}

function deleteAutosave(autosavePath) {
  try { fs.unlinkSync(autosavePath); } catch {}
  try { fs.unlinkSync(autosavePath + '.json'); } catch {}
}

function createWindow() {
  mainWindow = new BrowserWindow({
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

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function buildMenu() {
  const isMac = process.platform === 'darwin';

  const template = [
    // macOS app menu (OpenScreenwriter > About, Services, Hide, Quit…)
    ...(isMac ? [{
      label: app.name,
      submenu: [
        {
          label: 'About OpenScreenwriter',
          click: () => mainWindow.webContents.send('menu:about'),
        },
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
        {
          label: 'Open...',
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow.webContents.send('menu:open'),
        },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => mainWindow.webContents.send('menu:save'),
        },
        {
          label: 'Save As...',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => mainWindow.webContents.send('menu:saveAs'),
        },
        { type: 'separator' },
        {
          label: 'Export as FDX...',
          accelerator: 'CmdOrCtrl+E',
          click: () => mainWindow.webContents.send('menu:exportFdx'),
        },
        { type: 'separator' },
        // Quit lives in the app menu on macOS; show it in File on Windows/Linux
        ...(isMac ? [] : [{ role: 'quit' }]),
      ],
    },
    { label: 'Edit', role: 'editMenu' },
    {
      label: 'Insert',
      submenu: [
        {
          label: 'Title Page...',
          click: () => mainWindow.webContents.send('menu:insertTitlePage'),
        },
        { type: 'separator' },
        {
          label: 'Page Break',
          click: () => mainWindow.webContents.send('menu:insertPageBreak'),
        },
        {
          label: 'Line Break',
          click: () => mainWindow.webContents.send('menu:insertLineBreak'),
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Source Mode',
          accelerator: 'CmdOrCtrl+Shift+M',
          click: () => mainWindow.webContents.send('menu:toggleSourceMode'),
        },
        { type: 'separator' },
        {
          label: 'Autosave',
          type: 'checkbox',
          checked: true,
          click: (menuItem) => mainWindow.webContents.send('menu:toggleAutosave', menuItem.checked),
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
        // About is in the app menu on macOS; keep it in Help on Windows/Linux
        ...(isMac ? [] : [{
          label: 'About OpenScreenwriter',
          click: () => mainWindow.webContents.send('menu:about'),
        }]),
        {
          label: 'View on GitHub',
          click: () => shell.openExternal('https://github.com/mitchrnet/openscreenwriter'),
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// --- IPC Handlers ---

ipcMain.handle('dialog:openFile', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    filters: [
      { name: 'Screenplay', extensions: ['fountain', 'fdx', 'txt'] },
      { name: 'All Files', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });
  if (canceled || filePaths.length === 0) return null;
  const filePath = filePaths[0];
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    return null;
  }
  const isFdx = path.extname(filePath).toLowerCase() === '.fdx';
  currentFilePath = isFdx ? null : filePath;
  return { filePath, content };
});

ipcMain.handle('dialog:saveFile', async (event, { content, filePath }) => {
  const targetPath = filePath || currentFilePath;
  if (!targetPath) {
    // No path yet — fall through to Save As
    const { canceled, filePath: chosen } = await dialog.showSaveDialog(mainWindow, {
      defaultPath: 'untitled.fountain',
      filters: [{ name: 'Fountain', extensions: ['fountain'] }],
    });
    if (canceled || !chosen) return null;
    try {
      fs.writeFileSync(chosen, content, 'utf-8');
    } catch (err) {
      return null;
    }
    currentFilePath = chosen;
    return chosen;
  }
  try {
    fs.writeFileSync(targetPath, content, 'utf-8');
  } catch (err) {
    return null;
  }
  currentFilePath = targetPath;
  return targetPath;
});

ipcMain.handle('dialog:saveFileAs', async (event, { content }) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: currentFilePath || 'untitled.fountain',
    filters: [{ name: 'Fountain', extensions: ['fountain'] }],
  });
  if (canceled || !filePath) return null;
  try {
    fs.writeFileSync(filePath, content, 'utf-8');
  } catch (err) {
    return null;
  }
  currentFilePath = filePath;
  return filePath;
});

ipcMain.handle('dialog:exportFdx', async (event, { fdxContent }) => {
  const base = currentFilePath
    ? path.basename(currentFilePath, path.extname(currentFilePath))
    : 'screenplay';
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: `${base}.fdx`,
    filters: [{ name: 'Final Draft', extensions: ['fdx'] }],
  });
  if (canceled || !filePath) return null;
  try {
    fs.writeFileSync(filePath, fdxContent, 'utf-8');
  } catch (err) {
    return null;
  }
  return filePath;
});

ipcMain.handle('app:getVersion', () => app.getVersion());

/**
 * Read a file directly by path (no dialog). Used by file-association opens
 * (macOS open-file event / Windows CLI arg) where the path is already known.
 */
ipcMain.handle('file:readPath', (event, { filePath }) => {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    currentFilePath = filePath;
    return { filePath, content };
  } catch {
    return null;
  }
});

/**
 * Called by the renderer during init to check whether the app was launched
 * with a specific file (file-association double-click or CLI arg). Returns the
 * file path string if one is pending, or null. Clears pendingFilePath so it is
 * only consumed once.
 */
ipcMain.handle('app:getPendingFile', () => {
  const filePath = pendingFilePath || getArgFilePath();
  pendingFilePath = null;
  return filePath || null;
});

ipcMain.handle('shell:openExternal', (_, url) => shell.openExternal(url));

ipcMain.handle('window:setTitle', async (event, { title }) => {
  mainWindow.setTitle(title);
});

// --- Autosave IPC ---

/**
 * Write content directly to a named .fountain file (no dialog).
 * Used by autosave for documents that already have a file path.
 */
ipcMain.handle('autosave:writeRealFile', (event, { content, filePath }) => {
  if (!filePath) return false;
  try {
    fs.writeFileSync(filePath, content, 'utf-8');
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle('autosave:write', (event, { content, filePath }) => {
  try {
    const dest = autosavePathFor(filePath || null);
    fs.writeFileSync(dest, content, 'utf-8');
    writeSidecar(dest, filePath || null);
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle('autosave:delete', (event, { filePath }) => {
  try {
    const dest = autosavePathFor(filePath || null);
    deleteAutosave(dest);
    return true;
  } catch {
    return false;
  }
});

/**
 * Check whether an autosave exists for the given filePath (or untitled).
 * Returns { exists: bool, autosavePath, originalPath } so the renderer
 * can offer recovery without exposing raw fs paths unnecessarily.
 */
ipcMain.handle('autosave:check', (event, { filePath }) => {
  const dest = autosavePathFor(filePath || null);
  if (!fs.existsSync(dest)) return { exists: false };
  const sidecar = readSidecar(dest);
  return { exists: true, autosavePath: dest, originalPath: sidecar?.originalPath || null };
});

ipcMain.handle('autosave:read', (event, { filePath }) => {
  const dest = autosavePathFor(filePath || null);
  try {
    return fs.readFileSync(dest, 'utf-8');
  } catch {
    return null;
  }
});

/**
 * On startup: scan the autosave folder and return any existing entries
 * so the renderer can check if the current file (or untitled) has a recovery.
 */
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

// --- App lifecycle ---

app.whenReady().then(() => {
  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// The renderer sends this just before the window closes to clean up the
// autosave for the current file (clean quit, not a crash).
ipcMain.on('autosave:cleanQuit', (event, { filePath }) => {
  try {
    const dest = autosavePathFor(filePath || null);
    deleteAutosave(dest);
  } catch {}
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
