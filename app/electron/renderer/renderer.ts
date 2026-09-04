import {
  attachPoint,
  clientToAnchor,
  rectsForRivet,
  rectsIntersect,
  type AnchorRect,
} from "./geometry.ts";
import { highlightHtml } from "./highlight.ts";
import {
  forgetAllPdfDocs,
  mountPdfView,
  type OverlayRivet,
  type PdfViewHandle,
} from "./pdf-view.ts";
import { katexMath, renderHtml } from "./render.ts";

type Damage = { kind: string; message: string; index: number; id?: string };
type RivetSpec = { id: string; to?: string | null; start: number; end: number };

type PieceDto = {
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

type LibraryDto = {
  root: string;
  pieces: { id: string; path: string; medium: "text" | "pdf" }[];
};

type Ok<T> = { ok: true } & T;
type Err = { ok: false; error: string };

type IntroApi = {
  openLibrary: () => Promise<Ok<{ library: LibraryDto }> | Err>;
  openLibraryPath: (root: string) => Promise<Ok<{ library: LibraryDto }> | Err>;
  listPieces: () => Promise<Ok<{ pieces: LibraryDto["pieces"] }> | Err>;
  createPiece: (opts?: {
    id?: string;
    body?: string;
  }) => Promise<Ok<{ piece: PieceDto; pieces: LibraryDto["pieces"] }> | Err>;
  loadPiece: (id: string) => Promise<Ok<{ piece: PieceDto }> | Err>;
  persistClean: (id: string, clean: string) => Promise<Ok<{ piece: PieceDto }> | Err>;
  hangSide: (opts: {
    hostId: string;
    start: number;
    end: number;
    clean?: string;
    sideId?: string;
  }) => Promise<Ok<{ host: PieceDto; side: PieceDto; rivetId: string }> | Err>;
  attachPdf: () => Promise<Ok<{ piece: PieceDto; pieces: LibraryDto["pieces"] }> | Err>;
  readPdf: (id: string) => Promise<Ok<{ data: Uint8Array }> | Err>;
  hangPdfSide: (opts: {
    hostId: string;
    anchors: OverlayRivet["anchors"];
    sideId?: string;
    quote?: string;
  }) => Promise<Ok<{ host: PieceDto; side: PieceDto; rivetId: string }> | Err>;
};

/** Keep in sync with app/write/session.ts (inlined so file:// loads one script). */
const ROOT_ID = "root";

type OpenNode = {
  id: string;
  pieceId: string;
  viaRivetId: string | null;
  parentId: string | null;
  depth: number;
};

function openRoot(pieceId: string): OpenNode[] {
  return [{ id: ROOT_ID, pieceId, viaRivetId: null, parentId: null, depth: 0 }];
}

function openSide(
  nodes: readonly OpenNode[],
  parentId: string,
  pieceId: string,
  viaRivetId: string,
): OpenNode[] {
  const parent = nodes.find((n) => n.id === parentId);
  if (!parent) {
    throw new Error("parent not open");
  }
  if (nodes.some((n) => n.parentId === parentId && n.viaRivetId === viaRivetId)) {
    return [...nodes];
  }
  return [
    ...nodes,
    {
      id: viaRivetId,
      pieceId,
      viaRivetId,
      parentId,
      depth: parent.depth + 1,
    },
  ];
}

function closeNode(nodes: readonly OpenNode[], id: string): OpenNode[] {
  const target = nodes.find((n) => n.id === id);
  if (!target || target.depth === 0) {
    return [];
  }
  const drop = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const node of nodes) {
      if (node.parentId && drop.has(node.parentId) && !drop.has(node.id)) {
        drop.add(node.id);
        grew = true;
      }
    }
  }
  return nodes.filter((n) => !drop.has(n.id));
}

function nodesAtDepth(nodes: readonly OpenNode[], depth: number): OpenNode[] {
  return nodes.filter((n) => n.depth === depth);
}

function childrenOf(nodes: readonly OpenNode[], parentId: string): OpenNode[] {
  return nodes.filter((n) => n.parentId === parentId);
}

function openRivetIds(nodes: readonly OpenNode[], parentId: string): string[] {
  return childrenOf(nodes, parentId)
    .map((n) => n.viaRivetId)
    .filter((id): id is string => id !== null);
}

