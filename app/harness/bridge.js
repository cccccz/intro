/**
 * Browser stand-in for app/electron/preload.cjs.
 * The harness server injects this before renderer.js. It does not run inside Electron.
 */
const listeners = [];
let library = null;

async function call(method, args) {
  const response = await fetch("/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method, args }),
  });
  return response.json();
}

function deliver(next) {
  library = next;
  document.documentElement.dataset.introLibrary = next && next.root ? "open" : "closed";
  for (const listener of listeners) listener(next);
}

window.intro = {
  aiEdit: (id, expected, markdown) => call("aiEdit", [id, expected, markdown]),
  aiModels: () => call("aiModels", []),
  aiApply: (id, undo) => call("aiApply", [id, undo]),
  aiProvideContext: (id, result) => call("aiProvideContext", [id, result]),
  onAiRead: () => () => {},
  aiStart: (request) => call("aiStart", [request]),
  aiStatus: (id) => call("aiStatus", [id]),
  aiCancel: (id) => call("aiCancel", [id]),
  aiList: () => call("aiList", []),
  aiLogin: () => call("aiLogin", []),
  aiCommit: (id) => call("aiCommit", [id]),
  editExcerpt: (id, expected, start, end, text) => call("editExcerpt", [id, expected, start, end, text]),
  detachSide: (hostId, rivetId, clean) => call("detachSide", [hostId, rivetId, clean]),
  openLibrary: () => call("openLibrary", []),
  openLibraryPath: (root) => call("openLibraryPath", [root]),
  listPieces: () => call("listPieces", []),
  createPiece: (opts) => call("createPiece", [opts]),
  setPieceTitle: (id, title) => call("setPieceTitle", [id, title]),
  loadPiece: (id) => call("loadPiece", [id]),
  persistClean: (id, clean, batch) => call("persistClean", [id, clean, batch]),
  hangSide: (opts) => call("hangSide", [opts]),
  attachPdf: () => call("attachPdf", []),
  readPdf: async (id) => {
    const result = await call("readPdf", [id]);
    if (result.ok && Array.isArray(result.data)) result.data = Uint8Array.from(result.data);
    return result;
  },
  hangPdfSide: (opts) => call("hangPdfSide", [opts]),
  dropSide: (id) => call("dropSide", [id]),
  onLibraryOpened: (cb) => {
    listeners.push(cb);
    if (library) cb(library);
    return () => {
      const index = listeners.indexOf(cb);
      if (index >= 0) listeners.splice(index, 1);
    };
  },
};

void fetch("/api/library")
  .then((response) => response.json())
  .then((result) => {
    if (result.ok) deliver(result.library);
  })
  .catch(() => {
    document.documentElement.dataset.introLibrary = "error";
  });
