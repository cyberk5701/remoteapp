const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    getScreenSources: () => ipcRenderer.invoke('get-screen-sources'),
    sendControl: (data) => ipcRenderer.send('control-input', data),
    setSource: (sourceId) => ipcRenderer.send('set-source', sourceId),
    resizeWindow: (mode) => ipcRenderer.send('resize-window', mode) 
});