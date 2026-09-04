import { Library } from "../library/index.ts";
import type { Piece } from "../library/types.ts";
import {
  AddError,
  add,
  addMark,
  flattenRivetSpecs,
  parse,
  strip,
  ulid,
} from "../marks/index.ts";
import type { Damage, RivetSpec } from "../marks/types.ts";
import { OverlayError, addOverlayRivet, type OverlayRivet, type PdfAnchor } from "../pdf/overlay.ts";

export type PieceView = {
  id: string;
  path: string;
  medium: "text" | "pdf";
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
    body: piece.body,
    clean: strip(piece.body),
    rivets: flattenRivetSpecs(parsed.rivets),
    overlayRivets: [],
    damage: parsed.damage,
  };
}

function specsThatFit(specs: readonly RivetSpec[], clean: string): RivetSpec[] {
  return specs.filter(
    (spec) => spec.start >= 0 && spec.end <= clean.length && spec.start < spec.end,
  );
}

function requireTextHost(lib: Library, id: string): Piece {
  const piece = lib.load(id);
  if (piece.medium !== "text") {
    throw new OverlayError("PDF host is not a text mark target; use hangPdfSide");
  }
  return piece;
}

/**
 * Write clean editor text back, keeping rivets whose ranges still fit.
 * Damaged hosts are refused (same as addMark). PDF hosts are refused.
 */
export function persistClean(lib: Library, id: string, clean: string): Piece {
  const current = requireTextHost(lib, id);
  const parsed = parse(current.body);
  if (parsed.damage.length > 0) {
    throw new AddError("host body is damaged; refuse to persist", parsed.damage);
  }
  if (strip(current.body) === clean) {
    return current;
  }
  const specs = specsThatFit(flattenRivetSpecs(parsed.rivets), clean);
  return lib.save(id, add(clean, specs));
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
