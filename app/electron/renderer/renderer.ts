import { highlightHtml } from "./highlight.ts";

type Damage = { kind: string; message: string; index: number; id?: string };
type RivetSpec = { id: string; to?: string | null; start: number; end: number };

type PieceDto = {
  id: string;
  path: string;
  body: string;
  clean: string;
  rivets: RivetSpec[];
  damage: Damage[];
};

type LibraryDto = {
  root: string;
  pieces: { id: string; path: string }[];
};

type Ok<T> = { ok: true } & T;
type Err = { ok: false; error: string };

type IntroApi = {
  openLibrary: () => Promise<Ok<{ library: LibraryDto }> | Err>;
  openLibraryPath: (root: string) => Promise<Ok<{ library: LibraryDto }> | Err>;
  listPieces: () => Promise<Ok<{ pieces: { id: string; path: string }[] }> | Err>;
  createPiece: (opts?: {
    id?: string;
    body?: string;
  }) => Promise<Ok<{ piece: PieceDto; pieces: { id: string; path: string }[] }> | Err>;
  loadPiece: (id: string) => Promise<Ok<{ piece: PieceDto }> | Err>;
  persistClean: (id: string, clean: string) => Promise<Ok<{ piece: PieceDto }> | Err>;
  hangSide: (opts: {
    hostId: string;
    start: number;
    end: number;
    clean?: string;
    sideId?: string;
  }) => Promise<Ok<{ host: PieceDto; side: PieceDto; rivetId: string }> | Err>;
};

/** Keep in sync with app/write/session.ts (inlined so file:// loads one script). */
type Column = {
  pieceId: string;
  viaRivetId: string | null;
};

function openRoot(pieceId: string): Column[] {
  return [{ pieceId, viaRivetId: null }];
}

function pushSide(
  columns: readonly Column[],
  hostIndex: number,
  pieceId: string,
  viaRivetId: string,
): Column[] {
  if (hostIndex < 0 || hostIndex >= columns.length) {
    throw new Error("host column out of range");
  }
  return [...columns.slice(0, hostIndex + 1), { pieceId, viaRivetId }];
}

function closeAt(columns: readonly Column[], index: number): Column[] {
  if (index <= 0) {
    return [];
  }
  return columns.slice(0, index);
}

declare global {
  interface Window {
    intro: IntroApi & {
      onLibraryOpened: (cb: (library: LibraryDto) => void) => () => void;
    };
  }
}

type State = {
  root: string | null;
  pieces: { id: string; path: string }[];
  columns: Column[];
  views: Record<string, PieceDto>;
};

const state: State = {
  root: null,
  pieces: [],
  columns: [],
  views: {},
};

const el = {
  libPath: document.getElementById("lib-path") as HTMLElement,
  open: document.getElementById("btn-open") as HTMLButtonElement,
  newPiece: document.getElementById("btn-new-piece") as HTMLButtonElement,
  list: document.getElementById("piece-list") as HTMLUListElement,
  sidebarEmpty: document.getElementById("sidebar-empty") as HTMLElement,
  board: document.getElementById("board") as HTMLElement,
  columns: document.getElementById("columns") as HTMLElement,
  wires: document.querySelector("#wires") as SVGSVGElement,
  status: document.getElementById("status") as HTMLElement,
};

const persistTimers = new Map<string, number>();
let hotId: string | null = null;
let wireFrame = 0;

function setStatus(text: string, danger = false): void {
  el.status.textContent = text;
  el.status.classList.toggle("danger", danger);
}

function quoteOf(clean: string, start: number, end: number): string {
  const slice = clean.slice(start, end).replace(/\s+/g, " ").trim();
  if (slice.length <= 24) {
    return slice || "(empty)";
  }
  return `${slice.slice(0, 24)}…`;
}

function openRivetAt(hostIndex: number): string | null {
  return state.columns[hostIndex + 1]?.viaRivetId ?? null;
}

function inClip(node: Element, clip: Element): boolean {
  const a = node.getBoundingClientRect();
  const b = clip.getBoundingClientRect();
  return (
    a.bottom > b.top + 2 &&
    a.top < b.bottom - 2 &&
    a.right > b.left + 2 &&
    a.left < b.right - 2
  );
}

