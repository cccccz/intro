import { isPieceId, ulid } from "./id.ts";
import { parse } from "./parse.ts";
import { strip } from "./strip.ts";
import { formatClose, formatOpen } from "./syntax.ts";
import type { Damage, Rivet, RivetSpec } from "./types.ts";

export class AddError extends Error {
  readonly damage: Damage[];

  constructor(message: string, damage: Damage[]) {
    super(message);
    this.name = "AddError";
    this.damage = damage;
  }
}

type Node = RivetSpec & { children: Node[] };

export function flattenRivetSpecs(rivets: readonly Rivet[]): RivetSpec[] {
  const out: RivetSpec[] = [];
  const walk = (node: Rivet): void => {
    out.push({
      id: node.id,
      to: node.to,
      start: node.cleanStart,
      end: node.cleanEnd,
    });
    for (const child of node.children) {
      walk(child);
    }
  };
  for (const rivet of rivets) {
    walk(rivet);
  }
  return out;
}

export function rangesCross(
  a: { start: number; end: number },
  b: { start: number; end: number },
): boolean {
  if (a.end <= b.start || b.end <= a.start) {
    return false;
  }
  if (a.start === b.start && a.end === b.end) {
    return false;
  }
  const aWrapsB = a.start <= b.start && b.end <= a.end;
  const bWrapsA = b.start <= a.start && a.end <= b.end;
  return !(aWrapsB || bWrapsA);
}

function validateSpecs(clean: string, rivets: readonly RivetSpec[]): Damage[] {
  const damage: Damage[] = [];
  const seen = new Set<string>();
  for (const spec of rivets) {
    if (!isPieceId(spec.id)) {
      damage.push({
        kind: "invalid-id",
        message: `invalid rivet id: ${spec.id}`,
        index: spec.start,
        id: spec.id,
      });
    } else if (seen.has(spec.id)) {
      damage.push({
        kind: "duplicate-id",
        message: `duplicate rivet id: ${spec.id}`,
        index: spec.start,
        id: spec.id,
      });
    } else {
      seen.add(spec.id);
    }
    if (spec.to && !isPieceId(spec.to)) {
      damage.push({
        kind: "invalid-id",
        message: `invalid piece id in to: ${spec.to}`,
        index: spec.start,
        id: spec.id,
      });
    }
    if (
      !Number.isInteger(spec.start) ||
      !Number.isInteger(spec.end) ||
      spec.start < 0 ||
      spec.end > clean.length ||
      spec.start >= spec.end
    ) {
      damage.push({
        kind: "invalid-range",
        message: `invalid range [${spec.start}, ${spec.end})`,
        index: spec.start,
        id: spec.id,
      });
    }
  }
  for (let i = 0; i < rivets.length; i++) {
    for (let j = i + 1; j < rivets.length; j++) {
      if (rangesCross(rivets[i], rivets[j])) {
        damage.push({
          kind: "crossing",
          message: `ranges cross: ${rivets[i].id} and ${rivets[j].id}`,
          index: rivets[i].start,
          id: rivets[i].id,
        });
      }
    }
  }
  return damage;
}

function buildTree(rivets: readonly RivetSpec[]): Node[] {
  const indexed = rivets.map((spec, order) => ({ spec, order }));
  indexed.sort((a, b) => {
    if (a.spec.start !== b.spec.start) {
      return a.spec.start - b.spec.start;
    }
    if (a.spec.end !== b.spec.end) {
      return b.spec.end - a.spec.end;
    }
    return a.order - b.order;
  });

  const roots: Node[] = [];
  for (const { spec } of indexed) {
    const node: Node = { ...spec, children: [] };
    let level = roots;
    for (;;) {
      const parent = level.find(
        (candidate) =>
          candidate.start <= spec.start && spec.end <= candidate.end,
      );
      if (!parent) {
        break;
      }
      level = parent.children;
    }
    level.push(node);
  }
  return roots;
}

function emit(clean: string, start: number, end: number, children: Node[]): string {
  const ordered = [...children].sort((a, b) => {
    if (a.start !== b.start) {
      return a.start - b.start;
    }
    return b.end - a.end;
  });
  let pos = start;
  let out = "";
  for (const child of ordered) {
    out += clean.slice(pos, child.start);
    out += formatOpen(child.id, child.to);
    out += emit(clean, child.start, child.end, child.children);
    out += formatClose(child.id);
    pos = child.end;
  }
  out += clean.slice(pos, end);
  return out;
}

/**
 * Algebraic insert: wrap ranges in clean text.
 * Offsets are UTF-16 indices into `clean`, not stored as authority.
 */
export function add(clean: string, rivets: readonly RivetSpec[]): string {
  const damage = validateSpecs(clean, rivets);
  if (damage.length > 0) {
    throw new AddError("cannot add rivets: invalid or crossing ranges", damage);
  }
  return emit(clean, 0, clean.length, buildTree(rivets));
}

/**
 * Add one rivet to an already-marked body.
 * `selection` is in strip(body) coordinates (the clean view).
 */
export function addMark(
  body: string,
  selection: { start: number; end: number },
  attrs?: { id?: string; to?: string | null },
): string {
  const parsed = parse(body);
  if (parsed.damage.length > 0) {
    throw new AddError("host body is damaged; refuse to add", parsed.damage);
  }
  const clean = strip(body);
  const id = attrs?.id ?? ulid();
  return add(clean, [
    ...flattenRivetSpecs(parsed.rivets),
    { id, to: attrs?.to ?? null, start: selection.start, end: selection.end },
  ]);
}

/** Drop one rivet by id; remaining specs keep their clean ranges. Inner siblings stay. */
export function removeMark(body: string, rivetId: string): string {
  const parsed = parse(body);
  if (parsed.damage.length > 0) {
    throw new AddError("host body is damaged; refuse to remove", parsed.damage);
  }
  const specs = flattenRivetSpecs(parsed.rivets);
  const kept = specs.filter((spec) => spec.id !== rivetId);
  if (kept.length === specs.length) {
    return body;
  }
  return add(strip(body), kept);
}
