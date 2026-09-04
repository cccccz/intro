import {
  attachPoint,
  clientToAnchor,
  rectsForRivet,
  rectsIntersect,
  type AnchorRect,
} from "./geometry.ts";
import { highlightHtml } from "./highlight.ts";
import { orderCards } from "./card-order.ts";
import { cardHeightKey, clampCardHeight, loadCardHeight, saveCardHeight, resizeCardPair } from "./card-height.ts";
import { readingKey } from "./pdf-reading.ts";
import {
  COLUMN_MIN,
  bindVSplitter,
  clampColumnWidth,
  clampSidebarWidth,
  columnSize,
  loadChromeLayout,
  saveChromeLayout,
  type ChromeLayout,
} from "./layout.ts";
import {
  ZOOM_FIT,
  formatZoom,
  parsePageInput,
  zoomIn,
  zoomOut,
} from "./pdf-nav.ts";
import {
  forgetAllPdfDocs,
  mountPdfView,
  type OverlayRivet,
  type PdfOutlineEntry,
  type PdfViewHandle,
} from "./pdf-view.ts";
import { katexMath, renderHtml } from "./render.ts";

type Damage = { kind: string; message: string; index: number; id?: string };
type RivetSpec = { id: string; to?: string | null; start: number; end: number };

type PieceDto = {
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

type ListedPieceDto = {
  id: string;
  path: string;
  medium: "text" | "pdf";
  title: string;
  titled: boolean;
};

type LibraryDto = {
  root: string;
  pieces: ListedPieceDto[];
};

type Ok<T> = { ok: true } & T;
type Err = { ok: false; error: string };

type IntroApi = {
  detachSide: (hostId: string, rivetId: string, clean?: string) => Promise<Ok<{ host: PieceDto }> | Err>;
  openLibrary: () => Promise<Ok<{ library: LibraryDto }> | Err>;
  openLibraryPath: (root: string) => Promise<Ok<{ library: LibraryDto }> | Err>;
  listPieces: () => Promise<Ok<{ pieces: LibraryDto["pieces"] }> | Err>;
  createPiece: (opts?: {
    id?: string;
    body?: string;
    title?: string;
  }) => Promise<Ok<{ piece: PieceDto; pieces: LibraryDto["pieces"] }> | Err>;
  setPieceTitle: (
    id: string,
    title: string,
  ) => Promise<Ok<{ piece: PieceDto; pieces: LibraryDto["pieces"] }> | Err>;
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
  dropSide: (
    id: string,
  ) => Promise<Ok<{ deleted: string[]; hosts: PieceDto[]; pieces: ListedPieceDto[] }> | Err>;
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
  pieces: ListedPieceDto[];
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
  sidebar: document.getElementById("sidebar") as HTMLElement,
  splitSidebar: document.getElementById("split-sidebar") as HTMLElement,
  list: document.getElementById("piece-list") as HTMLUListElement,
  sidebarEmpty: document.getElementById("sidebar-empty") as HTMLElement,
  board: document.getElementById("board") as HTMLElement,
  columns: document.getElementById("columns") as HTMLElement,
  wires: document.querySelector("#wires") as SVGSVGElement,
  status: document.getElementById("status") as HTMLElement,
};

const persistTimers = new Map<string, number>();
const pdfViews = new Map<string, PdfViewHandle>();
const chromeLayout: ChromeLayout = loadChromeLayout(localStorage);
let hotId: string | null = null;
let wireFrame = 0;
let pendingAlign: string | null = null;
let pendingPdfPage: { nodeId: string; page: number } | null = null;

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function excerptFor(node: OpenNode): string | undefined {
  if (!node.parentId || !node.viaRivetId) {
    return undefined;
  }
  const parent = state.nodes.find((n) => n.id === node.parentId);
  if (!parent) {
    return undefined;
  }
  const view = state.views[parent.pieceId];
  const rivet = view?.rivets.find((r) => r.id === node.viaRivetId);
  if (rivet && view) {
    return quoteOf(view.clean, rivet.start, rivet.end);
  }
  const overlay = view?.overlayRivets.find((r) => r.id === node.viaRivetId);
  return overlay ? overlayQuote(overlay) : undefined;
}

function titledOf(pieceId: string): boolean {
  return Boolean(state.views[pieceId]?.titled || state.pieces.find((p) => p.id === pieceId)?.titled);
}

function titleOf(pieceId: string, excerpt?: string): string {
  if (titledOf(pieceId)) {
    return state.views[pieceId]?.title
      ?? state.pieces.find((p) => p.id === pieceId)?.title
      ?? shortId(pieceId);
  }
  const trimmed = excerpt?.replace(/\s+/g, " ").trim();
  if (trimmed && trimmed !== "(empty)") {
    return trimmed;
  }
  return state.views[pieceId]?.title
    ?? state.pieces.find((p) => p.id === pieceId)?.title
    ?? shortId(pieceId);
}

function persistLayout(): void {
  saveChromeLayout(localStorage, chromeLayout);
}

function applySidebarWidth(width: number): void {
  chromeLayout.sidebarWidth = clampSidebarWidth(width);
  el.sidebar.style.width = `${chromeLayout.sidebarWidth}px`;
  persistLayout();
  scheduleChrome();
}

function applyColumnWidth(section: HTMLElement, depth: number, pdfHost: boolean): void {
  const size = columnSize(chromeLayout.columnWidths[String(depth)], depth, pdfHost);
  section.style.flex = size.flex;
  section.style.width = size.width;
  section.style.minWidth = `${COLUMN_MIN}px`;
  section.style.maxWidth = "none";
}

function insertColumnSplitters(): void {
  const cols = Array.from(el.columns.querySelectorAll(":scope > .column")) as HTMLElement[];
  // After every column, including the last, so a lone PDF/host pane can be enlarged.
  for (let i = 0; i < cols.length; i++) {
    const left = cols[i]!;
    const split = document.createElement("div");
    split.className = "splitter v-split";
    split.setAttribute("role", "separator");
    split.setAttribute("aria-orientation", "vertical");
    split.setAttribute(
      "aria-label",
      left.classList.contains("pdf-host") ? "Resize PDF column" : "Resize column",
    );
    bindVSplitter(split, {
      getWidth: () => left.getBoundingClientRect().width,
      setWidth: (width) => {
        left.style.flex = `0 0 ${width}px`;
        left.style.width = `${width}px`;
        chromeLayout.columnWidths[left.dataset.depth ?? String(i)] = width;
        persistLayout();
        scheduleChrome();
      },
      clamp: clampColumnWidth,
    });
    left.after(split);
  }
}

async function renamePiece(id: string): Promise<void> {
  const shown = titledOf(id) ? titleOf(id) : "";
  const next = await askTitle("重命名", shown);
  if (next === null) {
    return;
  }
  const result = await window.intro.setPieceTitle(id, next);
  if (!result.ok) {
    setStatus(result.error, true);
    return;
  }
  state.views[id] = result.piece;
  state.pieces = result.pieces;
  renderSidebar();
  paintTitles();
  setStatus(`Title: ${result.piece.title}`);
}

function paintTitles(): void {
  el.columns.querySelectorAll("[data-piece-id]").forEach((node) => {
    const pieceId = (node as HTMLElement).dataset.pieceId;
    if (!pieceId) {
      return;
    }
    const open = state.nodes.find((n) => n.id === (node as HTMLElement).dataset.nodeId);
    const title = titleOf(pieceId, open ? excerptFor(open) : undefined);
    node.querySelectorAll(".piece-title").forEach((label) => {
      label.textContent = title;
    });
  });
  el.columns.querySelectorAll("[data-to]").forEach((node) => {
    const to = (node as HTMLElement).dataset.to;
    if (to) {
      node.textContent = `→ ${titleOf(to)}`;
    }
  });
}

function setStatus(text: string, danger = false): void {
  el.status.textContent = text;
  el.status.classList.toggle("danger", danger);
}

type CtxItem = {
  label: string;
  disabled?: boolean;
  run: () => void;
};

function askTitle(label: string, value = ""): Promise<string | null> {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "piece-picker";
    const form = document.createElement("form");
    const heading = document.createElement("h2");
    heading.textContent = label;
    const input = document.createElement("input");
    input.value = value;
    input.setAttribute("aria-label", "标题");
    input.placeholder = "标题（留空使用默认名称）";
    const save = document.createElement("button");
    save.type = "submit";
    save.textContent = "保存";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "取消";
    let answer: string | null = null;
    form.onsubmit = (event) => { event.preventDefault(); answer = input.value; dialog.close(); };
    cancel.onclick = () => dialog.close();
    dialog.addEventListener("close", () => { dialog.remove(); resolve(answer); }, { once: true });
    form.append(heading, input, save, cancel);
    dialog.append(form);
    document.body.append(dialog);
    dialog.showModal();
    input.focus();
    input.select();
  });
}

