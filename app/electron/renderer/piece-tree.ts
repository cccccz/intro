/** Pieces list grouped by hangs. View only: the tree is rebuilt from links every time. */

export type TreeLink = {
  hostId: string;
  rivetId: string;
  sideId: string;
  page?: number;
  order: number;
  excerpt: string;
};

export type TreePiece = { id: string; medium: "text" | "pdf" };

export type TreeRow = {
  /** Unique per position: the same piece may hang under several parents. */
  key: string;
  pieceId: string;
  depth: number;
  parentKey: string | null;
  via: TreeLink | null;
  hasChildren: boolean;
};

function linksByHost(links: readonly TreeLink[]): Map<string, TreeLink[]> {
  const out = new Map<string, TreeLink[]>();
  for (const link of links) {
    const list = out.get(link.hostId) ?? [];
    list.push(link);
    out.set(link.hostId, list);
  }
  for (const list of out.values()) list.sort((a, b) => a.order - b.order || a.rivetId.localeCompare(b.rivetId));
  return out;
}

/** Depth-first rows. Roots: pieces nothing hangs, PDFs first; pieces only reachable through a cycle become roots too. */
export function pieceTree(pieces: readonly TreePiece[], links: readonly TreeLink[]): TreeRow[] {
  const known = new Set(pieces.map((p) => p.id));
  const live = links.filter((link) => known.has(link.hostId) && known.has(link.sideId));
  const byHost = linksByHost(live);
  const hung = new Set(live.map((link) => link.sideId));
  const rows: TreeRow[] = [];
  const reached = new Set<string>();
  const walk = (pieceId: string, depth: number, parentKey: string | null, via: TreeLink | null, path: ReadonlySet<string>): void => {
    const key = parentKey === null ? pieceId : `${parentKey}/${via!.rivetId}`;
    const children = (byHost.get(pieceId) ?? []).filter((link) => !path.has(link.sideId));
    reached.add(pieceId);
    rows.push({ key, pieceId, depth, parentKey, via, hasChildren: children.length > 0 });
    const next = new Set(path).add(pieceId);
    for (const link of children) walk(link.sideId, depth + 1, key, link, next);
  };
  const ordered = [...pieces].sort((a, b) => (a.medium === b.medium ? a.id.localeCompare(b.id) : a.medium === "pdf" ? -1 : 1));
  for (const piece of ordered) if (!hung.has(piece.id)) walk(piece.id, 0, null, null, new Set());
  for (const piece of ordered) if (!reached.has(piece.id)) walk(piece.id, 0, null, null, new Set());
  return rows;
}

/** Keys to show while filtering: every match plus its ancestors. */
export function filterRows(rows: readonly TreeRow[], matches: (row: TreeRow) => boolean): Set<string> {
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const keep = new Set<string>();
  for (const row of rows) {
    if (!matches(row)) continue;
    for (let at: TreeRow | undefined = row; at && !keep.has(at.key); at = at.parentKey ? byKey.get(at.parentKey) : undefined) {
      keep.add(at.key);
    }
  }
  return keep;
}

/** Hangs from a root host down to `pieceId`, following the first parent in link order. Empty when nothing hangs it. */
export function hangPath(pieceId: string, links: readonly TreeLink[], via?: TreeLink): TreeLink[] {
  const parents = new Map<string, TreeLink>();
  for (const link of [...links].sort((a, b) => a.order - b.order)) {
    if (!parents.has(link.sideId)) parents.set(link.sideId, link);
  }
  const path: TreeLink[] = [];
  const seen = new Set<string>([pieceId]);
  for (let link = via ?? parents.get(pieceId); link; link = parents.get(link.hostId)) {
    path.unshift(link);
    if (seen.has(link.hostId)) break;
    seen.add(link.hostId);
  }
  return path;
}
