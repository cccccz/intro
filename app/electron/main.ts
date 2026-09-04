import { app, BrowserWindow, dialog, ipcMain } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Library } from "../library/index.ts";
import { hangSide, persistClean, pieceView } from "../write/loop.ts";
import { IPC } from "./api.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

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

ipcMain.handle(IPC.createPiece, async (_e, opts?: { id?: string; body?: string }) => {
  try {
    const lib = requireLib();
    const piece = lib.createPiece({ id: opts?.id, body: opts?.body ?? "" });
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

ipcMain.handle(IPC.persistClean, async (_e, id: string, clean: string) => {
  try {
    return { ok: true, piece: pieceView(persistClean(requireLib(), id, clean)) };
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
