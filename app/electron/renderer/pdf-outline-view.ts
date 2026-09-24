import {
  currentOutlineKey,
  filterOutline,
  flattenOutline,
  initialExpanded,
  matchParts,
  nearestShown,
  visibleRows,
  type OutlineFilter,
  type OutlineItem,
  type OutlineRow,
} from "./pdf-outline.ts";

export type OutlineView = {
  /** Call when the drawer opens: unfold to the reading position and focus it. */
  reveal: () => void;
  setPage: (page: number) => void;
};

export function mountOutlineView(drawer: HTMLElement, items: readonly OutlineItem[], opts: {
  page: () => number;
  goto: (page: number) => void;
  /** Kept by the caller so re-rendering the column does not refold the tree. */
  expanded?: Set<string>;
}): OutlineView {
  const rows = flattenOutline(items);
  const byKey = new Map(rows.map((row) => [row.key, row]));
  let current = currentOutlineKey(rows, opts.page());
  const expanded = opts.expanded ?? new Set<string>();
  if (expanded.size === 0) for (const key of initialExpanded(rows, current)) expanded.add(key);
  let filter: OutlineFilter | null = null;
  let focusKey: string | null = null;
  let shown: OutlineRow[] = [];
  const elements = new Map<string, HTMLElement>();

  const head = document.createElement("div");
  head.className = "outline-head";
  const search = document.createElement("input");
  search.type = "search";
  search.className = "outline-filter";
  search.placeholder = "筛选目录";
  search.setAttribute("aria-label", "筛选目录");
  const fold = document.createElement("button");
  fold.type = "button";
  fold.className = "outline-fold";
  fold.textContent = "收起";
  fold.title = "全部收起";
  head.append(search, fold);

  const tree = document.createElement("ul");
  tree.className = "outline-tree";
  tree.setAttribute("role", "tree");
  tree.setAttribute("aria-label", "目录");
  const empty = document.createElement("p");
  empty.className = "outline-empty muted";
  empty.textContent = "没有匹配的条目。";
  empty.hidden = true;
  drawer.replaceChildren(head, tree, empty);

  const paintCurrent = (): void => {
    const mark = nearestShown(current, new Set(elements.keys()));
    for (const [key, li] of elements) {
      if (key === mark) li.setAttribute("aria-current", key === current ? "location" : "true");
      else li.removeAttribute("aria-current");
    }
  };

  const setFocusKey = (key: string | null, move: boolean): void => {
    focusKey = key;
    for (const [k, li] of elements) li.tabIndex = k === key ? 0 : -1;
    const li = key ? elements.get(key) : undefined;
    if (li && move) {
      li.focus({ preventScroll: true });
      li.scrollIntoView({ block: "nearest" });
    }
  };

  const render = (): void => {
    shown = visibleRows(rows, expanded, filter);
    const shownParents = new Set(shown.map((row) => row.parent));
    elements.clear();
    const fragment = document.createDocumentFragment();
    for (const row of shown) {
      const li = document.createElement("li");
      li.className = "outline-item";
      li.dataset.key = row.key;
      li.setAttribute("role", "treeitem");
      li.setAttribute("aria-level", String(row.level + 1));
      li.style.setProperty("--level", String(row.level));
      const open = filter ? shownParents.has(row.key) : expanded.has(row.key);
      if (row.hasChildren) li.setAttribute("aria-expanded", String(open));
      if (filter?.matches.has(row.key) === false) li.classList.add("context");
      if (row.page === null) li.classList.add("no-page");
      li.title = row.page === null ? row.title : `${row.title}\n第 ${row.page} 页`;

      const twisty = document.createElement("span");
      twisty.className = "outline-twisty";
      twisty.setAttribute("aria-hidden", "true");
      if (row.hasChildren) twisty.textContent = "▸";
      const title = document.createElement("span");
      title.className = "outline-title";
      for (const part of matchParts(row.title, filter?.query ?? "")) {
        if (part.hit) {
          const hit = document.createElement("mark");
          hit.textContent = part.text;
          title.append(hit);
        } else {
          title.append(part.text);
        }
      }
      const page = document.createElement("span");
      page.className = "outline-page";
      page.textContent = row.page === null ? "" : String(row.page);
      li.append(twisty, title, page);
      elements.set(row.key, li);
      fragment.append(li);
    }
    tree.replaceChildren(fragment);
    empty.hidden = shown.length > 0;
    paintCurrent();
    const keep = focusKey && elements.has(focusKey) ? focusKey : nearestShown(current, new Set(elements.keys()));
    setFocusKey(keep ?? shown[0]?.key ?? null, false);
  };

  const toggle = (key: string, open?: boolean): void => {
    if (filter || !byKey.get(key)?.hasChildren) return;
    const next = open ?? !expanded.has(key);
    if (next) expanded.add(key);
    else expanded.delete(key);
    focusKey = key;
    render();
    setFocusKey(key, true);
  };

  const activate = (key: string): void => {
    const row = byKey.get(key);
    if (!row) return;
    setFocusKey(key, true);
    if (row.page !== null) opts.goto(row.page);
    else toggle(key);
  };

  tree.addEventListener("click", (ev) => {
    const li = (ev.target as HTMLElement).closest<HTMLElement>("li.outline-item");
    if (!li?.dataset.key) return;
    if ((ev.target as HTMLElement).closest(".outline-twisty")) toggle(li.dataset.key);
    else activate(li.dataset.key);
  });

  tree.addEventListener("keydown", (ev) => {
    const index = shown.findIndex((row) => row.key === focusKey);
    const row = shown[index];
    if (!row) return;
    const move = (to: number): void => {
      const next = shown[Math.max(0, Math.min(shown.length - 1, to))];
      if (next) setFocusKey(next.key, true);
    };
    let handled = true;
    if (ev.key === "ArrowDown") move(index + 1);
    else if (ev.key === "ArrowUp") {
      if (index === 0) search.focus();
      else move(index - 1);
    } else if (ev.key === "Home") move(0);
    else if (ev.key === "End") move(shown.length - 1);
    else if (ev.key === "ArrowRight") {
      if (row.hasChildren && !filter && !expanded.has(row.key)) toggle(row.key, true);
      else if (row.hasChildren) move(index + 1);
    } else if (ev.key === "ArrowLeft") {
      if (row.hasChildren && !filter && expanded.has(row.key)) toggle(row.key, false);
      else if (row.parent) setFocusKey(row.parent, true);
    } else if (ev.key === "Enter") activate(row.key);
    else if (ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey && !ev.altKey && ev.key !== " ") {
      search.focus();
      handled = false;
    } else handled = false;
    if (handled) {
      ev.preventDefault();
      ev.stopPropagation();
    }
  });

  search.addEventListener("input", () => {
    filter = filterOutline(rows, search.value);
    focusKey = null;
    render();
    if (filter) setFocusKey([...filter.matches][0] ?? null, false);
  });
  search.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && search.value) {
      ev.preventDefault();
      ev.stopPropagation();
      search.value = "";
      search.dispatchEvent(new Event("input"));
    } else if (ev.key === "ArrowDown" && focusKey) {
      ev.preventDefault();
      setFocusKey(focusKey, true);
    } else if (ev.key === "Enter" && filter) {
      ev.preventDefault();
      const first = [...filter.matches][0];
      if (first) activate(first);
    }
  });

  fold.addEventListener("click", () => {
    expanded.clear();
    for (const key of initialExpanded(rows, null)) expanded.add(key);
    if (filter) {
      search.value = "";
      filter = null;
    }
    focusKey = null;
    render();
  });

  render();

  return {
    reveal: () => {
      current = currentOutlineKey(rows, opts.page());
      if (!filter && current) for (const key of initialExpanded(rows, current)) expanded.add(key);
      focusKey = null;
      render();
      const target = focusKey ? elements.get(focusKey) : undefined;
      target?.scrollIntoView({ block: "center" });
      target?.focus({ preventScroll: true });
    },
    setPage: (page) => {
      const next = currentOutlineKey(rows, page);
      if (next === current) return;
      current = next;
      paintCurrent();
    },
  };
}
