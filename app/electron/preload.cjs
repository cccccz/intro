const { contextBridge, ipcRenderer } = require("electron");

const IPC = {
  openLibrary: "library:open",
  openLibraryPath: "library:openPath",
  listPieces: "library:list",
  createPiece: "piece:create",
  loadPiece: "piece:load",
  persistClean: "piece:persistClean",
  hangSide: "piece:hangSide",
};

contextBridge.exposeInMainWorld("intro", {
  openLibrary: () => ipcRenderer.invoke(IPC.openLibrary),
  openLibraryPath: (root) => ipcRenderer.invoke(IPC.openLibraryPath, root),
  listPieces: () => ipcRenderer.invoke(IPC.listPieces),
  createPiece: (opts) => ipcRenderer.invoke(IPC.createPiece, opts),
  loadPiece: (id) => ipcRenderer.invoke(IPC.loadPiece, id),
  persistClean: (id, clean) => ipcRenderer.invoke(IPC.persistClean, id, clean),
  hangSide: (opts) => ipcRenderer.invoke(IPC.hangSide, opts),
  onLibraryOpened: (cb) => {
    const listener = (_event, library) => cb(library);
    ipcRenderer.on("library:opened", listener);
    return () => ipcRenderer.removeListener("library:opened", listener);
  },
});
