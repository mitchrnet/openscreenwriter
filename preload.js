'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('screenwriterAPI', {
  // Renderer → Main (promise-based)
  openFile:     ()        => ipcRenderer.invoke('dialog:openFile'),
  saveFile:     (payload) => ipcRenderer.invoke('dialog:saveFile', payload),
  saveFileAs:   (payload) => ipcRenderer.invoke('dialog:saveFileAs', payload),
  exportFdx:    (payload) => ipcRenderer.invoke('dialog:exportFdx', payload),
  setTitle:     (payload) => ipcRenderer.invoke('window:setTitle', payload),
  getVersion:   ()        => ipcRenderer.invoke('app:getVersion'),
  openExternal: (url)     => ipcRenderer.invoke('shell:openExternal', url),

  // Main → Renderer (menu commands)
  // Event arg is stripped so renderer never sees the sender reference.
  onMenuOpen:             (cb) => ipcRenderer.on('menu:open',             () => cb()),
  onMenuSave:             (cb) => ipcRenderer.on('menu:save',             () => cb()),
  onMenuSaveAs:           (cb) => ipcRenderer.on('menu:saveAs',           () => cb()),
  onMenuExportFdx:        (cb) => ipcRenderer.on('menu:exportFdx',        () => cb()),
  onMenuToggleSourceMode: (cb) => ipcRenderer.on('menu:toggleSourceMode', () => cb()),
  onMenuInsertTitlePage:  (cb) => ipcRenderer.on('menu:insertTitlePage',  () => cb()),
  onMenuInsertPageBreak:  (cb) => ipcRenderer.on('menu:insertPageBreak',  () => cb()),
  onMenuInsertLineBreak:  (cb) => ipcRenderer.on('menu:insertLineBreak',  () => cb()),
  onMenuAbout:            (cb) => ipcRenderer.on('menu:about',            () => cb()),
});