function maxDepth(nodes: readonly OpenNode[]): number {
  return nodes.reduce((max, n) => Math.max(max, n.depth), 0);
}

declare global {
  interface Window {
    intro: IntroApi & {
      onLibraryOpened: (cb: (library: LibraryDto) => void) => () => void;
    };
  }
}

type BodyMode = "source" | "rendered";

type State = {
  root: string | null;
  pieces: { id: string; path: string; medium: "text" | "pdf" }[];
  nodes: OpenNode[];
  views: Record<string, PieceDto>;
  /**
   * Per open card. Source edits the piece (marks SoT in `.intro.md`);
   * rendered is a read-only projection. Highlight/wires are view-layer.
   */
  modes: Record<string, BodyMode>;
};

const state: State = {
  root: null,
  pieces: [],
  nodes: [],
  views: {},
  modes: {},
};

const el = {
  libPath: document.getElementById("lib-path") as HTMLElement,
  open: document.getElementById("btn-open") as HTMLButtonElement,
  newPiece: document.getElementById("btn-new-piece") as HTMLButtonElement,
  openPdf: document.getElementById("btn-open-pdf") as HTMLButtonElement,
  list: document.getElementById("piece-list") as HTMLUListElement,
  sidebarEmpty: document.getElementById("sidebar-empty") as HTMLElement,
  board: document.getElementById("board") as HTMLElement,
  columns: document.getElementById("columns") as HTMLElement,
  wires: document.querySelector("#wires") as SVGSVGElement,
  status: document.getElementById("status") as HTMLElement,
};

const persistTimers = new Map<string, number>();
const pdfViews = new Map<string, PdfViewHandle>();
let hotId: string | null = null;
let wireFrame = 0;
let pendingAlign: string | null = null;

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

function overlayQuote(rivet: OverlayRivet): string {
  if (rivet.quote) {
    const slice = rivet.quote.replace(/\s+/g, " ").trim();
    return slice.length <= 24 ? slice || "region" : `${slice.slice(0, 24)}…`;
  }
  const first = rivet.anchors[0];
  return first ? `p${first.page} region` : "region";
}

function modeOf(nodeId: string): BodyMode {
  return state.modes[nodeId] ?? "source";
}

function clipOf(surface: HTMLElement): AnchorRect {
  const pdf = surface.querySelector(".body-pdf") as HTMLElement | null;
  const rendered = surface.querySelector(".body-rendered") as HTMLElement | null;
  const source = surface.querySelector(".body-source") as HTMLElement | null;
  const box = pdf && !pdf.hidden
    ? pdf
    : rendered && !rendered.hidden
      ? rendered
      : source ?? surface;
  return clientToAnchor(box.getBoundingClientRect());
}

function visibleRects(host: HTMLElement, rivetId: string): AnchorRect[] {
  const clip = clipOf(host);
  return rectsForRivet(host, rivetId).filter((box) => rectsIntersect(box, clip));
}

function surfaceOf(nodeId: string): HTMLElement | null {
  return el.columns.querySelector(`[data-node-id="${CSS.escape(nodeId)}"]`);
}

function paintHighlights(
  highlights: HTMLElement,
  clean: string,
  rivets: readonly RivetSpec[],
  openIds: readonly string[],
): void {
  highlights.innerHTML = highlightHtml(clean, rivets, openIds);
}

function syncHighlightScroll(editor: HTMLTextAreaElement, highlights: HTMLElement): void {
  highlights.scrollTop = editor.scrollTop;
  highlights.scrollLeft = editor.scrollLeft;
}

function paintRendered(surface: HTMLElement): void {
  const nodeId = surface.dataset.nodeId;
  const pieceId = surface.dataset.pieceId;
  const pane = surface.querySelector(".body-rendered") as HTMLElement | null;
  const editor = surface.querySelector("textarea.editor") as HTMLTextAreaElement | null;
  if (!nodeId || !pieceId || !pane || !editor) {
    return;
  }
  const view = state.views[pieceId];
  // Clean editor text + parsed rivet ranges. Markdown never sees `<<r>>`.
  pane.innerHTML = renderHtml(
    editor.value,
    view?.rivets ?? [],
    openRivetIds(state.nodes, nodeId),
    katexMath,
  );
}