let ctxMenu: HTMLElement | null = null;

function hideCtxMenu(): void {
  ctxMenu?.remove();
  ctxMenu = null;
}

function showCtxMenu(ev: MouseEvent, items: readonly CtxItem[]): void {
  ev.preventDefault();
  ev.stopPropagation();
  hideCtxMenu();
  const menu = document.createElement("div");
  menu.className = "ctx-menu";
  menu.setAttribute("role", "menu");
  for (const item of items) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("role", "menuitem");
    btn.textContent = item.label;
    btn.disabled = Boolean(item.disabled);
    btn.addEventListener("click", () => {
      hideCtxMenu();
      item.run();
    });
    menu.append(btn);
  }
  document.body.append(menu);
  ctxMenu = menu;
  const pad = 8;
  const x = Math.min(ev.clientX, window.innerWidth - menu.offsetWidth - pad);
  const y = Math.min(ev.clientY, window.innerHeight - menu.offsetHeight - pad);
  menu.style.left = `${Math.max(pad, x)}px`;
  menu.style.top = `${Math.max(pad, y)}px`;
}

function promptExistingSide(excludeId: string, textOnly: boolean): Promise<string | null> {
  const listed = state.pieces.filter(
    (p) => p.id !== excludeId && (!textOnly || p.medium === "text"),
  );
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "piece-picker";
    const heading = document.createElement("h2");
    heading.id = "piece-picker-heading";
    heading.textContent = "挂接已有笔记";
    dialog.setAttribute("aria-labelledby", heading.id);
    const search = document.createElement("input");
    search.type = "search";
    search.placeholder = "搜索标题或正文";
    search.setAttribute("aria-label", search.placeholder);
    const list = document.createElement("div");
    list.className = "piece-picker-list";
    const cancel = document.createElement("button");
    cancel.textContent = "取消";
    let selected: string | null = null;
    cancel.onclick = () => dialog.close();
    dialog.addEventListener("close", () => {
      dialog.remove();
      resolve(selected);
    }, { once: true });
    const previews = new Map<string, string>();
    const paint = (): void => {
      list.replaceChildren();
      const query = search.value.trim().toLocaleLowerCase();
      for (const piece of listed) {
        const preview = previews.get(piece.id) ?? (piece.medium === "pdf" ? "PDF" : "正在加载正文…");
        if (!`${piece.title} ${preview}`.toLocaleLowerCase().includes(query)) continue;
        const button = document.createElement("button");
        const title = document.createElement("strong");
        title.textContent = piece.title;
        const text = document.createElement("span");
        text.textContent = preview.slice(0, 180) || "（空笔记）";
        button.append(title, text);
        button.onclick = () => { selected = piece.id; dialog.close(); };
        list.append(button);
      }
      if (!list.childElementCount) list.textContent = listed.length ? "没有匹配的笔记" : "暂无可挂接的笔记";
    };
    search.oninput = paint;
    dialog.append(heading, search, list, cancel);
    document.body.append(dialog);
    paint();
    dialog.showModal();
    search.focus();
    void (async () => {
      for (const piece of listed) {
        if (!dialog.isConnected) return;
        if (piece.medium === "pdf") continue;
        try {
          const result = await window.intro.loadPiece(piece.id);
          previews.set(piece.id, result.ok ? result.piece.clean : "正文加载失败");
        } catch { previews.set(piece.id, "正文加载失败"); }
        if (dialog.isConnected) paint();
      }
    })();
  });
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
  pane.querySelectorAll("mark[data-rivet]").forEach((mark) => {
    const rivetId = (mark as HTMLElement).dataset.rivet;
    if (!rivetId) {
      return;
    }
    mark.addEventListener("pointerenter", () => {
      setHot(rivetId);
    });
    mark.addEventListener("pointerleave", () => {
      setHot(null);
    });
  });
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
    // Electron 37 supports atomic DOM moves; TypeScript's DOM lib lacks the declaration.
    orderCards<Element>(stack as Element & {
      moveBefore(node: Element, before: Element | null): void;
    }, cards);
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

