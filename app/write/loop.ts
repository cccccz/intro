import { Library } from "../library/index.ts";
import type { Piece } from "../library/types.ts";
import {
  AddError,
  add,
  addMark,
  removeMark,
  flattenRivetSpecs,
  parse,
  strip,
  ulid,
} from "../marks/index.ts";
import type { Damage, RivetSpec } from "../marks/types.ts";
import { relocateAnchors, type EditBatch } from "./anchor-edits.ts";
import {
  OverlayError,
  addOverlayRivet,
  removeOverlayRivet,
  type OverlayRivet,
  type PdfAnchor,
} from "../pdf/overlay.ts";

export type PieceView = {
  id: string;
  path: string;
  medium: "text" | "pdf";
  title: string;
  titled: boolean;
  body: string;
  clean: string;
  rivets: RivetSpec[];
  overlayRivets: OverlayRivet[];
  damage: Damage[];
  pdfPath?: string;
  sourceName?: string;
};

export type HangResult = {
  host: Piece;
  side: Piece;
  rivetId: string;
};

export function pieceView(piece: Piece): PieceView {
  if (piece.medium === "pdf") {
    return {
      id: piece.id,
      path: piece.path,
      medium: "pdf",
      title: piece.title,
      titled: piece.titled,
      body: "",
      clean: "",
      rivets: [],
      overlayRivets: piece.overlay.rivets,
      damage: [],
      pdfPath: piece.pdfPath,
      ...(piece.sourceName ? { sourceName: piece.sourceName } : {}),
    };
  }
  const parsed = parse(piece.body);
  return {
    id: piece.id,
    path: piece.path,
    medium: "text",
    title: piece.title,
    titled: piece.titled,
    body: piece.body,
    clean: strip(piece.body),
    rivets: flattenRivetSpecs(parsed.rivets),
    overlayRivets: [],
    damage: parsed.damage,
  };
}

function requireTextHost(lib: Library, id: string): Piece {
  const piece = lib.load(id);
  if (piece.medium !== "text") {
    throw new OverlayError("PDF host is not a text mark target; use hangPdfSide");
  }
  return piece;
}

/**
 * Write clean editor text back, relocating rivets through validated edits.
 * Damaged hosts are refused (same as addMark). PDF hosts are refused.
 */
export function persistClean(lib: Library, id: string, clean: string, batch?: EditBatch): Piece {
  const current = requireTextHost(lib, id);
  const parsed = parse(current.body);
  if (parsed.damage.length > 0) {
    throw new AddError("host body is damaged; refuse to persist", parsed.damage);
  }
  if (strip(current.body) === clean) {
    return current;
  }
  const specs = relocateAnchors(strip(current.body), clean, flattenRivetSpecs(parsed.rivets), batch);
  return lib.save(id, add(clean, specs));
}

/** Optimistic range edit used by editable pinned projections. */
export function editExcerpt(lib: Library, id: string, expected: string, start: number, end: number, replacement: string): Piece {
  const host = requireTextHost(lib, id);
  const clean = strip(host.body);
  if (clean !== expected) throw new Error("原笔记已变化，请重新载入置顶内容后再保存。");
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > clean.length || start >= end) throw new Error("选区无效");
  const parsed = parse(host.body);
  if (parsed.damage.length) throw new Error("原笔记标记损坏，未写入。");
  if (clean.slice(start, end) === replacement) return host;
  const delta = replacement.length - (end - start);
  const specs = flattenRivetSpecs(parsed.rivets).map(spec => {
    if (spec.end <= start) return spec;
    if (spec.start >= end) return { ...spec, start: spec.start + delta, end: spec.end + delta };
    if (spec.start <= start && spec.end >= end && spec.end + delta > spec.start) return { ...spec, end: spec.end + delta };
    throw new Error("选区内含有其他挂接边界，请返回原文编辑，避免移动其来源。");
  });
  return lib.save(id, add(clean.slice(0, start) + replacement + clean.slice(end), specs));
}

/**
 * M1 hang: optional persist of current clean text, write one rivet via addMark,
 * create or open the side piece, save the host.
 */
export function hangSide(
  lib: Library,
  hostId: string,
  selection: { start: number; end: number },
  opts?: { sideId?: string; clean?: string },
): HangResult {
  requireTextHost(lib, hostId);
  if (opts?.clean !== undefined) {
    persistClean(lib, hostId, opts.clean);
  }
  const side = opts?.sideId
    ? lib.load(opts.sideId)
    : lib.createPiece({ body: "" });
  const rivetId = ulid();
  const host = lib.load(hostId);
  if (host.medium !== "text") {
    throw new OverlayError("PDF host is not a text mark target; use hangPdfSide");
  }
  const marked = addMark(host.body, selection, { id: rivetId, to: side.id });
  return { host: lib.save(hostId, marked), side, rivetId };
}

/**
 * Hang a side from a PDF host region. Writes the overlay sidecar only.
 * The PDF bytes are not modified. The side is a normal `{id}.intro.md`.
 */