function paintSurface(surface: HTMLElement): void {
  const nodeId = surface.dataset.nodeId;
  const pieceId = surface.dataset.pieceId;
  if (!nodeId || !pieceId) {
    return;
  }
  const view = state.views[pieceId];
  const editor = surface.querySelector("textarea.editor") as HTMLTextAreaElement | null;
  const highlights = surface.querySelector(".editor-highlights") as HTMLElement | null;
  if (!editor || !highlights) {
    return;
  }
  paintHighlights(highlights, editor.value, view?.rivets ?? [], openRivetIds(state.nodes, nodeId));
  syncHighlightScroll(editor, highlights);
  if (modeOf(nodeId) === "rendered") {
    paintRendered(surface);
  }
}

function applyMode(surface: HTMLElement, mode: BodyMode): void {
  const nodeId = surface.dataset.nodeId;
  const pieceId = surface.dataset.pieceId;
  const editor = surface.querySelector("textarea.editor") as HTMLTextAreaElement | null;
  if (nodeId) {
    state.modes[nodeId] = mode;
  }
  if (mode === "rendered" && pieceId && editor) {
    flushPersist(pieceId, editor);
  }
  surface.dataset.mode = mode;
  const source = surface.querySelector(".body-source") as HTMLElement | null;
  const rendered = surface.querySelector(".body-rendered") as HTMLElement | null;
  if (source) {
    source.hidden = mode !== "source";
  }
  if (rendered) {
    rendered.hidden = mode !== "rendered";
  }
  surface.querySelectorAll(".mode-switch button").forEach((btn) => {
    const on = (btn as HTMLElement).dataset.mode === mode;
    btn.classList.toggle("on", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  });
  if (mode === "rendered") {
    paintRendered(surface);
  }
  if (hotId) {
    setHot(hotId);
  }
  scheduleChrome();
}

function rivetStart(parent: OpenNode | undefined, via: string | null): number {
  if (!parent || !via) {
    return 0;
  }
  return state.views[parent.pieceId]?.rivets.find((r) => r.id === via)?.start ?? 0;
}

function sortCards(a: OpenNode, b: OpenNode): number {
  const pa = state.nodes.find((n) => n.id === a.parentId);
  const pb = state.nodes.find((n) => n.id === b.parentId);
  const sa = rivetStart(pa, a.viaRivetId);
  const sb = rivetStart(pb, b.viaRivetId);
  if (sa !== sb) {
    return sa - sb;
  }
  return a.id.localeCompare(b.id);
}

function sortStacks(): void {
  for (const stack of el.columns.querySelectorAll(".col-stack")) {
    const cards = Array.from(stack.querySelectorAll(":scope > .card")) as HTMLElement[];
    cards.sort((a, b) => {
      const na = state.nodes.find((n) => n.id === a.dataset.nodeId);
      const nb = state.nodes.find((n) => n.id === b.dataset.nodeId);
      const ha = na?.parentId ? surfaceOf(na.parentId) : null;
      const hb = nb?.parentId ? surfaceOf(nb.parentId) : null;
      const ya = ha && na?.viaRivetId ? (rectsForRivet(ha, na.viaRivetId)[0]?.top ?? 0) : 0;
      const yb = hb && nb?.viaRivetId ? (rectsForRivet(hb, nb.viaRivetId)[0]?.top ?? 0) : 0;
      return ya - yb;
    });
    for (const card of cards) {
      stack.append(card);
    }
  }
}

function scheduleChrome(): void {
  if (wireFrame) {
    return;
  }
  wireFrame = requestAnimationFrame(() => {
    wireFrame = 0;
    sortStacks();
    syncViewportSides();
    if (pendingAlign) {
      alignCard(pendingAlign);
      pendingAlign = null;
    }
    drawWires();
  });
}

/** 结论 #36: source out of column view → don’t paint that side. Not a close. */
function syncViewportSides(): void {
  const cards = Array.from(el.columns.querySelectorAll(".card")) as HTMLElement[];
  cards.sort((a, b) => {
    const da = Number(a.dataset.depth ?? 0);
    const db = Number(b.dataset.depth ?? 0);
    return da - db;
  });
  for (const card of cards) {
    const node = state.nodes.find((n) => n.id === card.dataset.nodeId);
    if (!node?.parentId || !node.viaRivetId) {
      card.hidden = true;
      continue;
    }
    const host = surfaceOf(node.parentId);
    const parentCard = host?.closest(".card") as HTMLElement | null;
    const parentHidden = Boolean(host && (host.hidden || parentCard?.hidden));
    card.hidden = parentHidden || !host || visibleRects(host, node.viaRivetId).length === 0;
  }
  for (const column of el.columns.querySelectorAll(":scope > .column.stack")) {
    const depthCards = column.querySelectorAll(":scope .card");
    const any = Array.from(depthCards).some((card) => !(card as HTMLElement).hidden);
    (column as HTMLElement).hidden = depthCards.length > 0 && !any;
  }
}

function alignCard(nodeId: string): void {
  const node = state.nodes.find((n) => n.id === nodeId);
  const card = surfaceOf(nodeId);
  if (!node?.parentId || !node.viaRivetId || !card || card.hidden) {
    return;
  }
  const host = surfaceOf(node.parentId);
  const box = host ? visibleRects(host, node.viaRivetId)[0] : undefined;
  const stack = card.closest(".col-stack");
  if (!box || !stack) {
    return;
  }
  stack.scrollTop += box.top - card.getBoundingClientRect().top;
}

function setHot(id: string | null): void {
  hotId = id;
  el.columns.querySelectorAll("mark.hot, .rivet.hot, .card.hot, .pdf-hl.hot").forEach((node) => {
    node.classList.remove("hot");
  });
  if (id) {
    el.columns.querySelectorAll(`[data-rivet="${CSS.escape(id)}"]`).forEach((node) => {
      node.classList.add("hot");
    });
    el.columns.querySelectorAll(`.card[data-node-id="${CSS.escape(id)}"]`).forEach((node) => {
      node.classList.add("hot");
    });
  }
  drawWires();
}

/** Open rivet ↔ opened side card only. Not a knowledge graph. */
function drawWires(): void {
  const svg = el.wires;
  const board = el.board;
  const br = board.getBoundingClientRect();
  const boardBox = clientToAnchor(br);
  svg.setAttribute("viewBox", `0 0 ${Math.max(0, br.width)} ${Math.max(0, br.height)}`);
  svg.replaceChildren();
  for (const node of state.nodes) {
    if (!node.parentId || !node.viaRivetId) {
      continue;
    }
    const host = surfaceOf(node.parentId);
    const side = surfaceOf(node.id);
    if (!host || !side || side.hidden) {
      continue;
    }
    const from = attachPoint(visibleRects(host, node.viaRivetId));
    if (!from || !rectsIntersect(clientToAnchor(side.getBoundingClientRect()), boardBox)) {
      continue;
    }
    const x1 = from.x - br.left;
    const y1 = from.y - br.top;
    const b = side.getBoundingClientRect();
    const x2 = b.left - br.left;
    const y2 = b.top + 18 - br.top;
    const dx = Math.max(24, Math.min(72, (x2 - x1) / 2));
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute(
      "d",
      `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`,
    );
    path.dataset.rivet = node.viaRivetId;
    if (node.viaRivetId === hotId || node.id === hotId) {
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
  el.openPdf.disabled = false;
  renderSidebar();
}

function renderSidebar(): void {
  el.list.replaceChildren();
  el.sidebarEmpty.hidden = state.pieces.length > 0 || !state.root;
  el.sidebarEmpty.textContent = state.root
    ? "Empty library. Create a first piece."
    : "Open a folder to start. An empty folder is a new library.";
  const openIds = new Set(state.nodes.map((n) => n.pieceId));
  for (const piece of state.pieces) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = piece.id;
    if (piece.medium === "pdf") {
      const badge = document.createElement("span");
      badge.className = "piece-pdf";
      badge.textContent = "PDF";
      btn.append(badge);
    }
    btn.title = piece.path;
    btn.classList.toggle("on", openIds.has(piece.id));
    btn.addEventListener("click", () => {
      void openRootPiece(piece.id);
    });
    li.append(btn);
    el.list.append(li);
  }
}

function disposePdfViews(): void {
  for (const handle of pdfViews.values()) {
    handle.destroy();
  }
  pdfViews.clear();
}

function renderColumns(): void {
  const keep = new Set(state.nodes.map((n) => n.id));
  disposePdfViews();
  for (const id of Object.keys(state.modes)) {
    if (!keep.has(id)) {
      delete state.modes[id];
    }
  }
  el.columns.replaceChildren();
  if (state.nodes.length === 0) {
    const hint = document.createElement("p");
    hint.className = "empty-main";
    hint.textContent = state.root
      ? "Open a piece from the left, or create the first one."
      : "Open a local library folder to write.";
    el.columns.append(hint);
    drawWires();
    return;
  }
  const root = state.nodes.find((n) => n.depth === 0);
  if (root) {
    el.columns.append(renderHost(root));
  }
  const hi = maxDepth(state.nodes);
  for (let depth = 1; depth <= hi; depth++) {
    el.columns.append(renderSideColumn(depth));
  }
  scheduleChrome();
}

function bindSurface(node: OpenNode, surface: HTMLElement): HTMLTextAreaElement {
  const view = state.views[node.pieceId];
  surface.dataset.nodeId = node.id;
  surface.dataset.pieceId = node.pieceId;
  surface.dataset.depth = String(node.depth);
  if (node.viaRivetId) {
    surface.dataset.via = node.viaRivetId;
  }

  const body = document.createElement("div");
  body.className = "card-body";

  const stack = document.createElement("div");
  stack.className = "body-source editor-stack";
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
  paintHighlights(highlights, editor.value, view?.rivets ?? [], openRivetIds(state.nodes, node.id));
  editor.addEventListener("input", () => {
    paintHighlights(
      highlights,
      editor.value,
      state.views[node.pieceId]?.rivets ?? [],
      openRivetIds(state.nodes, node.id),
    );
    syncHighlightScroll(editor, highlights);
    schedulePersist(node.pieceId, editor);
    scheduleChrome();
  });
  editor.addEventListener("scroll", () => {
    syncHighlightScroll(editor, highlights);
    scheduleChrome();
  });
  stack.append(highlights, editor);

  const rendered = document.createElement("div");
  rendered.className = "body-rendered";
  rendered.hidden = true;
  rendered.setAttribute("aria-readonly", "true");
  rendered.addEventListener("scroll", scheduleChrome);

  body.append(stack, rendered);

  const tools = document.createElement("div");
  tools.className = "column-tools";
  const modes = document.createElement("div");
  modes.className = "mode-switch";
  modes.setAttribute("role", "tablist");
  modes.setAttribute("aria-label", "Body view");
  for (const mode of ["source", "rendered"] as const) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.mode = mode;
    btn.setAttribute("role", "tab");
    btn.textContent = mode === "source" ? "Source" : "Rendered";
    btn.addEventListener("click", () => {
      applyMode(surface, mode);
      if (mode === "source") {
        editor.focus();
      }
    });
    modes.append(btn);
  }
  const newSide = document.createElement("button");
  newSide.type = "button";
  newSide.textContent = "New side";
  newSide.disabled = Boolean(view && view.damage.length > 0);
  newSide.addEventListener("click", () => {
    if (modeOf(node.id) === "rendered") {
      applyMode(surface, "source");
      editor.focus();
      setStatus("Select a span in source, then New side.");
      return;
    }
    void hangFromEditor(node.id, editor, undefined);
  });
  const hangExisting = document.createElement("button");
  hangExisting.type = "button";
  hangExisting.textContent = "Hang existing…";
  hangExisting.disabled = Boolean(view && view.damage.length > 0);
  hangExisting.addEventListener("click", () => {
    if (modeOf(node.id) === "rendered") {
      applyMode(surface, "source");
      editor.focus();
      setStatus("Select a span in source, then hang an existing piece.");
      return;
    }
    const sideId = window.prompt(
      "Piece id to reuse as the side (to=)",
      state.pieces.find((p) => p.id !== node.pieceId)?.id ?? "",
    );
    if (!sideId) {
      return;
    }
    void hangFromEditor(node.id, editor, sideId.trim());
  });
  tools.append(modes, newSide, hangExisting);

  const rivets = document.createElement("div");
  rivets.className = "rivets";
  const h = document.createElement("h3");
  h.textContent = view && view.damage.length > 0
    ? `Damaged (${view.damage.map((d) => d.kind).join(", ")})`
    : `Rivets (${view?.rivets.length ?? 0})`;
  rivets.append(h);
  const openIds = new Set(openRivetIds(state.nodes, node.id));
  if (view) {
    for (const rivet of view.rivets) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "rivet";
      btn.dataset.rivet = rivet.id;
      btn.classList.toggle("open", openIds.has(rivet.id));
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
          void openSideColumn(node.id, rivet.to, rivet.id);
        }
      });
      rivets.append(btn);
    }
  }

  surface.append(body, tools, rivets);
  applyMode(surface, modeOf(node.id));
  return editor;
}

