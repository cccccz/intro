import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Library } from "../library/index.ts";
import type { PdfAnchor } from "../pdf/overlay.ts";
import type { EditBatch } from "../write/anchor-edits.ts";
import {
  detachSide,
  dropSide,
  editExcerpt,
  hangPdfSide,
  hangSide,
  persistClean,
  pieceView,
} from "../write/loop.ts";

const AI_OFF = "这条浏览器回路不运行 Codex。";

export function assertScratchLibrary(root: string, allowOutsideTemp = false): string {
  const abs = path.resolve(root);
  if (path.basename(abs).toLowerCase() === "paul") {
    throw new Error("harness 拒绝打开名为 paul 的正式库。请使用副本目录。");
  }
  const tmp = path.resolve(os.tmpdir());
  const insideTemp = abs === tmp || abs.startsWith(tmp + path.sep);
  if (!allowOutsideTemp && !insideTemp) {
    throw new Error("harness 默认只打开临时目录里的库。确认是副本后加 --allow-library。");
  }
  return abs;
}

export class HarnessSession {
  library: Library;

  constructor(root: string, allowOutsideTemp = false) {
    this.library = new Library(assertScratchLibrary(root, allowOutsideTemp));
  }

  libraryDto() {
    const pieces = this.library.list().slice().sort((a, b) => a.id.localeCompare(b.id));
    return { root: this.library.root, pieces };
  }

  call(method: string, args: unknown[]): unknown {
    try {
      return this.dispatch(method, args);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  }

  private dispatch(method: string, args: unknown[]): unknown {
    const lib = this.library;
    switch (method) {
      case "openLibrary":
      case "attachPdf":
      case "aiEdit":
      case "aiModels":
      case "aiApply":
      case "aiStart":
      case "aiStatus":
      case "aiCancel":
      case "aiList":
      case "aiLogin":
      case "aiCommit":
        return {
          ok: false,
          error: method.startsWith("ai") ? AI_OFF : "canceled",
        };
      case "aiProvideContext":
        return { ok: true };
      case "openLibraryPath": {
        const root = String(args[0] ?? "");
        this.library = new Library(assertScratchLibrary(root, false));
        return { ok: true, library: this.libraryDto() };
      }
      case "listPieces":
        return { ok: true, pieces: this.libraryDto().pieces };
      case "createPiece": {
        const opts = (args[0] ?? {}) as { id?: string; body?: string; title?: string };
        const piece = lib.createPiece({ id: opts.id, body: opts.body ?? "", title: opts.title });
        return { ok: true, piece: pieceView(piece), pieces: this.libraryDto().pieces };
      }
      case "setPieceTitle": {
        const piece = lib.saveTitle(String(args[0]), String(args[1] ?? ""));
        return { ok: true, piece: pieceView(piece), pieces: this.libraryDto().pieces };
      }
      case "loadPiece":
        return { ok: true, piece: pieceView(lib.load(String(args[0]))) };
      case "persistClean":
        return {
          ok: true,
          piece: pieceView(persistClean(lib, String(args[0]), String(args[1] ?? ""), args[2] as EditBatch | undefined)),
        };
      case "hangSide": {
        const opts = args[0] as {
          hostId: string;
          start: number;
          end: number;
          clean?: string;
          sideId?: string;
        };
        const result = hangSide(lib, opts.hostId, { start: opts.start, end: opts.end }, {
          clean: opts.clean,
          sideId: opts.sideId,
        });
        return { ok: true, host: pieceView(result.host), side: pieceView(result.side), rivetId: result.rivetId };
      }
      case "readPdf":
        return { ok: true, data: Array.from(lib.readPdfBytes(String(args[0]))) };
      case "hangPdfSide": {
        const opts = args[0] as { hostId: string; anchors: PdfAnchor[]; sideId?: string; quote?: string };
        const result = hangPdfSide(lib, opts.hostId, opts.anchors, { sideId: opts.sideId, quote: opts.quote });
        return { ok: true, host: pieceView(result.host), side: pieceView(result.side), rivetId: result.rivetId };
      }
      case "dropSide": {
        const result = dropSide(lib, String(args[0]));
        return {
          ok: true,
          deleted: result.deleted,
          hosts: result.hosts.map(pieceView),
          pieces: this.libraryDto().pieces,
        };
      }
      case "detachSide":
        return {
          ok: true,
          host: pieceView(detachSide(lib, String(args[0]), String(args[1]), args[2] as string | undefined)),
        };
      case "editExcerpt":
        return {
          ok: true,
          piece: pieceView(editExcerpt(
            lib,
            String(args[0]),
            String(args[1] ?? ""),
            Number(args[2]),
            Number(args[3]),
            String(args[4] ?? ""),
          )),
        };
      default:
        return { ok: false, error: `unknown method ${method}` };
    }
  }
}

export function scratchRoot(prefix = "intro-ui-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