/** Hide a side card when its source is out of the host viewport. The column stays. */
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

function pruneDeletedNodes(deleted: ReadonlySet<string>): void {
  if (state.nodes.some((n) => n.depth === 0 && deleted.has(n.pieceId))) {
    state.nodes = [];
    return;
  }
  const ids = state.nodes.filter((n) => deleted.has(n.pieceId)).map((n) => n.id);
  for (const id of ids) {
    if (state.nodes.some((n) => n.id === id)) {
      state.nodes = closeNode(state.nodes, id);
    }
  }
}

async function confirmDropSide(pieceId: string): Promise<void> {
  const listed = state.pieces.find((p) => p.id === pieceId);
  if (listed?.medium === "pdf") {
    setStatus("PDF hosts cannot be deleted from here.", true);
    return;
  }
  const label = listed?.title ?? pieceId;
  if (!window.confirm(`Delete “${label}” and unreferenced children? This cannot be undone.`)) {
    return;
  }
  const result = await window.intro.dropSide(pieceId);
  if (!result.ok) {
    setStatus(result.error, true);
    return;
  }
  const deleted = new Set(result.deleted);
  pruneDeletedNodes(deleted);
  for (const id of result.deleted) {
    delete state.views[id];
  }
  for (const host of result.hosts) {
    state.views[host.id] = host;
  }
  state.pieces = result.pieces;
  renderSidebar();
  renderColumns();
  setStatus(
    result.deleted.length === 1
      ? `Deleted ${result.deleted[0]}`
      : `Deleted ${result.deleted.length} pieces`,
  );
}

