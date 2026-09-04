const { contextBridge, ipcRenderer } = require("electron");

const IPC = {
  editExcerpt: "piece:editExcerpt",
  detachSide: "piece:detachSide",
  openLibrary: "library:open",
  openLibraryPath: "library:openPath",
  listPieces: "library:list",
  createPiece: "piece:create",
  setPieceTitle: "piece:setTitle",
  loadPiece: "piece:load",
  persistClean: "piece:persistClean",
  hangSide: "piece:hangSide",
  attachPdf: "piece:attachPdf",
  readPdf: "piece:readPdf",
  hangPdfSide: "piece:hangPdfSide",
  dropSide: "piece:dropSide",
};

contextBridge.exposeInMainWorld("intro", {
  editExcerpt: (id, expected, start, end, text) => ipcRenderer.invoke(IPC.editExcerpt, id, expected, start, end, text),
  detachSide: (hostId, rivetId, clean) => ipcRenderer.invoke(IPC.detachSide, hostId, rivetId, clean),
  openLibrary: () => ipcRenderer.invoke(IPC.openLibrary),
  openLibraryPath: (root) => ipcRenderer.invoke(IPC.openLibraryPath, root),
  listPieces: () => ipcRenderer.invoke(IPC.listPieces),
  createPiece: (opts) => ipcRenderer.invoke(IPC.createPiece, opts),
  setPieceTitle: (id, title) => ipcRenderer.invoke(IPC.setPieceTitle, id, title),
  loadPiece: (id) => ipcRenderer.invoke(IPC.loadPiece, id),
  persistClean: (id, clean) => ipcRenderer.invoke(IPC.persistClean, id, clean),
  hangSide: (opts) => ipcRenderer.invoke(IPC.hangSide, opts),
  attachPdf: () => ipcRenderer.invoke(IPC.attachPdf),
  readPdf: (id) => ipcRenderer.invoke(IPC.readPdf, id),
  hangPdfSide: (opts) => ipcRenderer.invoke(IPC.hangPdfSide, opts),
  dropSide: (id) => ipcRenderer.invoke(IPC.dropSide, id),
  onLibraryOpened: (cb) => {
    const listener = (_event, library) => cb(library);
    ipcRenderer.on("library:opened", listener);
    return () => ipcRenderer.removeListener("library:opened", listener);
  },
});