function paintHighlights(
  highlights: HTMLElement,
  clean: string,
  rivets: readonly RivetSpec[],
  openId: string | null,
): void {
  highlights.innerHTML = highlightHtml(clean, rivets, openId);
}

function syncHighlightScroll(editor: HTMLTextAreaElement, highlights: HTMLElement): void {
  highlights.scrollTop = editor.scrollTop;
  highlights.scrollLeft = editor.scrollLeft;
}

function paintColumn(column: HTMLElement): void {
  const index = Number(column.dataset.depth);
  const pieceId = column.dataset.pieceId;
  if (!pieceId) {
    return;
  }
  const view = state.views[pieceId];
  const editor = column.querySelector("textarea.editor") as HTMLTextAreaElement | null;
  const highlights = column.querySelector(".editor-highlights") as HTMLElement | null;
  if (!editor || !highlights) {
    return;
  }
  paintHighlights(highlights, editor.value, view?.rivets ?? [], openRivetAt(index));
  syncHighlightScroll(editor, highlights);
}

function scheduleWires(): void {
  if (wireFrame) {
    return;
  }
  wireFrame = requestAnimationFrame(() => {
    wireFrame = 0;
    drawWires();
  });
}

function setHot(id: string | null): void {
  hotId = id;
  el.columns.querySelectorAll("mark.hot, .rivet.hot").forEach((node) => {
    node.classList.remove("hot");
  });
  if (id) {
    el.columns.querySelectorAll(`mark[data-rivet="${CSS.escape(id)}"]`).forEach((node) => {
      node.classList.add("hot");
    });
    el.columns.querySelectorAll(`.rivet[data-rivet="${CSS.escape(id)}"]`).forEach((node) => {
      node.classList.add("hot");
    });
  }
  drawWires();
}

function drawWires(): void {
  const svg = el.wires;
  const board = el.board;
  const br = board.getBoundingClientRect();
  svg.setAttribute("viewBox", `0 0 ${Math.max(0, br.width)} ${Math.max(0, br.height)}`);
  svg.replaceChildren();
  const columns = Array.from(el.columns.querySelectorAll(":scope > .column")) as HTMLElement[];
  for (let i = 1; i < state.columns.length; i++) {
    const via = state.columns[i]?.viaRivetId;
    const host = columns[i - 1];
    const side = columns[i];
    if (!via || !host || !side) {
      continue;
    }
    const mark = host.querySelector(`mark[data-rivet="${CSS.escape(via)}"]`) as HTMLElement | null;
    if (!mark) {
      continue;
    }
    const clip = host.querySelector(".editor-stack") ?? host;
    if (!inClip(mark, clip) || !inClip(side, board)) {
      continue;
    }
    const a = mark.getBoundingClientRect();
    const b = side.getBoundingClientRect();
    const x1 = a.right - br.left;
    const y1 = a.top + a.height / 2 - br.top;
    const x2 = b.left - br.left;
    const y2 = b.top + 18 - br.top;
    const dx = Math.max(24, Math.min(72, (x2 - x1) / 2));
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute(
      "d",
      `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`,
    );
    path.dataset.rivet = via;
    if (via === hotId) {
      path.classList.add("hot");
    }
    svg.appendChild(path);
  }
}

function applyLibrary(library: LibraryDto): void {
  state.root = library.root;
  state.pieces = library.pieces;
  el.libPath.textContent = library.root;
  el.libPath.title = library.root;
  el.newPiece.disabled = false;
  renderSidebar();
}

function renderSidebar(): void {
  el.list.replaceChildren();
  el.sidebarEmpty.hidden = state.pieces.length > 0 || !state.root;
  el.sidebarEmpty.textContent = state.root
    ? "Empty library. Create a first piece."
    : "Open a folder to start. An empty folder is a new library.";
  const openIds = new Set(state.columns.map((c) => c.pieceId));
  for (const piece of state.pieces) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = piece.id;
    btn.title = piece.path;
    btn.classList.toggle("on", openIds.has(piece.id));
    btn.addEventListener("click", () => {
      void openRootPiece(piece.id);
    });
    li.append(btn);
    el.list.append(li);
  }
}

function renderColumns(): void {
  el.columns.replaceChildren();
  if (state.columns.length === 0) {
    const hint = document.createElement("p");
    hint.className = "empty-main";
    hint.textContent = state.root
      ? "Open a piece from the left, or create the first one."
      : "Open a local library folder to write.";
    el.columns.append(hint);
    drawWires();
    return;
  }
  state.columns.forEach((col, index) => {
    el.columns.append(renderColumn(col, index));
  });
  scheduleWires();
}