async function detachNode(node: OpenNode): Promise<void> {
  const parent = state.nodes.find((entry) => entry.id === node.parentId);
  if (!parent || !node.viaRivetId) return;
  // Preserve edits before rebuilding columns, including the detached note itself.
  for (const surface of el.columns.querySelectorAll<HTMLElement>("[data-piece-id]")) {
    const id = surface.dataset.pieceId;
    const editor = surface.querySelector<HTMLTextAreaElement>("textarea.editor");
    if (!id || !editor || editor.value === state.views[id]?.clean) continue;
    const timer = persistTimers.get(id);
    if (timer !== undefined) window.clearTimeout(timer);
    persistTimers.delete(id);
    const saved = await window.intro.persistClean(id, editor.value);
    if (!saved.ok) { setStatus(saved.error, true); return; }
    state.views[id] = saved.piece;
  }
  const result = await window.intro.detachSide(parent.pieceId, node.viaRivetId);
  if (!result.ok) { setStatus(result.error, true); return; }
  state.views[parent.pieceId] = result.host;
  for (const entry of [...state.nodes]) {
    const host = state.nodes.find((item) => item.id === entry.parentId);
    if (host?.pieceId === parent.pieceId && entry.viaRivetId === node.viaRivetId) {
      state.nodes = closeNode(state.nodes, entry.id);
    }
  }
  renderSidebar();
  renderColumns();
  setStatus("已解除这条挂接，笔记及其他引用已保留。");
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
    btn.className = "piece-open";
    const title = document.createElement("span");
    title.className = "piece-title";
    title.textContent = piece.title;
    const id = document.createElement("span");
    id.className = "piece-id";
    id.textContent = piece.id;
    btn.append(title);
    if (piece.medium === "pdf") {
      const badge = document.createElement("span");
      badge.className = "piece-pdf";
      badge.textContent = "PDF";
      btn.append(badge);
    }
    btn.append(id);
    btn.title = `${piece.title}\n${piece.id}\n${piece.path}`;
    btn.classList.toggle("on", openIds.has(piece.id));
    btn.addEventListener("click", () => {
      void openRootPiece(piece.id);
    });
    li.append(btn);
    if (piece.medium === "text") {
      const drop = document.createElement("button");
      drop.type = "button";
      drop.className = "piece-drop danger";
      drop.textContent = "删除笔记";
      drop.title = "Delete this text piece and unreferenced children";
      drop.addEventListener("click", (ev) => {
        ev.stopPropagation();
        void confirmDropSide(piece.id);
      });
      li.append(drop);
    }
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
  insertColumnSplitters();
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

  const damaged = Boolean(view && view.damage.length > 0);
  const hangFromHere = (sideId: string | undefined): void => {
    if (modeOf(node.id) === "rendered") {
      applyMode(surface, "source");
      editor.focus();
      setStatus(
        sideId
          ? "Select a span in source, then hang an existing piece."
          : "Select a span in source, then New side.",
      );
      return;
    }
    void hangFromEditor(node.id, editor, sideId);
  };
  body.addEventListener("contextmenu", (ev) => {
    const sourceOn = modeOf(node.id) !== "rendered";
    showCtxMenu(ev, [
      {
        label: sourceOn ? "✓ Source" : "Source",
        run: () => {
          applyMode(surface, "source");
          editor.focus();
        },
      },
      {
        label: sourceOn ? "Rendered" : "✓ Rendered",
        run: () => {
          applyMode(surface, "rendered");
        },
      },
      {
        label: "New side",
        disabled: damaged,
        run: () => {
          hangFromHere(undefined);
        },
      },
      {
        label: "Hang existing…",
        disabled: damaged,
        run: async () => {
          const start = editor.selectionStart;
          const end = editor.selectionEnd;
          const sideId = await promptExistingSide(node.pieceId, false);
          if (sideId) {
            editor.setSelectionRange(start, end);
            hangFromHere(sideId);
          }
        },
      },
    ]);
  });
  rendered.addEventListener("click", (ev) => {
    const mark = (ev.target as HTMLElement).closest("mark[data-rivet]") as HTMLElement | null;
    const rivetId = mark?.dataset.rivet;
    if (!rivetId) {
      return;
    }
    const spec = state.views[node.pieceId]?.rivets.find((r) => r.id === rivetId);
    if (spec?.to) {
      void toggleSideColumn(node.id, spec.to, spec.id);
    }
  });

  surface.append(body);
  if (node.depth === 0) {
    const rivets = document.createElement("div");
    rivets.className = "rivets";
    const heading = document.createElement("h3");
    heading.textContent = damaged
      ? `Damaged (${view!.damage.map((d) => d.kind).join(", ")})`
      : `Rivets (${view?.rivets.length ?? 0})`;
    rivets.append(heading);
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
        to.className = "muted rivet-to";
        if (rivet.to) {
          to.dataset.to = rivet.to;
          to.textContent = `→ ${titleOf(rivet.to)}`;
        } else {
          to.textContent = "(no side)";
        }
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
            void toggleSideColumn(node.id, rivet.to, rivet.id);
          }
        });
        rivets.append(btn);
      }
    }
    surface.append(rivets);
  }
  applyMode(surface, modeOf(node.id));
  return editor;
}

