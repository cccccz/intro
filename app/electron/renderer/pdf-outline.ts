/**
 * PDF outline as a flat, pre-order row list. The drawer renders only the rows
 * whose ancestors are expanded, or the matches (plus their ancestors) while filtering.
 */

export type OutlineItem = {
  title: string;
  page: number | null;
  children: OutlineItem[];
};

export type OutlineRow = {
  /** Index path such as "0.3.1"; stable for one outline. */
  key: string;
  parent: string | null;
  level: number;
  title: string;
  page: number | null;
  hasChildren: boolean;
};

export type OutlineFilter = {
  query: string;
  matches: Set<string>;
  visible: Set<string>;
};

export function flattenOutline(items: readonly OutlineItem[]): OutlineRow[] {
  const rows: OutlineRow[] = [];
  const walk = (list: readonly OutlineItem[], parent: string | null, level: number): void => {
    list.forEach((item, i) => {
      const key = parent === null ? String(i) : `${parent}.${i}`;
      rows.push({ key, parent, level, title: item.title, page: item.page, hasChildren: item.children.length > 0 });
      walk(item.children, key, level + 1);
    });
  };
  walk(items, null, 0);
  return rows;
}

export function ancestorKeys(key: string): string[] {
  const parts = key.split(".");
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("."));
}

/**
 * The section being read: the entry with the greatest page not after `page`.
 * Ties go to the later entry in reading order, which is the deeper one when a
 * chapter and its first section start on the same page.
 */
export function currentOutlineKey(rows: readonly OutlineRow[], page: number): string | null {
  let best: OutlineRow | null = null;
  for (const row of rows) {
    if (row.page === null || row.page > page) continue;
    if (!best || row.page >= best.page!) best = row;
  }
  return best?.key ?? null;
}

/**
 * Open a lone root (a book title wrapping everything) and keep opening while
 * each level has a single entry, then open the path to the current section.
 */
export function initialExpanded(rows: readonly OutlineRow[], current: string | null): Set<string> {
  const open = new Set<string>();
  let level: OutlineRow[] = rows.filter((r) => r.parent === null);
  while (level.length === 1 && level[0]!.hasChildren) {
    const only = level[0]!;
    open.add(only.key);
    level = rows.filter((r) => r.parent === only.key);
  }
  if (current) {
    for (const key of ancestorKeys(current)) open.add(key);
  }
  return open;
}

export function filterOutline(rows: readonly OutlineRow[], query: string): OutlineFilter | null {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return null;
  const matches = new Set<string>();
  const visible = new Set<string>();
  for (const row of rows) {
    if (!row.title.toLocaleLowerCase().includes(q)) continue;
    matches.add(row.key);
    visible.add(row.key);
    for (const key of ancestorKeys(row.key)) visible.add(key);
  }
  return { query: q, matches, visible };
}

export function visibleRows(
  rows: readonly OutlineRow[],
  expanded: ReadonlySet<string>,
  filter: OutlineFilter | null,
): OutlineRow[] {
  if (filter) return rows.filter((row) => filter.visible.has(row.key));
  return rows.filter((row) => ancestorKeys(row.key).every((key) => expanded.has(key)));
}

/** Where to show the reading position when its own row is folded away. */
export function nearestShown(key: string | null, shown: ReadonlySet<string>): string | null {
  if (!key) return null;
  if (shown.has(key)) return key;
  const up = ancestorKeys(key).reverse();
  return up.find((k) => shown.has(k)) ?? null;
}

/** Split a title into plain and matched parts for highlighting. */
export function matchParts(title: string, query: string): { text: string; hit: boolean }[] {
  if (!query) return [{ text: title, hit: false }];
  const lower = title.toLocaleLowerCase();
  const parts: { text: string; hit: boolean }[] = [];
  let from = 0;
  for (let at = lower.indexOf(query); at >= 0; at = lower.indexOf(query, at + query.length)) {
    if (at > from) parts.push({ text: title.slice(from, at), hit: false });
    parts.push({ text: title.slice(at, at + query.length), hit: true });
    from = at + query.length;
  }
  if (from < title.length) parts.push({ text: title.slice(from), hit: false });
  return parts;
}