function renderColumn(col: Column, index: number): HTMLElement {
  const view = state.views[col.pieceId];
  const section = document.createElement("section");
  section.className = "column";
  section.dataset.pieceId = col.pieceId;
  section.dataset.depth = String(index);

  const head = document.createElement("div");
  head.className = "column-head";
  const depth = document.createElement("span");
  depth.className = "depth";
  depth.textContent = `d${index}`;
  const id = document.createElement("span");
  id.className = "id";
  id.textContent = col.pieceId;
  id.title = view?.path ?? col.pieceId;
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "Close";
  close.addEventListener("click", () => {
    state.columns = closeAt(state.columns, index);
    renderSidebar();
    renderColumns();
    setStatus(
      index === 0
        ? "Closed the chain. Rivets stay on disk."
        : "Closed this side and its subtree. Rivets stay on disk.",
    );
  });
  head.append(depth, id, close);

  const stack = document.createElement("div");
  stack.className = "editor-stack";
  const highlights = document.createElement("div");
  highlights.className = "editor-highlights";
  highlights.setAttribute("aria-hidden", "true");
  const editor = document.createElement("textarea");
  editor.className = "editor";
  editor.spellcheck = false;
  editor.value = view?.clean ?? "";
  editor.placeholder = "Write clean body text. TeX source can stay as $...$.";
  if (view && view.damage.length > 0) {
    editor.readOnly = true;
  }
  paintHighlights(highlights, editor.value, view?.rivets ?? [], openRivetAt(index));
  editor.addEventListener("input", () => {
    paintHighlights(
      highlights,
      editor.value,
      state.views[col.pieceId]?.rivets ?? [],
      openRivetAt(index),
    );
    syncHighlightScroll(editor, highlights);
    schedulePersist(col.pieceId, editor);
    scheduleWires();
  });
  editor.addEventListener("scroll", () => {
    syncHighlightScroll(editor, highlights);
    scheduleWires();
  });

  stack.append(highlights, editor);

  const tools = document.createElement("div");
  tools.className = "column-tools";
  const newSide = document.createElement("button");
  newSide.type = "button";
  newSide.textContent = "New side";
  newSide.disabled = Boolean(view && view.damage.length > 0);
  newSide.addEventListener("click", () => {
    void hangFromEditor(index, editor, undefined);
  });
  const hangExisting = document.createElement("button");
  hangExisting.type = "button";
  hangExisting.textContent = "Hang existing…";
  hangExisting.disabled = Boolean(view && view.damage.length > 0);
  hangExisting.addEventListener("click", () => {
    const sideId = window.prompt(
      "Piece id to reuse as the side (to=)",
      state.pieces.find((p) => p.id !== col.pieceId)?.id ?? "",
    );
    if (!sideId) {
      return;
    }
    void hangFromEditor(index, editor, sideId.trim());
  });
  tools.append(newSide, hangExisting);

  const rivets = document.createElement("div");
  rivets.className = "rivets";
  const h = document.createElement("h3");
  h.textContent = view && view.damage.length > 0
    ? `Damaged (${view.damage.map((d) => d.kind).join(", ")})`
    : `Rivets (${view?.rivets.length ?? 0})`;
  rivets.append(h);
  const openId = openRivetAt(index);
  if (view) {
    for (const rivet of view.rivets) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "rivet";
      btn.dataset.rivet = rivet.id;
      btn.classList.toggle("open", rivet.id === openId);
      const quote = document.createElement("span");
      quote.className = "quote";
      quote.textContent = `「${quoteOf(view.clean, rivet.start, rivet.end)}」`;
      const to = document.createElement("span");
      to.className = "muted";
      to.textContent = rivet.to ? `→ ${rivet.to}` : "(no side)";
      btn.append(quote, to);
      btn.disabled = !rivet.to;
      btn.addEventListener("pointerenter", () => {
        setHot(rivet.id);
      });
      btn.addEventListener("pointerleave", () => {
        setHot(null);
      });
      btn.addEventListener("click", () => {
        if (rivet.to) {
          void openSideColumn(index, rivet.to, rivet.id);
        }
      });
      rivets.append(btn);
    }
  }

  section.append(head, stack, tools, rivets);
  return section;
}