function appendRivetButtons(
  rivetsEl: HTMLElement,
  node: OpenNode,
  items: { id: string; to?: string | null; label: string; page?: number }[],
  onJump?: (rivetId: string, page?: number) => void,
): void {
  const openIds = new Set(openRivetIds(state.nodes, node.id));
  for (const rivet of items) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "rivet";
    btn.dataset.rivet = rivet.id;
    if (rivet.page != null) {
      btn.dataset.page = String(rivet.page);
    }
    btn.classList.toggle("open", openIds.has(rivet.id));
    const quote = document.createElement("span");
    quote.className = "quote";
    quote.textContent = `「${rivet.label}」`;
    const to = document.createElement("span");
    to.className = "muted rivet-to";
    if (rivet.to) {
      to.dataset.to = rivet.to;
      to.textContent = rivet.page != null
        ? `p${rivet.page} → ${titleOf(rivet.to)}`
        : `→ ${titleOf(rivet.to)}`;
    } else {
      to.textContent = rivet.page != null ? `p${rivet.page}` : "(no side)";
    }
    btn.append(quote, to);
    btn.disabled = !rivet.to && onJump == null;
    btn.addEventListener("pointerenter", () => {
      setHot(rivet.id);
    });
    btn.addEventListener("pointerleave", () => {
      setHot(null);
    });
    btn.addEventListener("click", () => {
      onJump?.(rivet.id, rivet.page);
      if (rivet.to) {
        void toggleSideColumn(node.id, rivet.to, rivet.id);
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
  const drawer = document.createElement("nav");
  drawer.className = "pdf-outline-drawer";
  drawer.hidden = true;
  drawer.setAttribute("aria-label", "Outline");
  body.append(pane, drawer);

  const chrome = document.createElement("div");
  chrome.className = "pdf-chrome";
  const zoomOutBtn = document.createElement("button");
  zoomOutBtn.type = "button";
  zoomOutBtn.textContent = "−";
  zoomOutBtn.title = "Zoom out";
  const zoomLabel = document.createElement("span");
  zoomLabel.className = "pdf-zoom-label";
  zoomLabel.textContent = formatZoom(ZOOM_FIT);
  const zoomInBtn = document.createElement("button");
  zoomInBtn.type = "button";
  zoomInBtn.textContent = "+";
  zoomInBtn.title = "Zoom in";
  const fitBtn = document.createElement("button");
  fitBtn.type = "button";
  fitBtn.textContent = "Fit width";
  const pageLabel = document.createElement("label");
  pageLabel.className = "pdf-page-jump";
  pageLabel.textContent = "Page ";
  const pageInput = document.createElement("input");
  pageInput.type = "number";
  pageInput.min = "1";
  pageInput.value = "1";
  pageInput.title = "Jump to page";
  const pageOf = document.createElement("span");
  pageOf.className = "muted";
  pageOf.textContent = " / ?";
  pageLabel.append(pageInput, pageOf);
  const outlineBtn = document.createElement("button");
  outlineBtn.type = "button";
  outlineBtn.className = "pdf-outline-btn";
  outlineBtn.textContent = "Outline";
  outlineBtn.setAttribute("aria-expanded", "false");
  const setOutlineOpen = (on: boolean): void => {
    drawer.hidden = !on;
    outlineBtn.classList.toggle("on", on);
    outlineBtn.setAttribute("aria-expanded", on ? "true" : "false");
  };

  const overlayCount = view?.overlayRivets.length ?? 0;
  const rivetSummary = document.createElement("button");
  rivetSummary.type = "button";
  rivetSummary.textContent = `Rivets (${overlayCount})`;
  rivetSummary.title = "Overlay rivets — jump to a region or open its side";
  const rivetNav = document.createElement("nav");
  rivetNav.className = "pdf-outline-drawer pdf-rivets-drawer";
  rivetNav.hidden = true;
  const setRivetsOpen = (on: boolean): void => {
    rivetNav.hidden = !on;
    rivetSummary.classList.toggle("on", on);
    rivetSummary.setAttribute("aria-expanded", String(on));
  };
  setRivetsOpen(false);
  rivetNav.setAttribute("aria-label", "Overlay rivets");
  if (!view || overlayCount === 0) {
    const empty = document.createElement("p");
    empty.className = "muted empty-rivets";
    empty.textContent = "No overlay rivets yet. Drag a region, then New side.";
    rivetNav.append(empty);
  } else {
    appendRivetButtons(
      rivetNav,
      node,
      view.overlayRivets.map((rivet) => ({
        id: rivet.id,
        to: rivet.to,
        label: overlayQuote(rivet),
        page: rivet.anchors[0]?.page,
      })),
      (_id, page) => {
        if (page != null) {
          pendingPdfPage = { nodeId: node.id, page };
          pdfViews.get(node.id)?.gotoPage(page);
        }
      },
    );
  }
  body.append(rivetNav);
  outlineBtn.addEventListener("click", () => {
    if (outlineBtn.disabled) {
      return;
    }
    setRivetsOpen(false);
    setOutlineOpen(drawer.hidden);
  });
  rivetSummary.addEventListener("click", () => {
    setOutlineOpen(false);
    setRivetsOpen(rivetNav.hidden);
  });

  chrome.append(
    zoomOutBtn,
    zoomLabel,
    zoomInBtn,
    fitBtn,
    pageLabel,
    outlineBtn,
    rivetSummary,
  );

  surface.append(chrome, body);

  pane.addEventListener("contextmenu", (ev) => {
    const hasSel = Boolean(pdfViews.get(node.id)?.getSelection()?.anchors.length);
    if (!hasSel) {
      setStatus("Drag a region on the PDF first.", true);
    }
    showCtxMenu(ev, [
      {
        label: "New side",
        disabled: !hasSel,
        run: () => {
          void hangFromPdf(node.id, undefined);
        },
      },
      {
        label: "Hang existing…",
        disabled: !hasSel,
        run: async () => {
          const sideId = await promptExistingSide(node.pieceId, true);
          if (sideId) {
            void hangFromPdf(node.id, sideId);
          }
        },
      },
    ]);
  });

  const onOutlinePointer = (ev: PointerEvent): void => {
    if (!drawer.isConnected) {
      document.removeEventListener("pointerdown", onOutlinePointer);
      window.removeEventListener("keydown", onOutlineKey);
      return;
    }
    const target = ev.target as Node;
    if (!rivetNav.contains(target) && !rivetSummary.contains(target)) setRivetsOpen(false);
    if (drawer.contains(target) || outlineBtn.contains(target)) {
      return;
    }
    setOutlineOpen(false);
  };
  const onOutlineKey = (ev: KeyboardEvent): void => {
    if (!drawer.isConnected) {
      document.removeEventListener("pointerdown", onOutlinePointer);
      window.removeEventListener("keydown", onOutlineKey);
      return;
    }
    if (ev.key === "Escape") {
      setRivetsOpen(false);
      hideCtxMenu();
      if (!drawer.hidden) {
        setOutlineOpen(false);
      }
    }
  };
  document.addEventListener("pointerdown", onOutlinePointer);
  window.addEventListener("keydown", onOutlineKey);

  const paintOutline = (items: PdfOutlineEntry[], parent: HTMLElement, goto: (page: number) => void): void => {
    const ul = document.createElement("ul");
    for (const item of items) {
      const li = document.createElement("li");
      if (item.page != null) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = item.title;
        btn.title = `Page ${item.page}`;
        const page = item.page;
        btn.addEventListener("click", () => {
          goto(page);
        });
        li.append(btn);
      } else {
        const span = document.createElement("span");
        span.className = "muted";
        span.textContent = item.title;
        li.append(span);
      }
      if (item.children.length > 0) {
        paintOutline(item.children, li, goto);
      }
      ul.append(li);
    }
    parent.append(ul);
  };

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
      readingStorageKey: readingKey(state.root ?? "", node.pieceId),
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
          void toggleSideColumn(node.id, rivet.to, rivet.id);
        }
      },
      onPageChange: (page, numPages) => {
        pageInput.max = String(numPages);
        if (document.activeElement !== pageInput) {
          pageInput.value = String(page);
        }
        pageOf.textContent = ` / ${numPages}`;
      },
    });
    pdfViews.get(node.id)?.destroy();
    pdfViews.set(node.id, handle);
    if (pendingPdfPage?.nodeId === node.id) {
      handle.gotoPage(pendingPdfPage.page);
      pendingPdfPage = null;
    }
    zoomLabel.textContent = formatZoom(handle.getZoom());
    pageInput.max = String(handle.numPages());
    pageInput.value = String(handle.currentPage());
    pageOf.textContent = ` / ${handle.numPages()}`;
    const applyZoom = async (next: number): Promise<void> => {
      await handle.setZoom(next);
      zoomLabel.textContent = formatZoom(handle.getZoom());
      scheduleChrome();
    };
    zoomOutBtn.addEventListener("click", () => {
      void applyZoom(zoomOut(handle.getZoom()));
    });
    zoomInBtn.addEventListener("click", () => {
      void applyZoom(zoomIn(handle.getZoom()));
    });
    fitBtn.addEventListener("click", () => {
      void applyZoom(ZOOM_FIT);
    });
    const jump = (): void => {
      handle.gotoPage(parsePageInput(pageInput.value, handle.numPages()));
    };
    pageInput.addEventListener("change", jump);
    pageInput.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        jump();
      }
    });
    const items = await handle.getOutline();
    drawer.replaceChildren();
    if (items.length === 0) {
      outlineBtn.textContent = "No outline";
      outlineBtn.disabled = true;
      setOutlineOpen(false);
    } else {
      outlineBtn.textContent = "Outline";
      outlineBtn.disabled = false;
      paintOutline(items, drawer, (page) => {
        handle.gotoPage(page);
      });
    }
    scheduleChrome();
  })();
}

