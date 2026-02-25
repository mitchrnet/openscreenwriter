'use strict';

const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;
let currentFilePath = null;

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
  const template = [
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
        { role: 'quit' },
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
        {
          label: 'About OpenScreenwriter',
          click: () => mainWindow.webContents.send('menu:about'),
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

ipcMain.handle('shell:openExternal', (_, url) => shell.openExternal(url));

ipcMain.handle('window:setTitle', async (event, { title }) => {
  mainWindow.setTitle(title);
});

// --- App lifecycle ---

app.whenReady().then(() => {
  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
