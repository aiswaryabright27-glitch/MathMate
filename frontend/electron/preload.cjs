
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mathmateDesktop", {
  getSources: () => ipcRenderer.invoke("mathmate:get-sources"),

  captureSource: (sourceId) =>
    ipcRenderer.invoke("mathmate:capture-source", sourceId),

  savePdf: (payload) =>
    ipcRenderer.invoke("mathmate:save-pdf", payload),

  openFileLocation: (filePath) =>
    ipcRenderer.invoke("mathmate:open-file-location", filePath),

  requestMicrophonePermission: () =>
    ipcRenderer.invoke("mathmate:request-microphone-permission"),
});
