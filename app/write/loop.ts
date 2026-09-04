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

export type PieceView = {
  id: string;
  path: string;
  body: string;
  clean: string;
  rivets: RivetSpec[];
  damage: Damage[];
};

export type HangResult = {
  host: Piece;
  side: Piece;
  rivetId: string;
};

export function pieceView(piece: Piece): PieceView {
  const parsed = parse(piece.body);
  return {
    id: piece.id,
    path: piece.path,
    body: piece.body,
    clean: strip(piece.body),
    rivets: flattenRivetSpecs(parsed.rivets),
    damage: parsed.damage,
  };
}

function specsThatFit(specs: readonly RivetSpec[], clean: string): RivetSpec[] {
  return specs.filter(
    (spec) => spec.start >= 0 && spec.end <= clean.length && spec.start < spec.end,
  );
}

/**
 * Write clean editor text back, keeping rivets whose ranges still fit.
 * Damaged hosts are refused (same as addMark).
 */
export function persistClean(lib: Library, id: string, clean: string): Piece {
  const current = lib.load(id);
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
  if (opts?.clean !== undefined) {
    persistClean(lib, hostId, opts.clean);
  }
  const side = opts?.sideId
    ? lib.load(opts.sideId)
    : lib.createPiece({ body: "" });
  const rivetId = ulid();
  const host = lib.load(hostId);
  const marked = addMark(host.body, selection, { id: rivetId, to: side.id });
  return { host: lib.save(hostId, marked), side, rivetId };
}