function renderHost(node: OpenNode): HTMLElement {
  const view = state.views[node.pieceId];
  const section = document.createElement("section");
  section.className = "column";
  section.dataset.depth = "0";
  applyColumnWidth(section, 0, view?.medium === "pdf");

  const head = document.createElement("div");
  head.className = "column-head";
  const depth = document.createElement("span");
  depth.className = "depth";
  depth.textContent = "d0";
  const titles = document.createElement("div");
  titles.className = "head-titles";
  const name = document.createElement("span");
  name.className = "piece-title";
  name.textContent = titleOf(node.pieceId);
  name.title = view?.path ?? node.pieceId;
  const id = document.createElement("span");
  id.className = "id piece-id";
  id.textContent = node.pieceId;
  id.title = node.pieceId;
  titles.append(name, id);
  const rename = document.createElement("button");
  rename.type = "button";
  rename.textContent = "Rename";
  rename.title = "Set display name. File id stays the same.";
  rename.addEventListener("click", () => {
    void renamePiece(node.pieceId);
  });
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "Close";
  close.addEventListener("click", () => {
    state.nodes = closeNode(state.nodes, ROOT_ID);
    renderSidebar();
    renderColumns();
    setStatus("Closed the chain. Rivets stay on disk.");
  });
  head.append(depth, titles, rename, close);
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
  titles.className = "head-titles";
  const name = document.createElement("strong");
  name.className = "piece-title";
  name.textContent = titleOf(node.pieceId, excerptFor(node));
  name.title = [titleOf(node.pieceId, excerptFor(node)), node.pieceId, view?.path]
    .filter(Boolean)
    .join("\n");
  titles.append(name);
  if (parent) {
    const from = document.createElement("div");
    from.className = "from";
    from.textContent = `← ${titleOf(parent.pieceId)}`;
    titles.append(from);
  }
  const rename = document.createElement("button");
  rename.type = "button";
  rename.textContent = "Rename";
  rename.title = "Set display name. File id stays the same.";
  rename.addEventListener("click", () => {
    void renamePiece(node.pieceId);
  });
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "Close";
  close.addEventListener("click", () => {
    state.nodes = closeNode(state.nodes, node.id);
    renderSidebar();
    renderColumns();
    setStatus("Closed this side and its subtree. Rivets stay on disk.");
  });
  const drop = document.createElement("button");
  drop.type = "button";
  drop.className = "danger";
  drop.textContent = "删除笔记";
  drop.title = "Delete this note from the library and unreferenced children";
  drop.addEventListener("click", () => {
    void confirmDropSide(node.pieceId);
  });
  const detach = document.createElement("button");
  detach.type = "button";
  detach.textContent = "解除挂接";
  detach.title = "仅移除这条连接，保留笔记及其他引用";
  detach.onclick = async () => {
    detach.disabled = true;
    try { await detachNode(node); } finally { detach.disabled = false; }
  };
  head.append(titles, rename, close, detach, drop);
  card.append(head);
  bindSurface(node, card);
  const heightKey = cardHeightKey(state.root ?? "", node.id);
  const savedHeight = loadCardHeight(localStorage, heightKey);
  if (savedHeight !== null) card.style.height = `${savedHeight}px`;
  // Old independent top gaps are deliberately ignored: adjacent cards share an edge.
  const nextVisibleCard = (): HTMLElement | undefined => {
    let next = card.nextElementSibling as HTMLElement | null;
    while (next && next.hidden) next = next.nextElementSibling as HTMLElement | null;
    return next ?? undefined;
  };
  const resize = document.createElement("div");
  resize.className = "card-resize";
  resize.setAttribute("role", "separator");
  resize.setAttribute("aria-orientation", "horizontal");
  resize.title = "拖动共享边界调整上下笔记高度；双击恢复默认";
  resize.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    resize.classList.add("dragging");
    document.body.classList.add("is-row-resizing");
    const startY = event.clientY;
    const startHeight = card.getBoundingClientRect().height;
    const lower = nextVisibleCard();
    const lowerHeight = lower?.getBoundingClientRect().height ?? 0;
    const lowerKey = lower ? cardHeightKey(state.root ?? "", lower.dataset.nodeId!) : null;
    const move = (next: PointerEvent): void => {
      if (next.pointerId !== event.pointerId) return;
      const delta = next.clientY - startY;
      const [height, below] = lower
        ? resizeCardPair(startHeight, lowerHeight, delta)
        : [clampCardHeight(startHeight + delta), 0];
      if (lower && lowerKey) {
        lower.style.height = `${below}px`;
        saveCardHeight(localStorage, lowerKey, below);
      }
      card.style.height = `${height}px`;
      saveCardHeight(localStorage, heightKey, height);
      scheduleChrome();
    };
    const stop = (): void => {
      resize.classList.remove("dragging");
      document.body.classList.remove("is-row-resizing");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  });
  resize.addEventListener("dblclick", () => {
    card.style.removeProperty("height");
    const lower = nextVisibleCard();
    if (lower) {
      lower.style.removeProperty("height");
      saveCardHeight(localStorage, cardHeightKey(state.root ?? "", lower.dataset.nodeId!), null);
    }
    saveCardHeight(localStorage, heightKey, null);
    scheduleChrome();
  });
  card.append(resize);
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
  applyColumnWidth(section, depth, false);

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
  setStatus(
    result.piece.medium === "pdf"
      ? `Opened PDF host ${result.piece.title}`
      : `Opened ${result.piece.title}`,
  );
}