function schedulePersist(id: string, editor: HTMLTextAreaElement): void {
  const prev = persistTimers.get(id);
  if (prev !== undefined) {
    window.clearTimeout(prev);
  }
  persistTimers.set(
    id,
    window.setTimeout(() => {
      persistTimers.delete(id);
      void persistNow(id, editor.value);
    }, 350),
  );
}

async function persistNow(id: string, clean: string): Promise<void> {
  const result = await window.intro.persistClean(id, clean);
  if (!result.ok) {
    setStatus(result.error, true);
    return;
  }
  state.views[id] = result.piece;
  const column = el.columns.querySelector(
    `.column[data-piece-id="${CSS.escape(id)}"]`,
  ) as HTMLElement | null;
  if (column) {
    paintColumn(column);
  }
  scheduleWires();
  setStatus(`Saved ${id}`);
}

async function hangFromEditor(
  hostIndex: number,
  editor: HTMLTextAreaElement,
  sideId: string | undefined,
): Promise<void> {
  const host = state.columns[hostIndex];
  if (!host) {
    return;
  }
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  if (start === end) {
    setStatus("Select a span in this column first.", true);
    return;
  }
  const result = await window.intro.hangSide({
    hostId: host.pieceId,
    start,
    end,
    clean: editor.value,
    sideId,
  });
  if (!result.ok) {
    setStatus(result.error, true);
    return;
  }
  state.views[result.host.id] = result.host;
  state.views[result.side.id] = result.side;
  const listed = await window.intro.listPieces();
  if (listed.ok) {
    state.pieces = listed.pieces;
  }
  state.columns = pushSide(state.columns, hostIndex, result.side.id, result.rivetId);
  renderSidebar();
  renderColumns();
  const editors = el.columns.querySelectorAll("textarea.editor");
  const focus = editors[hostIndex + 1] as HTMLTextAreaElement | undefined;
  focus?.focus();
  setStatus(
    sideId
      ? `Hung existing ${result.side.id} from ${result.host.id}`
      : `Created side ${result.side.id} and wrote rivet ${result.rivetId}`,
  );
}

async function openRootPiece(id: string): Promise<void> {
  const result = await window.intro.loadPiece(id);
  if (!result.ok) {
    setStatus(result.error, true);
    return;
  }
  state.views[id] = result.piece;
  state.columns = openRoot(id);
  renderSidebar();
  renderColumns();
  const editor = el.columns.querySelector("textarea.editor") as HTMLTextAreaElement | null;
  editor?.focus();
  setStatus(`Opened ${id}`);
}

async function openSideColumn(
  hostIndex: number,
  pieceId: string,
  rivetId: string,
): Promise<void> {
  const result = await window.intro.loadPiece(pieceId);
  if (!result.ok) {
    setStatus(result.error, true);
    return;
  }
  state.views[pieceId] = result.piece;
  state.columns = pushSide(state.columns, hostIndex, pieceId, rivetId);
  renderSidebar();
  renderColumns();
  setStatus(`Opened side ${pieceId}`);
}

el.open.addEventListener("click", async () => {
  const result = await window.intro.openLibrary();
  if (!result.ok) {
    if (result.error !== "canceled") {
      setStatus(result.error, true);
    }
    return;
  }
  applyLibrary(result.library);
  state.columns = [];
  state.views = {};
  renderColumns();
  setStatus(`Library ${result.library.root}`);
});

el.newPiece.addEventListener("click", async () => {
  const result = await window.intro.createPiece({ body: "" });
  if (!result.ok) {
    setStatus(result.error, true);
    return;
  }
  state.pieces = result.pieces;
  state.views[result.piece.id] = result.piece;
  state.columns = openRoot(result.piece.id);
  renderSidebar();
  renderColumns();
  const editor = el.columns.querySelector("textarea.editor") as HTMLTextAreaElement | null;
  editor?.focus();
  setStatus(`Created ${result.piece.id}`);
});

window.intro.onLibraryOpened((library) => {
  applyLibrary(library);
  renderColumns();
  setStatus(`Library ${library.root}`);
});

el.columns.addEventListener("scroll", scheduleWires);
window.addEventListener("resize", scheduleWires);
new ResizeObserver(scheduleWires).observe(el.board);

renderSidebar();
renderColumns();