function appendRivetButtons(
  rivetsEl: HTMLElement,
  node: OpenNode,
  items: { id: string; to?: string | null; label: string }[],
): void {
  const openIds = new Set(openRivetIds(state.nodes, node.id));
  for (const rivet of items) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "rivet";
    btn.dataset.rivet = rivet.id;
    btn.classList.toggle("open", openIds.has(rivet.id));
    const quote = document.createElement("span");
    quote.className = "quote";
    quote.textContent = `「${rivet.label}」`;
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
        void openSideColumn(node.id, rivet.to, rivet.id);
      }
    });
    rivetsEl.append(btn);
  }
}

function bindPdfHost(node: OpenNode, surface: HTMLElement): void {
  const view = state.views[node.pieceId];
  surface.dataset.nodeId = node.id;
  surface.dataset.pieceId = node.pieceId;
  surface.dataset.depth = String(node.depth);
  surface.dataset.mode = "pdf";
  surface.classList.add("pdf-host");
  state.modes[node.id] = "source";

  const body = document.createElement("div");
  body.className = "card-body";
  const pane = document.createElement("div");
  pane.className = "body-pdf";
  pane.addEventListener("scroll", scheduleChrome);
  body.append(pane);

  const tools = document.createElement("div");
  tools.className = "column-tools";
  const hint = document.createElement("span");
  hint.className = "muted";
  hint.textContent = "Drag a region, then New side. Overlay only — PDF bytes stay untouched.";
  const newSide = document.createElement("button");
  newSide.type = "button";
  newSide.textContent = "New side";
  newSide.addEventListener("click", () => {
    void hangFromPdf(node.id, undefined);
  });
  const hangExisting = document.createElement("button");
  hangExisting.type = "button";
  hangExisting.textContent = "Hang existing…";
  hangExisting.addEventListener("click", () => {
    const sideId = window.prompt(
      "Piece id to reuse as the side (to=)",
      state.pieces.find((p) => p.id !== node.pieceId && p.medium === "text")?.id ?? "",
    );
    if (!sideId) {
      return;
    }
    void hangFromPdf(node.id, sideId.trim());
  });
  tools.append(hint, newSide, hangExisting);

  const rivets = document.createElement("div");
  rivets.className = "rivets";
  const h = document.createElement("h3");
  h.textContent = `Overlay rivets (${view?.overlayRivets.length ?? 0})`;
  rivets.append(h);
  if (view) {
    appendRivetButtons(
      rivets,
      node,
      view.overlayRivets.map((rivet) => ({
        id: rivet.id,
        to: rivet.to,
        label: overlayQuote(rivet),
      })),
    );
  }

  surface.append(body, tools, rivets);

  void (async () => {
    const result = await window.intro.readPdf(node.pieceId);
    if (!result.ok) {
      setStatus(result.error, true);
      return;
    }
    if (surface.dataset.pieceId !== node.pieceId) {
      return;
    }
    const handle = await mountPdfView({
      root: pane,
      pieceId: node.pieceId,
      data: result.data,
      rivets: view?.overlayRivets ?? [],
      openIds: openRivetIds(state.nodes, node.id),
      onChrome: scheduleChrome,
      onRivetEnter: setHot,
      onRivetLeave: () => setHot(null),
      onRivetClick: (id) => {
        const rivet = state.views[node.pieceId]?.overlayRivets.find((r) => r.id === id);
        if (rivet?.to) {
          void openSideColumn(node.id, rivet.to, rivet.id);
        }
      },
    });
    pdfViews.get(node.id)?.destroy();
    pdfViews.set(node.id, handle);
    scheduleChrome();
  })();
}

