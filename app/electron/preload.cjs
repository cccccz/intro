const { contextBridge, ipcRenderer } = require("electron");

const IPC = {
  aiEdit: "ai:edit", aiModels: "ai:models", aiApply: "ai:apply", aiProvideContext: "ai:context",
  aiStart: "ai:start",
  aiStatus: "ai:status",
  aiCancel: "ai:cancel",
  aiList: "ai:list",
  aiLogin: "ai:login",
  aiCommit: "ai:commit",

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
  aiModels: () => ipcRenderer.invoke(IPC.aiModels),
  aiEdit: (id, expected, markdown) => ipcRenderer.invoke(IPC.aiEdit, id, expected, markdown),
  aiApply: (id, undo) => ipcRenderer.invoke(IPC.aiApply, id, undo),
  aiProvideContext: (id, result) => ipcRenderer.invoke(IPC.aiProvideContext, id, result),
  onAiRead: (cb) => {
    const listener = (_event, request) => cb(request);
    ipcRenderer.on("ai:read", listener);
    return () => ipcRenderer.removeListener("ai:read", listener);
  },
  aiStart: (arg) => ipcRenderer.invoke(IPC.aiStart, arg),
  aiStatus: (arg) => ipcRenderer.invoke(IPC.aiStatus, arg),
  aiCancel: (arg) => ipcRenderer.invoke(IPC.aiCancel, arg),
  aiList: (arg) => ipcRenderer.invoke(IPC.aiList, arg),
  aiLogin: (arg) => ipcRenderer.invoke(IPC.aiLogin, arg),
  aiCommit: (arg) => ipcRenderer.invoke(IPC.aiCommit, arg),

  editExcerpt: (id, expected, start, end, text) => ipcRenderer.invoke(IPC.editExcerpt, id, expected, start, end, text),
  detachSide: (hostId, rivetId, clean) => ipcRenderer.invoke(IPC.detachSide, hostId, rivetId, clean),
  openLibrary: () => ipcRenderer.invoke(IPC.openLibrary),
  openLibraryPath: (root) => ipcRenderer.invoke(IPC.openLibraryPath, root),
  listPieces: () => ipcRenderer.invoke(IPC.listPieces),
  createPiece: (opts) => ipcRenderer.invoke(IPC.createPiece, opts),
  setPieceTitle: (id, title) => ipcRenderer.invoke(IPC.setPieceTitle, id, title),
  loadPiece: (id) => ipcRenderer.invoke(IPC.loadPiece, id),
  persistClean: (id, clean, batch) => ipcRenderer.invoke(IPC.persistClean, id, clean, batch),
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
  onMenuCommand: (cb) => {
    const listener = (_event, command) => cb(command);
    ipcRenderer.on("menu:command", listener);
    return () => ipcRenderer.removeListener("menu:command", listener);
  },
});