async function toggleSideColumn(
  parentId: string,
  pieceId: string,
  rivetId: string,
): Promise<void> {
  const already = state.nodes.find((n) => n.parentId === parentId && n.viaRivetId === rivetId);
  if (already) {
    state.nodes = closeNode(state.nodes, already.id);
    renderSidebar();
    renderColumns();
    setHot(null);
    setStatus("Closed this side and its subtree. Rivets stay on disk.");
    return;
  }
  await openSideColumn(parentId, pieceId, rivetId);
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
  setStatus(already ? `Focused side ${result.piece.title}` : `Opened side ${result.piece.title}`);
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
  setStatus(`Attached PDF host ${result.piece.title} (overlay sidecar; PDF not rewritten)`);
});

el.newPiece.addEventListener("click", async () => {
  const title = await askTitle("新建笔记");
  if (title === null) {
    return;
  }
  const result = await window.intro.createPiece({
    body: "",
    ...(title.trim() ? { title } : {}),
  });
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
  setStatus(`Created ${result.piece.title}`);
});

window.intro.onLibraryOpened((library) => {
  applyLibrary(library);
  forgetAllPdfDocs();
  renderColumns();
  setStatus(`Library ${library.root}`);
});

el.columns.addEventListener("scroll", scheduleChrome);
window.addEventListener("resize", scheduleChrome);
window.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") {
    hideCtxMenu();
  }
});
document.addEventListener("pointerdown", (ev) => {
  if (ctxMenu && !ctxMenu.contains(ev.target as Node)) {
    hideCtxMenu();
  }
});
new ResizeObserver(scheduleChrome).observe(el.board);

bindVSplitter(el.splitSidebar, {
  getWidth: () => el.sidebar.getBoundingClientRect().width,
  setWidth: applySidebarWidth,
  clamp: clampSidebarWidth,
});
applySidebarWidth(chromeLayout.sidebarWidth);

renderSidebar();
renderColumns();
