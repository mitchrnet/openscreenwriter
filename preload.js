'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('screenwriterAPI', {
  // Renderer → Main (promise-based)
  openFile:        ()        => ipcRenderer.invoke('dialog:openFile'),
  saveFile:        (payload) => ipcRenderer.invoke('dialog:saveFile', payload),
  saveFileAs:      (payload) => ipcRenderer.invoke('dialog:saveFileAs', payload),
  exportFdx:       (payload) => ipcRenderer.invoke('dialog:exportFdx', payload),
  exportPdf:       (payload) => ipcRenderer.invoke('dialog:exportPdf', payload),
  setTitle:        (payload) => ipcRenderer.invoke('window:setTitle', payload),
  getVersion:      ()        => ipcRenderer.invoke('app:getVersion'),
  openExternal:    (url)     => ipcRenderer.invoke('shell:openExternal', url),
  readFileByPath:  (payload) => ipcRenderer.invoke('file:readPath', payload),
  getPendingFile:  ()        => ipcRenderer.invoke('app:getPendingFile'),

  // Autosave
  autosaveWriteRealFile: (payload) => ipcRenderer.invoke('autosave:writeRealFile', payload),
  autosaveWrite:   (payload) => ipcRenderer.invoke('autosave:write', payload),
  autosaveDelete:  (payload) => ipcRenderer.invoke('autosave:delete', payload),
  autosaveCheck:   (payload) => ipcRenderer.invoke('autosave:check', payload),
  autosaveRead:    (payload) => ipcRenderer.invoke('autosave:read', payload),
  autosaveListAll: ()        => ipcRenderer.invoke('autosave:listAll'),
  autosaveCleanQuit: (payload) => ipcRenderer.send('autosave:cleanQuit', payload),

  // Main → Renderer (menu commands)
  // Event arg is stripped so renderer never sees the sender reference.
  onMenuOpen:             (cb) => ipcRenderer.on('menu:open',             () => cb()),
  onMenuSave:             (cb) => ipcRenderer.on('menu:save',             () => cb()),
  onMenuSaveAs:           (cb) => ipcRenderer.on('menu:saveAs',           () => cb()),
  onMenuExportFdx:        (cb) => ipcRenderer.on('menu:exportFdx',        () => cb()),
  onMenuExportPdf:        (cb) => ipcRenderer.on('menu:exportPdf',        () => cb()),
  onMenuToggleSourceMode: (cb) => ipcRenderer.on('menu:toggleSourceMode', () => cb()),
  onMenuInsertTitlePage:  (cb) => ipcRenderer.on('menu:insertTitlePage',  () => cb()),
  onMenuInsertPageBreak:  (cb) => ipcRenderer.on('menu:insertPageBreak',  () => cb()),
  onMenuInsertLineBreak:  (cb) => ipcRenderer.on('menu:insertLineBreak',  () => cb()),
  onMenuAbout:            (cb) => ipcRenderer.on('menu:about',            () => cb()),
  onMenuToggleAutosave:   (cb) => ipcRenderer.on('menu:toggleAutosave',   (_, checked) => cb(checked)),
  onMenuOpenPath:         (cb) => ipcRenderer.on('menu:openPath',         (_, filePath) => cb(filePath)),

  // Close-guard: renderer → main state sync
  notifyDirtyState:    (isDirty) => ipcRenderer.send('window:dirtyChanged',   isDirty),
  notifyAutosaveState: (enabled) => ipcRenderer.send('window:autosaveChanged', enabled),
  notifyReadyToClose:  ()        => ipcRenderer.send('window:readyToClose'),

  // Close-guard: main → renderer command
  onSaveAndClose: (cb) => ipcRenderer.on('window:saveAndClose', () => cb()),
});