function renderHost(node: OpenNode): HTMLElement {
  const view = state.views[node.pieceId];
  const section = document.createElement("section");
  section.className = "column";
  section.dataset.depth = "0";

  const head = document.createElement("div");
  head.className = "column-head";
  const depth = document.createElement("span");
  depth.className = "depth";
  depth.textContent = "d0";
  const id = document.createElement("span");
  id.className = "id";
  id.textContent = node.pieceId;
  id.title = view?.path ?? node.pieceId;
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "Close";
  close.addEventListener("click", () => {
    state.nodes = closeNode(state.nodes, ROOT_ID);
    renderSidebar();
    renderColumns();
    setStatus("Closed the chain. Rivets stay on disk.");
  });
  head.append(depth, id, close);
  section.append(head);
  if (view?.medium === "pdf") {
    bindPdfHost(node, section);
  } else {
    bindSurface(node, section);
  }
  return section;
}

function renderCard(node: OpenNode): HTMLElement {
  const view = state.views[node.pieceId];
  const parent = state.nodes.find((n) => n.id === node.parentId);
  const card = document.createElement("article");
  card.className = "card";

  const head = document.createElement("div");
  head.className = "card-hd";
  const titles = document.createElement("div");
  const id = document.createElement("strong");
  id.className = "id";
  id.textContent = node.pieceId;
  id.title = view?.path ?? node.pieceId;
  titles.append(id);
  if (parent) {
    const from = document.createElement("div");
    from.className = "from";
    from.textContent = `← ${parent.pieceId}`;
    titles.append(from);
  }
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "Close";
  close.addEventListener("click", () => {
    state.nodes = closeNode(state.nodes, node.id);
    renderSidebar();
    renderColumns();
    setStatus("Closed this side and its subtree. Rivets stay on disk.");
  });
  head.append(titles, close);
  card.append(head);
  bindSurface(node, card);
  card.addEventListener("pointerenter", () => {
    setHot(node.id);
  });
  card.addEventListener("pointerleave", () => {
    setHot(null);
  });
  return card;
}

