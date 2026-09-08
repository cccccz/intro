import { AiService } from "../ai/service.ts";
import type { AiStart, AiContext } from "./renderer/ai-types.ts";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Library } from "../library/index.ts";
import { editExcerpt, detachSide, dropSide, hangPdfSide, hangSide, persistClean, pieceView } from "../write/loop.ts";
import type { PdfAnchor } from "../pdf/overlay.ts";
import { IPC } from "./api.ts";
import type { EditBatch } from "../write/anchor-edits.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

let ai: AiService | undefined;
const contextWaiters = new Map<string, { resolve: (value: AiContext) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
function aiService(): AiService {
  if (!ai) {
    ai = new AiService(path.join(app.getPath("userData"), "codex-answers"));
    ai.pdfReader = (root, pieceId, page, textOnly) => new Promise((resolve, reject) => {
      if (!win || win.isDestroyed()) { reject(new Error("阅读窗口已关闭")); return; }
      const id = crypto.randomUUID();
      const timer = setTimeout(() => { contextWaiters.delete(id); reject(new Error("读取 PDF 上下文超时")); }, 45000);
      contextWaiters.set(id, { resolve, reject, timer });
      win.webContents.send("ai:read", { id, root, pieceId, page, textOnly });
    });
  }
  return ai;
}
ipcMain.handle(IPC.aiProvideContext, (event, id: string, result: { context?: AiContext; error?: string }) => {
  if (event.sender !== win?.webContents) return;
  const waiter = contextWaiters.get(id); if (!waiter) return;
  clearTimeout(waiter.timer); contextWaiters.delete(id);
  if (result.context && result.context.text.length <= 100000 && (!result.context.image || result.context.image.length <= 12000000)) waiter.resolve(result.context);
  else waiter.reject(new Error(result.error || "PDF 上下文无效"));
});
ipcMain.handle(IPC.aiModels, async () => { try { return { ok: true, models: await aiService().models() }; } catch (e) { return fail(e); } });
ipcMain.handle(IPC.aiEdit, (_event, id: string, expected: string, markdown: string) => { try { return { ok: true, job: aiService().editDraft(requireLib(), id, expected, markdown) }; } catch (e) { return fail(e); } });
ipcMain.handle(IPC.aiApply, (_event, id: string, undo?: boolean) => { try { return { ok: true, piece: aiService().applyImprovement(requireLib(), id, undo) }; } catch (e) { return fail(e); } });
ipcMain.handle(IPC.aiStart, (_e, request: AiStart) => { try { return { ok: true, job: aiService().start(requireLib(), request) }; } catch (e) { return fail(e); } });
ipcMain.handle(IPC.aiStatus, (_e, id: string) => { try { return { ok: true, job: aiService().status(id) }; } catch (e) { return fail(e); } });
ipcMain.handle(IPC.aiCancel, (_e, id: string) => { try { return { ok: true, job: aiService().cancel(id) }; } catch (e) { return fail(e); } });
ipcMain.handle(IPC.aiList, () => { try { return { ok: true, jobs: aiService().list(requireLib().root) }; } catch (e) { return fail(e); } });
ipcMain.handle(IPC.aiCommit, (_e, id: string) => { try { return { ok: true, ...aiService().commit(requireLib(), id) }; } catch (e) { return fail(e); } });
ipcMain.handle(IPC.aiLogin, async () => { try { await shell.openExternal(await aiService().login()); return { ok: true }; } catch (e) { return fail(e); } });
app.on("before-quit", () => ai?.close());
let library: Library | null = null;
let win: BrowserWindow | null = null;

function fail(err: unknown): { ok: false; error: string } {
  const message = err instanceof Error ? err.message : String(err);
  return { ok: false, error: message };
}

function requireLib(): Library {
  if (!library) {
    throw new Error("no library open");
  }
  return library;
}

function libraryDto(lib: Library) {
  return { root: lib.root, pieces: lib.list() };
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 800,
    minHeight: 520,
    title: "intro",
    webPreferences: {
      preload: path.join(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.loadFile(path.join(here, "renderer", "index.html"));
  // Research citations open in the user's browser, never replace the reading app.
  window.webContents.on('will-navigate', (event, url) => {
    event.preventDefault(); if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  return window;
}

function libraryFlag(): string | null {
  const argv = process.argv.slice(app.isPackaged ? 1 : 2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--library" && argv[i + 1]) {
      return path.resolve(argv[i + 1]);
    }
    if (argv[i].startsWith("--library=")) {
      return path.resolve(argv[i].slice("--library=".length));
    }
  }
  const bare = argv.find((arg) => !arg.startsWith("-") && fs.existsSync(arg));
  return bare ? path.resolve(bare) : null;
}

ipcMain.handle(IPC.openLibrary, async () => {
  try {
    const picked = await dialog.showOpenDialog({
      title: "Open library folder",
      properties: ["openDirectory", "createDirectory"],
    });
    if (picked.canceled || !picked.filePaths[0]) {
      return { ok: false, error: "canceled" };
    }
    library = new Library(picked.filePaths[0]);
    return { ok: true, library: libraryDto(library) };
  } catch (err) {
    return fail(err);
  }
});

ipcMain.handle(IPC.openLibraryPath, async (_e, root: string) => {
  try {
    library = new Library(root);
    return { ok: true, library: libraryDto(library) };
  } catch (err) {
    return fail(err);
  }
});

ipcMain.handle(IPC.listPieces, async () => {
  try {
    return { ok: true, pieces: requireLib().list() };
  } catch (err) {
    return fail(err);
  }
});

ipcMain.handle(IPC.createPiece, async (_e, opts?: { id?: string; body?: string; title?: string }) => {
  try {
    const lib = requireLib();
    const piece = lib.createPiece({ id: opts?.id, body: opts?.body ?? "", title: opts?.title });
    return { ok: true, piece: pieceView(piece), pieces: lib.list() };
  } catch (err) {
    return fail(err);
  }
});

ipcMain.handle(IPC.setPieceTitle, async (_e, id: string, title: string) => {
  try {
    const lib = requireLib();
    const piece = lib.saveTitle(id, title);
    return { ok: true, piece: pieceView(piece), pieces: lib.list() };
  } catch (err) {
    return fail(err);
  }
});

ipcMain.handle(IPC.loadPiece, async (_e, id: string) => {
  try {
    return { ok: true, piece: pieceView(requireLib().load(id)) };
  } catch (err) {
    return fail(err);
  }
});

ipcMain.handle(IPC.persistClean, async (_e, id: string, clean: string, batch?: EditBatch) => {
  try {
    return { ok: true, piece: pieceView(persistClean(requireLib(), id, clean, batch)) };
  } catch (err) {
    return fail(err);
  }
});

ipcMain.handle(
  IPC.hangSide,
  async (
    _e,
    opts: {
      hostId: string;
      start: number;
      end: number;
      clean?: string;
      sideId?: string;
    },
  ) => {
    try {
      const result = hangSide(requireLib(), opts.hostId, {
        start: opts.start,
        end: opts.end,
      }, {
        clean: opts.clean,
        sideId: opts.sideId,
      });
      return {
        ok: true,
        host: pieceView(result.host),
        side: pieceView(result.side),
        rivetId: result.rivetId,
      };
    } catch (err) {
      return fail(err);
    }
  },
);

ipcMain.handle(IPC.attachPdf, async () => {
  try {
    const picked = await dialog.showOpenDialog({
      title: "Attach PDF as host",
      properties: ["openFile"],
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (picked.canceled || !picked.filePaths[0]) {
      return { ok: false, error: "canceled" };
    }
    const lib = requireLib();
    const piece = lib.attachPdf(picked.filePaths[0]);
    return { ok: true, piece: pieceView(piece), pieces: lib.list() };
  } catch (err) {
    return fail(err);
  }
});

ipcMain.handle(IPC.readPdf, async (_e, id: string) => {
  try {
    const data = requireLib().readPdfBytes(id);
    return { ok: true, data };
  } catch (err) {
    return fail(err);
  }
});

ipcMain.handle(
  IPC.hangPdfSide,
  async (
    _e,
    opts: {
      hostId: string;
      anchors: PdfAnchor[];
      sideId?: string;
      quote?: string;
    },
  ) => {
    try {
      const result = hangPdfSide(requireLib(), opts.hostId, opts.anchors, {
        sideId: opts.sideId,
        quote: opts.quote,
      });
      return {
        ok: true,
        host: pieceView(result.host),
        side: pieceView(result.side),
        rivetId: result.rivetId,
      };
    } catch (err) {
      return fail(err);
    }
  },
);

ipcMain.handle(IPC.dropSide, async (_e, id: string) => {
  try {
    const lib = requireLib();
    const result = dropSide(lib, id);
    return {
      ok: true,
      deleted: result.deleted,
      hosts: result.hosts.map(pieceView),
      pieces: lib.list(),
    };
  } catch (err) {
    return fail(err);
  }
});

ipcMain.handle(IPC.detachSide, async (_e, hostId: string, rivetId: string, clean?: string) => {
  try {
    return { ok: true, host: pieceView(detachSide(requireLib(), hostId, rivetId, clean)) };
  } catch (err) { return fail(err); }
});

ipcMain.handle(IPC.editExcerpt, async (_e, id: string, expected: string, start: number, end: number, text: string) => {
  try { return { ok: true, piece: pieceView(editExcerpt(requireLib(), id, expected, start, end, text)) }; }
  catch (err) { return fail(err); }
});

app.whenReady().then(() => {
  win = createWindow();
  const initial = libraryFlag();
  if (initial) {
    library = new Library(initial);
    win.webContents.once("did-finish-load", () => {
      win?.webContents.send("library:opened", libraryDto(library!));
    });
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      win = createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