export function hangPdfSide(
  lib: Library,
  hostId: string,
  anchors: readonly PdfAnchor[],
  opts?: { sideId?: string; quote?: string; rivetId?: string },
): HangResult {
  const host = lib.load(hostId);
  if (host.medium !== "pdf") {
    throw new OverlayError("hangPdfSide is only for PDF hosts");
  }
  const side = opts?.sideId
    ? lib.load(opts.sideId)
    : lib.createPiece({ body: "" });
  if (side.medium !== "text") {
    throw new OverlayError("PDF overlay sides must be text pieces ({id}.intro.md)");
  }
  const rivetId = opts?.rivetId ?? ulid();
  const overlay = addOverlayRivet(host.overlay, {
    id: rivetId,
    to: side.id,
    anchors: [...anchors],
    ...(opts?.quote ? { quote: opts.quote } : {}),
  });
  return { host: lib.saveOverlay(hostId, overlay), side, rivetId };
}

export type DropResult = {
  deleted: string[];
  hosts: Piece[];
};

/** Remove only this host's rivet. Target notes and their links remain intact. */
export function detachSide(lib: Library, hostId: string, rivetId: string, clean?: string): Piece {
  let host = lib.load(hostId);
  if (host.medium === "pdf") {
    return lib.saveOverlay(hostId, removeOverlayRivet(host.overlay, rivetId));
  }
  if (clean !== undefined) host = persistClean(lib, hostId, clean);
  if (host.medium !== "text") throw new Error("Expected text host");
  return lib.save(hostId, removeMark(host.body, rivetId));
}

type InboundLink = {
  hostId: string;
  rivetId: string;
};

function outboundTos(piece: Piece): string[] {
  if (piece.medium === "pdf") {
    return piece.overlay.rivets
      .map((rivet) => rivet.to)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
  }
  return flattenRivetSpecs(parse(piece.body).rivets)
    .map((spec) => spec.to)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}

function inboundIndex(lib: Library): Map<string, InboundLink[]> {
  const map = new Map<string, InboundLink[]>();
  const addLink = (to: string | null | undefined, hostId: string, rivetId: string): void => {
    if (!to) {
      return;
    }
    const list = map.get(to) ?? [];
    list.push({ hostId, rivetId });
    map.set(to, list);
  };
  for (const listed of lib.list()) {
    const piece = lib.load(listed.id);
    if (piece.medium === "pdf") {
      for (const rivet of piece.overlay.rivets) {
        addLink(rivet.to, piece.id, rivet.id);
      }
    } else {
      for (const spec of flattenRivetSpecs(parse(piece.body).rivets)) {
        addLink(spec.to, piece.id, spec.id);
      }
    }
  }
  return map;
}

function deletionSet(lib: Library, rootId: string): Set<string> {
  const inbound = inboundIndex(lib);
  const deleted = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const piece = lib.load(id);
    for (const child of outboundTos(piece)) {
      if (deleted.has(child)) {
        continue;
      }
      const entry = lib.resolveEntry(child);
      if (!entry || entry.medium !== "text") {
        continue;
      }
      const others = (inbound.get(child) ?? []).filter((link) => !deleted.has(link.hostId));
      if (others.length === 0) {
        deleted.add(child);
        queue.push(child);
      }
    }
  }
  return deleted;
}

function bodyWithoutDeletedTos(body: string, deleted: ReadonlySet<string>): string {
  const parsed = parse(body);
  if (parsed.damage.length > 0) {
    throw new AddError("host body is damaged; refuse to drop", parsed.damage);
  }
  const specs = flattenRivetSpecs(parsed.rivets);
  const kept = specs.filter((spec) => !spec.to || !deleted.has(spec.to));
  if (kept.length === specs.length) {
    return body;
  }
  return add(strip(body), kept);
}

/**
 * Delete a text side and unreferenced children. Strips inbound rivets on survivors.
 * PDF hosts are never deleted.
 */
export function dropSide(lib: Library, pieceId: string): DropResult {
  const entry = lib.resolveEntry(pieceId);
  if (!entry) {
    throw new Error(`piece not found: ${pieceId}`);
  }
  if (entry.medium !== "text") {
    throw new OverlayError("dropSide is only for text pieces");
  }
  const deleted = deletionSet(lib, pieceId);
  const hosts: Piece[] = [];
  for (const listed of lib.list()) {
    if (deleted.has(listed.id)) {
      continue;
    }
    const piece = lib.load(listed.id);
    if (piece.medium === "pdf") {
      let overlay = piece.overlay;
      let changed = false;
      for (const rivet of piece.overlay.rivets) {
        if (rivet.to && deleted.has(rivet.to)) {
          overlay = removeOverlayRivet(overlay, rivet.id);
          changed = true;
        }
      }
      if (changed) {
        hosts.push(lib.saveOverlay(listed.id, overlay));
      }
    } else {
      const next = bodyWithoutDeletedTos(piece.body, deleted);
      if (next !== piece.body) {
        hosts.push(lib.save(listed.id, next));
      }
    }
  }
  for (const id of deleted) {
    lib.removeTextPiece(id);
  }
  return { deleted: [...deleted], hosts };
}