function renderSideColumn(depth: number): HTMLElement {
  const cards = nodesAtDepth(state.nodes, depth).slice().sort(sortCards);
  const section = document.createElement("section");
  section.className = "column stack";
  section.dataset.depth = String(depth);

  const head = document.createElement("div");
  head.className = "column-head";
  const label = document.createElement("span");
  label.className = "depth";
  label.textContent = `d${depth}`;
  const count = document.createElement("span");
  count.className = "id";
  count.textContent = cards.length === 1 ? "1 side" : `${cards.length} sides`;
  head.append(label, count);

  const stack = document.createElement("div");
  stack.className = "col-stack";
  stack.addEventListener("scroll", scheduleChrome);
  for (const node of cards) {
    stack.append(renderCard(node));
  }
  section.append(head, stack);
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

/** Flush a pending source edit to `.intro.md` (marks stay SoT). Never persist rendered HTML. */
function flushPersist(id: string, editor: HTMLTextAreaElement): void {
  const prev = persistTimers.get(id);
  if (prev === undefined) {
    return;
  }
  window.clearTimeout(prev);
  persistTimers.delete(id);
  void persistNow(id, editor.value);
}

async function persistNow(id: string, clean: string): Promise<void> {
  const result = await window.intro.persistClean(id, clean);
  if (!result.ok) {
    setStatus(result.error, true);
    return;
  }
  state.views[id] = result.piece;
  el.columns.querySelectorAll(`[data-piece-id="${CSS.escape(id)}"]`).forEach((node) => {
    const surface = node as HTMLElement;
    const editor = surface.querySelector("textarea.editor") as HTMLTextAreaElement | null;
    if (editor && editor !== document.activeElement && editor.value !== result.piece.clean) {
      editor.value = result.piece.clean;
    }
    paintSurface(surface);
  });
  scheduleChrome();
  setStatus(`Saved ${id}`);
}

async function hangFromPdf(parentId: string, sideId: string | undefined): Promise<void> {
  const host = state.nodes.find((n) => n.id === parentId);
  if (!host) {
    return;
  }
  const view = pdfViews.get(parentId);
  const selection = view?.getSelection();
  if (!selection || selection.anchors.length === 0) {
    setStatus("Drag a region on the PDF first.", true);
    return;
  }
  const result = await window.intro.hangPdfSide({
    hostId: host.pieceId,
    anchors: selection.anchors,
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
  state.nodes = openSide(state.nodes, parentId, result.side.id, result.rivetId);
  pendingAlign = result.rivetId;
  renderSidebar();
  renderColumns();
  const focus = surfaceOf(result.rivetId)?.querySelector("textarea.editor") as
    | HTMLTextAreaElement
    | undefined;
  focus?.focus();
  setHot(result.rivetId);
  setStatus(
    sideId
      ? `Hung existing ${result.side.id} from PDF overlay ${result.rivetId}`
      : `Created side ${result.side.id} from PDF overlay ${result.rivetId}`,
  );
}

async function hangFromEditor(
  parentId: string,
  editor: HTMLTextAreaElement,
  sideId: string | undefined,
): Promise<void> {
  const host = state.nodes.find((n) => n.id === parentId);
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
  state.nodes = openSide(state.nodes, parentId, result.side.id, result.rivetId);
  pendingAlign = result.rivetId;
  renderSidebar();
  renderColumns();
  const focus = surfaceOf(result.rivetId)?.querySelector("textarea.editor") as
    | HTMLTextAreaElement
    | undefined;
  focus?.focus();
  setHot(result.rivetId);
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
  state.nodes = openRoot(id);
  renderSidebar();
  renderColumns();
  if (result.piece.medium !== "pdf") {
    const editor = el.columns.querySelector("textarea.editor") as HTMLTextAreaElement | null;
    editor?.focus();
  }
  setStatus(result.piece.medium === "pdf" ? `Opened PDF host ${id}` : `Opened ${id}`);
}

async function openSideColumn(
  parentId: string,
  pieceId: string,
  rivetId: string,
): Promise<void> {
  const result = await window.intro.loadPiece(pieceId);
  if (!result.ok) {
    setStatus(result.error, true);
    return;
  }
  state.views[pieceId] = result.piece;
  const already = state.nodes.some((n) => n.parentId === parentId && n.viaRivetId === rivetId);
  state.nodes = openSide(state.nodes, parentId, pieceId, rivetId);
  pendingAlign = rivetId;
  renderSidebar();
  renderColumns();
  setHot(rivetId);
  setStatus(already ? `Focused side ${pieceId}` : `Opened side ${pieceId}`);
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
  state.nodes = [];
  state.views = {};
  state.modes = {};
  forgetAllPdfDocs();
  renderColumns();
  setStatus(`Library ${result.library.root}`);
});

el.openPdf.addEventListener("click", async () => {
  const result = await window.intro.attachPdf();
  if (!result.ok) {
    if (result.error !== "canceled") {
      setStatus(result.error, true);
    }
    return;
  }
  state.pieces = result.pieces;
  state.views[result.piece.id] = result.piece;
  state.nodes = openRoot(result.piece.id);
  renderSidebar();
  renderColumns();
  setStatus(`Attached PDF host ${result.piece.id} (overlay sidecar; PDF not rewritten)`);
});

el.newPiece.addEventListener("click", async () => {
  const result = await window.intro.createPiece({ body: "" });
  if (!result.ok) {
    setStatus(result.error, true);
    return;
  }
  state.pieces = result.pieces;
  state.views[result.piece.id] = result.piece;
  state.nodes = openRoot(result.piece.id);
  renderSidebar();
  renderColumns();
  const editor = el.columns.querySelector("textarea.editor") as HTMLTextAreaElement | null;
  editor?.focus();
  setStatus(`Created ${result.piece.id}`);
});

window.intro.onLibraryOpened((library) => {
  applyLibrary(library);
  forgetAllPdfDocs();
  renderColumns();
  setStatus(`Library ${library.root}`);
});

el.columns.addEventListener("scroll", scheduleChrome);
window.addEventListener("resize", scheduleChrome);
new ResizeObserver(scheduleChrome).observe(el.board);

renderSidebar();
renderColumns();
