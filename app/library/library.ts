import fs from "node:fs";
import path from "node:path";
import { isPieceId, ulid } from "../marks/id.ts";
import {
  HOST_EXT,
  createHostMeta,
  overlayFileName,
  parseHostMeta,
  pdfFileName,
  serializeHostMeta,
} from "../pdf/host.ts";
import { isPdfMagic } from "../pdf/fixture.ts";
import {
  OverlayError,
  emptyOverlay,
  parseOverlay,
  serializeOverlay,
  type PdfOverlay,
} from "../pdf/overlay.ts";
import { PIECE_EXT, type ListedPiece, type PdfPiece, type Piece, type TextPiece } from "./types.ts";

const SKIP_DIRS = new Set([".git", "node_modules"]);

export type PieceIndexEntry = {
  id: string;
  path: string;
  medium: "text" | "pdf";
};

function resolveInside(root: string, rel?: string): string {
  const rootAbs = path.resolve(root);
  const abs = rel ? path.resolve(rootAbs, rel) : rootAbs;
  const relToRoot = path.relative(rootAbs, abs);
  if (relToRoot.startsWith("..") || path.isAbsolute(relToRoot)) {
    throw new Error("path escapes library root");
  }
  return abs;
}

function indexPieces(root: string): Map<string, PieceIndexEntry> {
  const map = new Map<string, PieceIndexEntry>();
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
        return;
      }
      throw err;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) {
        continue;
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      let id: string | null = null;
      let medium: "text" | "pdf" | null = null;
      if (entry.name.endsWith(PIECE_EXT)) {
        id = entry.name.slice(0, -PIECE_EXT.length);
        medium = "text";
      } else if (entry.name.endsWith(HOST_EXT)) {
        id = entry.name.slice(0, -HOST_EXT.length);
        medium = "pdf";
      }
      if (!id || !medium || !isPieceId(id)) {
        continue;
      }
      const existing = map.get(id);
      if (existing) {
        throw new Error(`duplicate piece id ${id}: ${existing.path} and ${full}`);
      }
      map.set(id, { id, path: full, medium });
    }
  };
  walk(path.resolve(root));
  return map;
}

function loadPdfPiece(id: string, hostPath: string): PdfPiece {
  const meta = parseHostMeta(fs.readFileSync(hostPath, "utf8"));
  if (meta.id !== id) {
    throw new OverlayError(`host metadata id ${meta.id} does not match file ${id}`);
  }
  const dir = path.dirname(hostPath);
  const pdfPath = path.join(dir, pdfFileName(id));
  const overlayPath = path.join(dir, overlayFileName(id));
  if (!fs.existsSync(pdfPath)) {
    throw new OverlayError(`missing PDF copy: ${pdfPath}`);
  }
  let overlay = emptyOverlay();
  if (fs.existsSync(overlayPath)) {
    overlay = parseOverlay(fs.readFileSync(overlayPath, "utf8"));
  }
  return {
    id,
    path: hostPath,
    medium: "pdf",
    body: "",
    pdfPath,
    overlay,
    overlayPath,
    ...(meta.sourceName ? { sourceName: meta.sourceName } : {}),
  };
}

/** A library is a directory. Text piece = `{id}.intro.md`. PDF host = sidecar trio. */
export class Library {
  readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
    fs.mkdirSync(this.root, { recursive: true });
  }

  resolve(id: string): string | null {
    if (!isPieceId(id)) {
      return null;
    }
    return indexPieces(this.root).get(id)?.path ?? null;
  }

  resolveEntry(id: string): PieceIndexEntry | null {
    if (!isPieceId(id)) {
      return null;
    }
    return indexPieces(this.root).get(id) ?? null;
  }

  createPiece(opts?: { id?: string; body?: string; dir?: string }): TextPiece {
    const id = opts?.id ?? ulid();
    if (!isPieceId(id)) {
      throw new Error(`invalid piece id: ${id}`);
    }
    if (this.resolve(id)) {
      throw new Error(`piece already exists: ${id}`);
    }
    const dir = resolveInside(this.root, opts?.dir);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${id}${PIECE_EXT}`);
    const body = opts?.body ?? "";
    fs.writeFileSync(filePath, body, "utf8");
    return { id, path: filePath, medium: "text", body };
  }

  /**
   * Copy a local PDF into the library. The copy is immutable SoT for bytes;
   * rivets go in `{id}.intro.overlay.json`, never back into the PDF.
   */
  attachPdf(fromPath: string, opts?: { id?: string; dir?: string }): PdfPiece {
    const id = opts?.id ?? ulid();
    if (!isPieceId(id)) {
      throw new Error(`invalid piece id: ${id}`);
    }
    if (this.resolve(id)) {
      throw new Error(`piece already exists: ${id}`);
    }
    const source = path.resolve(fromPath);
    const bytes = fs.readFileSync(source);
    if (!isPdfMagic(bytes)) {
      throw new OverlayError("file is not a PDF (missing %PDF- magic)");
    }
    const dir = resolveInside(this.root, opts?.dir);
    fs.mkdirSync(dir, { recursive: true });
    const hostPath = path.join(dir, `${id}${HOST_EXT}`);
    const pdfPath = path.join(dir, pdfFileName(id));
    const overlayPath = path.join(dir, overlayFileName(id));
    const sourceName = path.basename(source);
    fs.writeFileSync(pdfPath, bytes);
    fs.writeFileSync(hostPath, serializeHostMeta(createHostMeta(id, sourceName)), "utf8");
    fs.writeFileSync(overlayPath, serializeOverlay(emptyOverlay()), "utf8");
    return {
      id,
      path: hostPath,
      medium: "pdf",
      body: "",
      pdfPath,
      overlay: emptyOverlay(),
      overlayPath,
      sourceName,
    };
  }

  load(id: string): Piece {
    const entry = this.resolveEntry(id);
    if (!entry) {
      throw new Error(`piece not found: ${id}`);
    }
    if (entry.medium === "pdf") {
      return loadPdfPiece(id, entry.path);
    }
    const body = fs.readFileSync(entry.path, "utf8");
    return { id, path: entry.path, medium: "text", body };
  }

  save(id: string, body: string): TextPiece {
    const entry = this.resolveEntry(id);
    if (!entry) {
      throw new Error(`piece not found: ${id}`);
    }
    if (entry.medium === "pdf") {
      throw new OverlayError("refuse to write text marks into a PDF host; use the overlay sidecar");
    }
    fs.writeFileSync(entry.path, body, "utf8");
    return { id, path: entry.path, medium: "text", body };
  }

  saveOverlay(id: string, overlay: PdfOverlay): PdfPiece {
    const piece = this.load(id);
    if (piece.medium !== "pdf") {
      throw new OverlayError("saveOverlay is only for PDF hosts");
    }
    const raw = serializeOverlay(overlay);
    fs.writeFileSync(piece.overlayPath, raw, "utf8");
    return { ...piece, overlay };
  }

  /** Raw PDF bytes. Never used as a text host. */
  readPdfBytes(id: string): Uint8Array {
    const piece = this.load(id);
    if (piece.medium !== "pdf") {
      throw new OverlayError("readPdfBytes is only for PDF hosts");
    }
    return fs.readFileSync(piece.pdfPath);
  }

  /** Piece ids and paths. Does not read bodies or PDF bytes. */
  list(): ListedPiece[] {
    return [...indexPieces(this.root).values()]
      .map(({ id, path: filePath, medium }) => ({ id, path: filePath, medium }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }
}
