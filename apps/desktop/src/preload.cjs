const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld(
  "aijobDesktop",
  Object.freeze({
    status: () => ipcRenderer.invoke("aijob:status"),
    sources: () => ipcRenderer.invoke("aijob:sources"),
    selectSources: (selection) => ipcRenderer.invoke("aijob:select-sources", selection),
    startup: (enabled) => ipcRenderer.invoke("aijob:startup", enabled),
    openLogs: () => ipcRenderer.invoke("aijob:logs"),
    exportBackup: () => ipcRenderer.invoke("aijob:backup"),
    importBackup: () => ipcRenderer.invoke("aijob:import"),
    selectLegacy: () => ipcRenderer.invoke("aijob:legacy-select"),
    importLegacy: (ownerId) => ipcRenderer.invoke("aijob:legacy-import", ownerId),
    quit: () => ipcRenderer.invoke("aijob:quit"),
  }),
);
