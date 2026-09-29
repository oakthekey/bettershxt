const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // overlay
  onOverlayStart: (cb) => ipcRenderer.on('overlay:start', (_e, data) => cb(data)),
  onOverlayImage: (cb) => ipcRenderer.on('overlay:image', (_e, data) => cb(data)),  overlaySelect: (rect) => ipcRenderer.send('overlay:select', rect),
  overlayCancel: () => ipcRenderer.send('overlay:cancel'),
  // preview
  onScreenshot: (cb) => ipcRenderer.on('preview:add', (_e, shot) => cb(shot)),
  onUpdate: (cb) => ipcRenderer.on('preview:update', (_e, shot) => cb(shot)),
  onProgress: (cb) => ipcRenderer.on('preview:progress', (_e, info) => cb(info)),
  onConfig: (cb) => ipcRenderer.on('preview:config', (_e, cfg) => cb(cfg)),
  startDrag: (filePath) => ipcRenderer.send('preview:drag', filePath),
  action: (name, filePath) => ipcRenderer.invoke('preview:action', name, filePath),
  resize: (w, h) => ipcRenderer.send('preview:resize', w, h),
  hide: () => ipcRenderer.send('preview:hide'),
  // editor
  onEditorInit: (cb) => ipcRenderer.on('editor:init', (_e, data) => cb(data)),
  editorSave: (filePath, dataUrl, copyOnly) => ipcRenderer.invoke('editor:save', filePath, dataUrl, copyOnly),
  editorClose: () => ipcRenderer.send('editor:close'),
  // settings
  settingsGet: () => ipcRenderer.invoke('settings:get'),
  settingsSave: (patch) => ipcRenderer.invoke('settings:save', patch),
  settingsPickDir: () => ipcRenderer.invoke('settings:pickDir'),
  settingsClose: () => ipcRenderer.send('settings:close'),
});
