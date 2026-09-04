import fs from "node:fs";
import path from "node:path";
import { isPieceId, ulid } from "../marks/id.ts";
import { PIECE_EXT, type Piece } from "./types.ts";

const SKIP_DIRS = new Set([".git", "node_modules"]);

function resolveInside(root: string, rel?: string): string {
  const rootAbs = path.resolve(root);
  const abs = rel ? path.resolve(rootAbs, rel) : rootAbs;
  const relToRoot = path.relative(rootAbs, abs);
  if (relToRoot.startsWith("..") || path.isAbsolute(relToRoot)) {
    throw new Error("path escapes library root");
  }
  return abs;
}

function indexPieces(root: string): Map<string, string> {
  const map = new Map<string, string>();
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
      if (!entry.isFile() || !entry.name.endsWith(PIECE_EXT)) {
        continue;
      }
      const id = entry.name.slice(0, -PIECE_EXT.length);
      if (!isPieceId(id)) {
        continue;
      }
      const existing = map.get(id);
      if (existing) {
        throw new Error(`duplicate piece id ${id}: ${existing} and ${full}`);
      }
      map.set(id, full);
    }
  };
  walk(path.resolve(root));
  return map;
}

/** A library is a directory. One piece = one `{id}.intro.md` file. */
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
    return indexPieces(this.root).get(id) ?? null;
  }

  createPiece(opts?: { id?: string; body?: string; dir?: string }): Piece {
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
    return { id, path: filePath, body };
  }

  load(id: string): Piece {
    const filePath = this.resolve(id);
    if (!filePath) {
      throw new Error(`piece not found: ${id}`);
    }
    const body = fs.readFileSync(filePath, "utf8");
    return { id, path: filePath, body };
  }

  save(id: string, body: string): Piece {
    const filePath = this.resolve(id);
    if (!filePath) {
      throw new Error(`piece not found: ${id}`);
    }
    fs.writeFileSync(filePath, body, "utf8");
    return { id, path: filePath, body };
  }

  /** Piece ids and paths. Does not read bodies. */
  list(): { id: string; path: string }[] {
    return [...indexPieces(this.root).entries()]
      .map(([id, filePath]) => ({ id, path: filePath }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }
}
