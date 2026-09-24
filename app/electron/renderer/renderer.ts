import type { AiStart, AiJobView, AiModel, AiContext, AiSelection } from "./ai-types.ts";
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
import { PinBoard, type Pin } from "./pins.ts";
import { locateText, mapRenderedBlocks, renderedSelection } from "./pin-model.ts";
import { loadSidePins, saveSidePins, sidePinId } from "./side-pins.ts";
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
  renderPdfExcerpt,
  capturePdfContext,
  readPdfContextPage,
  type PdfAnchor,
  type OverlayRivet,
  type PdfViewHandle,
} from "./pdf-view.ts";
import { mountOutlineView, type OutlineView } from "./pdf-outline-view.ts";
import { katexMath, renderHtml } from "./render.ts";
import { batchTo, inputChange, type EditBatch, type InputChange } from "./input-edits.ts";
import { paintMathAnchors, paintMathRegions } from "./math-anchors.ts";

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
  aiEdit: (id: string, expected: string, markdown: string) => Promise<Ok<{ job: AiJobView }> | Err>;
  aiModels: () => Promise<Ok<{ models: AiModel[] }> | Err>;
  aiApply: (id: string, undo?: boolean) => Promise<Ok<{ piece: PieceDto }> | Err>;
  aiProvideContext: (id: string, result: { context?: AiContext; error?: string }) => Promise<void>;
  onAiRead: (callback: (request: { id: string; root: string; pieceId: string; page: number; textOnly?: boolean }) => void) => () => void;
  aiStart: (request: AiStart) => Promise<Ok<{ job: AiJobView }> | Err>;
  aiStatus: (id: string) => Promise<Ok<{ job: AiJobView }> | Err>;
  aiCancel: (id: string) => Promise<Ok<{ job: AiJobView }> | Err>;
  aiList: () => Promise<Ok<{ jobs: AiJobView[] }> | Err>;
  aiLogin: () => Promise<Ok<{}> | Err>;
  aiCommit: (id: string) => Promise<Ok<{ host: PieceDto; side: PieceDto; rivetId: string }> | Err>;

  editExcerpt: (id: string, expected: string, start: number, end: number, text: string) => Promise<Ok<{ piece: PieceDto }> | Err>;
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
  persistClean: (id: string, clean: string, batch?: EditBatch) => Promise<Ok<{ piece: PieceDto }> | Err>;
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
      onMenuCommand: (cb: (command: string) => void) => () => void;
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
  sidePins: Set<string>;
};

const state: State = {
  root: null,
  pieces: [],
  nodes: [],
  views: {},
  modes: {},
  sidePins: new Set(),
};

const el = {
  hidePieces: document.getElementById("btn-hide-pieces") as HTMLButtonElement,
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

const inputHistory = new Map<string, InputChange[]>();
const saveQueues = new Map<string, Promise<Ok<{ piece: PieceDto }> | Err>>();
function draftKey(id: string): string { return `intro:unsaved:v1:${JSON.stringify([state.root, id])}`; }
function saveSource(id: string, clean: string): Promise<Ok<{ piece: PieceDto }> | Err> {
  const root = state.root;
  const key = JSON.stringify([root, id]);
  const previous = saveQueues.get(key);
  const task = (async (): Promise<Ok<{ piece: PieceDto }> | Err> => {
    if (previous) await previous;
    if (state.root !== root) return { ok: false, error: "资料库已切换，未写入。" };
    const expected = state.views[id]?.clean ?? clean;
    const batch = batchTo(inputHistory.get(key) ?? [], expected, clean) ??
      { expected, edits: [inputChange(expected, clean, 0, 0, "unknown").edit] };
    const result = await window.intro.persistClean(id, clean, batch);
    if (result.ok && state.root === root) {
      state.views[id] = result.piece;
      try {
        const draft = JSON.parse(localStorage.getItem(draftKey(id)) ?? "null");
        if (draft?.text === clean) localStorage.removeItem(draftKey(id));
      } catch { /* Preference storage is best effort. */ }
    }
    return result;
  })();
  saveQueues.set(key, task);
  return task;
}

const pdfViews = new Map<string, PdfViewHandle>();
/** Unfolded outline entries per [library, PDF], so re-rendering a column keeps them. */
const outlineFolds = new Map<string, Set<string>>();
const chromeLayout: ChromeLayout = loadChromeLayout(localStorage);
let hotId: string | null = null;
let wireFrame = 0;
let pendingAlign: string | null = null;
let columnStart = 0;

function showColumnWindow(start: number): void {
  const hi = maxDepth(state.nodes);
  columnStart = Math.max(0, Math.min(start, Math.max(0, hi - 2)));
  const cols = Array.from(el.columns.querySelectorAll<HTMLElement>(":scope > .column"));
  for (const col of cols) {
    const depth = Number(col.dataset.depth ?? 0);
    col.hidden = depth < columnStart || depth > columnStart + 2;
    col.style.minWidth = "0";
    col.style.width = "0";
    col.style.flex = `${chromeLayout.columnWidths[String(depth)] ?? 360} 1 0px`;
  }
  el.columns.querySelectorAll(":scope > .splitter").forEach((split) => split.remove());
  insertColumnSplitters();
  const nav = document.getElementById("column-nav")!;
  nav.replaceChildren();
  if (!state.nodes.length) return;
  if (hi === 0) {
    scheduleChrome();
    return;
  }
  const button = (label: string, target: number, disabled = false): void => {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.disabled = disabled;
    btn.onclick = () => showColumnWindow(target);
    nav.append(btn);
  };
  button("←", columnStart - 1, columnStart === 0);
  for (let depth = 0; depth <= hi; depth++) {
    button(depth === 0 ? "原文" : `d${depth} · ${nodesAtDepth(state.nodes, depth).length}`, Math.max(0, depth - 2));
    nav.lastElementChild?.setAttribute("aria-current", String(depth >= columnStart && depth <= columnStart + 2));
  }
  button("→", columnStart + 1, columnStart + 2 >= hi);
  scheduleChrome();
}
let pendingPdfPage: { nodeId: string; page: number } | null = null;
let pendingPinAnchor: { pieceId: string; anchor: PdfAnchor } | null = null;

const pinBoard = new PinBoard(el.board, {
  layout: scheduleChrome,
  load: async id => {
    // Flush local drafts before editing a projection of the same source.
    const surfaces = Array.from(el.columns.querySelectorAll<HTMLElement>("[data-piece-id]")).filter(surface => surface.dataset.pieceId === id);
    const editor = surfaces.map(surface => surface.querySelector<HTMLTextAreaElement>("textarea.editor")).find(editor => editor && editor.value !== state.views[id]?.clean);
    if (editor) {
      const timer = persistTimers.get(id);
      if (timer !== undefined) window.clearTimeout(timer);
      persistTimers.delete(id);
      const saved = await saveSource(id, editor.value);
      if (!saved.ok) throw new Error(saved.error);
      pinBoard.sourceChanged(id, state.views[id]?.clean ?? saved.piece.clean, saved.piece.clean);
      state.views[id] = saved.piece;
    }
    const result = await window.intro.loadPiece(id);
    if (!result.ok) throw new Error(result.error);
    return result.piece;
  },
  edit: async (id, expected, start, end, text) => {
    const surfaces = Array.from(el.columns.querySelectorAll<HTMLElement>("[data-piece-id]")).filter(surface => surface.dataset.pieceId === id);
    if (surfaces.some(surface => {
      const editor = surface.querySelector<HTMLTextAreaElement>("textarea.editor");
      return editor && editor.value !== expected;
    })) throw new Error("原笔记编辑区已变化。请取消并重新打开置顶编辑，合并最新内容。");
    const result = await window.intro.editExcerpt(id, expected, start, end, text);
    if (!result.ok) throw new Error(result.error);
    pinBoard.sourceChanged(id, expected, result.piece.clean);
    state.views[id] = result.piece;
    for (const surface of surfaces) {
      const editor = surface.querySelector<HTMLTextAreaElement>("textarea.editor");
      if (editor) editor.value = result.piece.clean;
      paintSurface(surface);
    }
    scheduleChrome();
    return result.piece;
  },
  pdf: async (id, anchor) => {
    return renderPdfExcerpt(id, async () => {
      const result = await window.intro.readPdf(id);
      if (!result.ok) throw new Error(result.error);
      return result.data;
    }, anchor);
  },
  reveal: async (pin: Pin) => {
    let node = state.nodes.find(node => node.id === pin.nodeId && node.pieceId === pin.sourceId) ?? state.nodes.find(node => node.pieceId === pin.sourceId);
    if (!node) {
      if (pin.kind === "pdf") pendingPinAnchor = { pieceId: pin.sourceId, anchor: pin.anchors[0] };
      await openRootPiece(pin.sourceId);
      node = state.nodes.find(node => node.pieceId === pin.sourceId);
    }
    if (!node) throw new Error("来源无法打开");
    showColumnWindow(Math.max(0, node.depth - 2));
    if (pin.kind === "pdf") {
      const handle = pdfViews.get(node.id);
      if (handle) handle.gotoAnchor(pin.anchors[0]);
      else pendingPinAnchor = { pieceId: pin.sourceId, anchor: pin.anchors[0] };
    } else {
      const surface = surfaceOf(node.id);
      const editor = surface?.querySelector<HTMLTextAreaElement>("textarea.editor");
      if (!surface || !editor) throw new Error("来源暂不可见");
      const range = locateText(editor.value, pin.anchor);
      if (!range) throw new Error("来源选区已变化，请重新选择。");
      applyMode(surface, "source");
      editor.focus(); editor.setSelectionRange(range.start, range.end);
      const lineHeight = Number.parseFloat(getComputedStyle(editor).lineHeight) || 24;
      editor.scrollTop = Math.max(0, (editor.value.slice(0, range.start).split("\n").length - 2) * lineHeight);
    }
  },
});

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

function applySidebarHidden(hidden: boolean): void {
  chromeLayout.sidebarHidden = hidden;
  el.sidebar.hidden = hidden;
  el.splitSidebar.hidden = hidden;
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
  const cols = Array.from(el.columns.querySelectorAll<HTMLElement>(":scope > .column")).filter(col => !col.hidden);
  // After every column, including the last, so a lone PDF/host pane can be enlarged.
  for (let i = 0; i < cols.length - 1; i++) {
    const left = cols[i]!;
    const right = cols[i + 1]!;
    let total = 0;
    const split = document.createElement("div");
    split.className = "splitter v-split";
    split.setAttribute("role", "separator");
    split.setAttribute("aria-orientation", "vertical");
    split.setAttribute(
      "aria-label",
      left.classList.contains("pdf-host") ? "Resize PDF column" : "Resize column",
    );
    bindVSplitter(split, {
      getWidth: () => {
        for (const col of cols) col.style.flex = `${col.getBoundingClientRect().width} 1 0px`;
        total = left.getBoundingClientRect().width + right.getBoundingClientRect().width;
        return left.getBoundingClientRect().width;
      },
      setWidth: (width) => {
        left.style.flex = `${width} 1 0px`;
        right.style.flex = `${total - width} 1 0px`;
        for (const col of cols) chromeLayout.columnWidths[col.dataset.depth ?? "0"] = Number.parseFloat(col.style.flexGrow);
        chromeLayout.columnWidths[left.dataset.depth ?? String(i)] = width;
        persistLayout();
        scheduleChrome();
      },
      clamp: value => Math.max(Math.min(160, total / 2), Math.min(total - Math.min(160, total / 2), value)),
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
  danger?: boolean;
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
    btn.classList.toggle("danger", Boolean(item.danger));
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
  return state.modes[nodeId] ?? "rendered";
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
  mapRenderedBlocks(pane, editor.value);
  paintMathAnchors(pane);
  pane.querySelectorAll("mark[data-rivet], [data-math-rivets]").forEach((mark) => {
    const rivetId = (mark as HTMLElement).dataset.rivet ?? (mark as HTMLElement).dataset.mathRivets?.split(" ")[0];
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
    el.columns.querySelectorAll<HTMLElement>(".body-rendered").forEach(pane => paintMathRegions(pane, hotId));
    drawWires();
  });
}

/** Explicitly pinned sides survive source scrolling, including hidden ancestors. */
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
    if (card.dataset.sidePinned === "true") {
      card.hidden = false;
      continue;
    }
    const host = surfaceOf(node.parentId);
    if ((host?.closest(".column") as HTMLElement | null)?.hidden) {
      card.hidden = false;
      continue;
    }
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
  el.columns.querySelectorAll("mark.hot, .rivet.hot, .card.hot, .pdf-hl.hot, .math-rivet.hot").forEach((node) => {
    node.classList.remove("hot");
  });
  if (id) {
    el.columns.querySelectorAll(`[data-rivet="${CSS.escape(id)}"], [data-math-rivets~="${CSS.escape(id)}"]`).forEach((node) => {
      node.classList.add("hot");
    });
    el.columns.querySelectorAll(`.card[data-node-id="${CSS.escape(id)}"]`).forEach((node) => {
      node.classList.add("hot");
    });
  }
  el.columns.querySelectorAll<HTMLElement>(".body-rendered").forEach(pane => paintMathRegions(pane, hotId));
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
  state.sidePins = loadSidePins(localStorage, library.root);
  pinBoard.setLibrary(library.root);
  state.pieces = library.pieces;
  const name = library.root.split(/[\\/]/).filter(Boolean).pop() ?? library.root;
  document.title = `intro — ${name}`;
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
    const saved = await saveSource(id, editor.value);
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
    ? "空库。右键此处或 Ctrl+N 新建第一篇笔记。"
    : "File → Open library（Ctrl+O）打开一个文件夹。空文件夹就是新库。";
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
    btn.addEventListener("contextmenu", (ev) => {
      ev.stopPropagation();
      showCtxMenu(ev, [
        { label: "打开", run: () => { void openRootPiece(piece.id); } },
        { label: "删除笔记", danger: true, disabled: piece.medium !== "text", run: () => { void confirmDropSide(piece.id); } },
      ]);
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
  const drafts = new Map<string, { pieceId: string | undefined; value: string; top: number; start: number; end: number }>();
  for (const surface of el.columns.querySelectorAll<HTMLElement>("[data-node-id]")) {
    const editor = surface.querySelector<HTMLTextAreaElement>("textarea.editor");
    if (editor) drafts.set(surface.dataset.nodeId!, { pieceId: surface.dataset.pieceId, value: editor.value, top: editor.scrollTop, start: editor.selectionStart, end: editor.selectionEnd });
  }
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
      ? "从左侧打开一篇，或 Ctrl+N 新建。"
      : "File → Open library（Ctrl+O）打开本地库。";
    el.columns.append(hint);
    document.getElementById("column-nav")!.replaceChildren();
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
  const target = state.nodes.find(node => node.id === pendingAlign)?.depth;
  showColumnWindow(target === undefined ? columnStart : Math.max(0, target - 2));
  for (const [id, draft] of drafts) {
    const surface = surfaceOf(id);
    const editor = surface?.querySelector<HTMLTextAreaElement>("textarea.editor");
    if (!editor || !surface) continue;
    // Do not carry the previous root's text into a newly opened document.
    if (surface.dataset.pieceId !== draft.pieceId) continue;
    editor.value = draft.value;
    editor.scrollTop = draft.top;
    editor.setSelectionRange(draft.start, draft.end);
    paintSurface(surface);
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
  try {
    const draft = JSON.parse(localStorage.getItem(draftKey(node.pieceId)) ?? "null");
    if (draft && draft.text !== editor.value) {
      const recovery = document.createElement("button");
      recovery.textContent = "恢复未保存的编辑";
      recovery.addEventListener("click", () => {
        editor.value = draft.text;
        applyMode(surface, "source"); editor.focus();
        recovery.remove();
        setStatus("已恢复草稿。原文件未改变；请检查挂接来源后继续编辑。", true);
      });
      body.prepend(recovery);
    }
  } catch { /* Ignore malformed draft preferences. */ }

  if (view && view.damage.length > 0) {
    editor.readOnly = true;
  }
  paintHighlights(highlights, editor.value, view?.rivets ?? [], openRivetIds(state.nodes, node.id));
  let inputBefore = editor.value, inputStart = 0, inputEnd = 0, inputType = "";
  editor.addEventListener("beforeinput", (event) => {
    inputBefore = editor.value; inputStart = editor.selectionStart; inputEnd = editor.selectionEnd;
    inputType = event.inputType;
  });
  editor.addEventListener("input", () => {
    const key = JSON.stringify([state.root, node.pieceId]);
    const history = inputHistory.get(key) ?? [];
    history.push(inputChange(inputBefore, editor.value, inputStart, inputEnd, inputType));
    inputHistory.set(key, history);
    inputBefore = editor.value;
    try { localStorage.setItem(draftKey(node.pieceId), JSON.stringify({ text: editor.value, expected: state.views[node.pieceId]?.clean })); } catch { /* best effort */ }

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
    const selected = sourceOn
      ? { start: editor.selectionStart, end: editor.selectionEnd, expanded: false }
      : renderedSelection(rendered, editor.value);
    showCtxMenu(ev, [
      { label: "Ask Codex…", disabled: damaged || !selected || selected.start === selected.end,
        run: () => { if (selected) void askCodex(node.id, { kind: "text", expected: editor.value, start: selected.start, end: selected.end }); } },
      {
        label: selected?.expanded ? "置顶选区（完整公式／段落）" : "置顶选区",
        disabled: !selected || selected.start === selected.end,
        run: () => {
          if (selected) pinBoard.addText(node.pieceId, node.id, titleOf(node.pieceId), editor.value, selected.start, selected.end);
        },
      },
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
          if (!sourceOn && selected) {
            editor.setSelectionRange(selected.start, selected.end);
            void hangFromEditor(node.id, editor, undefined);
          } else hangFromHere(undefined);
        },
      },
      {
        label: "Hang existing…",
        disabled: damaged,
        run: async () => {
          const start = selected?.start ?? editor.selectionStart;
          const end = selected?.end ?? editor.selectionEnd;
          const sideId = await promptExistingSide(node.pieceId, false);
          if (sideId) {
            editor.setSelectionRange(start, end);
            if (!sourceOn && selected) void hangFromEditor(node.id, editor, sideId);
            else hangFromHere(sideId);
          }
        },
      },
    ]);
  });
  rendered.addEventListener("click", (ev) => {
    if (!window.getSelection()?.isCollapsed) return;
    const mathematical = (ev.target as HTMLElement).closest<HTMLElement>("[data-math-rivets]");
    if (mathematical) {
      const ids = mathematical.dataset.mathRivets!.split(" ");
      const specs = state.views[node.pieceId]?.rivets.filter(r => ids.includes(r.id) && r.to) ?? [];
      if (specs.length === 1) void toggleSideColumn(node.id, specs[0].to!, specs[0].id);
      else if (specs.length > 1) showCtxMenu(ev, specs.map(spec => ({
        label: titleOf(spec.to!), run: () => { void toggleSideColumn(node.id, spec.to!, spec.id); },
      })));
      return;
    }
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
  outlineBtn.disabled = true;
  outlineBtn.setAttribute("aria-expanded", "false");
  let outline: OutlineView | null = null;
  const setOutlineOpen = (on: boolean): void => {
    if (!on && drawer.contains(document.activeElement)) outlineBtn.focus();
    drawer.hidden = !on;
    outlineBtn.classList.toggle("on", on);
    outlineBtn.setAttribute("aria-expanded", on ? "true" : "false");
    if (on) outline?.reveal();
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
    const pinnedSelection = pdfViews.get(node.id)?.getSelection();
    const hasSel = Boolean(pdfViews.get(node.id)?.getSelection()?.anchors.length);
    if (!hasSel) {
      setStatus("Drag a region on the PDF first.", true);
    }
    showCtxMenu(ev, [
      { label: "Ask Codex…", disabled: !hasSel,
        run: () => { if (pinnedSelection) void askCodex(node.id, { kind: "pdf", anchors: structuredClone(pinnedSelection.anchors) }); } },
      {
        label: "置顶选区",
        disabled: !pinnedSelection?.anchors.length,
        run: () => {
          if (pinnedSelection) pinBoard.addPdf(node.pieceId, node.id, titleOf(node.pieceId), structuredClone(pinnedSelection.anchors));
        },
      },
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
        outline?.setPage(page);
      },
    });
    pdfViews.get(node.id)?.destroy();
    pdfViews.set(node.id, handle);
    if (pendingPinAnchor?.pieceId === node.pieceId) {
      handle.gotoAnchor(pendingPinAnchor.anchor);
      pendingPinAnchor = null;
    }
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
      const foldKey = JSON.stringify([state.root, node.pieceId]);
      if (!outlineFolds.has(foldKey)) outlineFolds.set(foldKey, new Set());
      outline = mountOutlineView(drawer, items, {
        page: () => handle.currentPage(),
        goto: (page) => handle.gotoPage(page),
        expanded: outlineFolds.get(foldKey),
      });
      if (!drawer.hidden) outline.reveal();
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

  const pinKey = sidePinId(parent?.pieceId ?? "", node.viaRivetId ?? "");
  card.dataset.sidePinId = pinKey;
  const pin = document.createElement("button");
  pin.type = "button";
  pin.className = "side-pin";
  const paintPin = (surface: HTMLElement): void => {
    const pinned = state.sidePins.has(pinKey);
    surface.dataset.sidePinned = String(pinned);
    const button = surface.querySelector<HTMLButtonElement>(".side-pin") ?? pin;
    button.textContent = pinned ? "Unpin" : "Pin";
    button.setAttribute("aria-pressed", String(pinned));
    button.title = pinned ? "取消固定，恢复随来源显隐" : "固定侧注：来源滚出视口时仍保持显示";
  };
  paintPin(card);
  pin.addEventListener("click", () => {
    if (state.sidePins.has(pinKey)) state.sidePins.delete(pinKey);
    else state.sidePins.add(pinKey);
    const saved = saveSidePins(localStorage, state.root ?? "", state.sidePins);
    for (const surface of el.columns.querySelectorAll<HTMLElement>(".card")) {
      if (surface.dataset.sidePinId === pinKey) paintPin(surface);
    }
    scheduleChrome();
    setStatus(saved
      ? (state.sidePins.has(pinKey) ? "已固定侧注，来源滚出视口时仍保持显示。" : "已取消固定，恢复随来源显隐。")
      : "已在本次会话更新固定状态，但无法保存偏好；重启后可能不保留。", !saved);
  });

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
  let detaching = false;
  const cardMenu = (ev: MouseEvent): void => showCtxMenu(ev, [
    { label: "Rename", run: () => { void renamePiece(node.pieceId); } },
    {
      label: "Close",
      run: () => {
        state.nodes = closeNode(state.nodes, node.id);
        renderSidebar();
        renderColumns();
        setStatus("Closed this side and its subtree. Rivets stay on disk.");
      },
    },
    {
      label: "解除挂接",
      disabled: detaching,
      run: async () => {
        detaching = true;
        try { await detachNode(node); } finally { detaching = false; }
      },
    },
    { label: "删除笔记", danger: true, run: () => { void confirmDropSide(node.pieceId); } },
  ]);
  const more = document.createElement("button");
  more.type = "button";
  more.className = "card-more";
  more.textContent = "⋯";
  more.title = "Rename / Close / 解除挂接 / 删除笔记";
  more.setAttribute("aria-label", "更多操作");
  more.addEventListener("click", cardMenu);
  head.addEventListener("contextmenu", cardMenu);
  const aiButton = document.createElement('button'); aiButton.textContent = 'AI…';
  aiButton.onclick = ev => showCtxMenu(ev, [
    { label: '向这篇笔记提问…', run: () => askWholeNote(node.id, 'note') },
    { label: '改进这篇笔记…', run: () => askWholeNote(node.id, 'revise') },
  ]);
  aiButton.disabled = view?.medium !== 'text';
  head.append(titles, pin, aiButton, more);
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

  const stack = document.createElement("div");
  stack.className = "col-stack";
  stack.addEventListener("scroll", scheduleChrome);
  for (const node of cards) {
    stack.append(renderCard(node));
  }
  section.append(stack);
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
  const before = state.views[id]?.clean;
  const result = await saveSource(id, clean);
  if (!result.ok) {
    setStatus(result.error, true);
    return;
  }
  state.views[id] = result.piece;
  if (before !== undefined) pinBoard.sourceChanged(id, before, result.piece.clean);
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
  state.modes[result.rivetId] = sideId ? "rendered" : "source";
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

type AiOptions = { question: string; model: string; effort: string; web: boolean };
function askCodexQuestion(images: boolean, revise: boolean): Promise<AiOptions | null> {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog'); dialog.className = 'piece-picker';
    const form = document.createElement('form');
    const title = document.createElement('h2'); title.textContent = revise ? '改进这篇笔记' : 'Ask Codex';
    const input = document.createElement('textarea'); input.rows = 4; input.className = 'ai-question';
    input.placeholder = revise ? '想怎样改进？例如补充背景、纠错、重新组织，或写得更清楚。' : '你想了解什么？解释概念、比较观点、查背景，或者其他问题。'; input.setAttribute('aria-label', '向 Codex 提问');
    const model = document.createElement('select'); model.setAttribute('aria-label', '模型');
    const effort = document.createElement('select'); effort.setAttribute('aria-label', '推理强度');
    const webLabel = document.createElement('label'), web = document.createElement('input'); web.type = 'checkbox'; web.checked = localStorage.getItem('intro:ai:web') !== 'off'; webLabel.append(web, ' 允许联网查资料');
    const hint = document.createElement('p'); hint.className = 'muted'; hint.textContent = '正在读取账户支持的模型…';
    const send = document.createElement('button'); send.type = 'submit'; send.textContent = revise ? '生成修改稿' : '生成笔记'; send.disabled = true;
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = '取消'; cancel.onclick = () => dialog.close();
    const login = document.createElement('button'); login.type = 'button'; login.textContent = '连接 Codex'; login.hidden = true;
    login.onclick = async () => { const r = await window.intro.aiLogin(); hint.textContent = r.ok ? '请在浏览器完成登录，再关闭此窗口重新提问。' : r.error; };
    let answer: AiOptions | null = null;
    form.onsubmit = ev => {
      ev.preventDefault(); if (send.disabled) return;
      answer = { question: input.value.trim() || (revise ? '根据内容需要改进这篇笔记，使其准确、清楚且适合今后阅读。' : '帮助我理解选中的内容，整理成一篇有用的笔记。'), model: model.value, effort: effort.value, web: web.checked };
      localStorage.setItem('intro:ai:model', model.value); localStorage.setItem('intro:ai:effort', effort.value); localStorage.setItem('intro:ai:web', web.checked ? 'on' : 'off'); dialog.close();
    };
    dialog.onclose = () => { dialog.remove(); resolve(answer); };
    form.append(title, input, model, effort, webLabel, hint, send, cancel, login); dialog.append(form); document.body.append(dialog); dialog.showModal(); input.focus();
    void window.intro.aiModels().then(result => {
      if (!dialog.isConnected) return;
      if (!result.ok) { hint.textContent = result.error; login.hidden = false; return; }
      for (const m of result.models) { const option = document.createElement('option'); option.value = m.id; option.textContent = m.label + (images && !m.images ? '（不支持图片）' : ''); option.disabled = images && !m.images; model.append(option); }
      const available = result.models.filter(m => !images || m.images);
      const selected = available.find(m => m.id === localStorage.getItem('intro:ai:model')) ?? available.find(m => m.isDefault) ?? available[0];
      if (!selected) { hint.textContent = '没有适合本次输入的模型。'; return; }
      model.value = selected.id;
      const updateEffort = (): void => { const m = result.models.find(m => m.id === model.value)!; effort.replaceChildren(); for (const e of m.efforts) { const option = document.createElement('option'); option.value = e; option.textContent = e; effort.append(option); } const saved = localStorage.getItem('intro:ai:effort'); effort.value = saved && m.efforts.includes(saved) ? saved : m.defaultEffort; };
      model.onchange = updateEffort; updateEffort(); send.disabled = false;
      hint.textContent = revise ? '会发送当前笔记和来源上下文；修改稿先预览，再由你应用。' : '会发送选区、当前笔记和来源上下文；完成后自动保存为 side。';
    }).catch(error => { hint.textContent = String(error); login.hidden = false; });
  });
}

function aiPanel(title: string): { panel: HTMLElement; message: HTMLElement; body: HTMLElement; actions: HTMLElement } {
  const panel = document.createElement('aside'); panel.className = 'ai-pending'; panel.setAttribute('aria-label', 'Codex 临时 side');
  const heading = document.createElement('strong'); heading.textContent = title;
  const message = document.createElement('p'); message.setAttribute('role', 'status');
  const body = document.createElement('div'); body.className = 'ai-answer';
  const actions = document.createElement('div'); actions.className = 'ai-actions';
  panel.append(heading, message, body, actions); document.body.append(panel);
  return { panel, message, body, actions };
}

async function askCodex(parentId: string, selection: AiSelection, intent: 'note' | 'revise' = 'note'): Promise<void> {
  const root = state.root, parent = state.nodes.find(n => n.id === parentId);
  if (!root || !parent) return;
  const options = await askCodexQuestion(selection.kind === 'pdf', intent === 'revise'); if (options === null) return;
  if (state.root !== root) { setStatus('资料库已切换，请重新选择。', true); return; }
  const ui = aiPanel('Ask Codex'); ui.message.textContent = '正在准备选区和附近原文…';
  const cancel = document.createElement('button'); cancel.textContent = '取消'; ui.actions.append(cancel);
  let cancelled = false, jobId: string | undefined;
  cancel.onclick = () => { cancelled = true; if (jobId) void window.intro.aiCancel(jobId); ui.panel.remove(); };
  try {
    const request: AiStart = { root, hostId: parent.pieceId, selection, ...options, intent, contexts: [] };
    if (selection.kind === 'text') {
      const editor = surfaceOf(parentId)?.querySelector<HTMLTextAreaElement>('textarea.editor');
      if (editor && editor.value !== selection.expected) throw new Error('原文已变化，请重新选择。');
      const saved = await saveSource(parent.pieceId, selection.expected);
      if (!saved.ok) throw new Error(saved.error);
    } else {
      const snapshot = await capturePdfContext(parent.pieceId, async () => {
        if (state.root !== root) throw new Error('资料库已切换');
        const pdf = await window.intro.readPdf(parent.pieceId); if (!pdf.ok) throw new Error(pdf.error); return pdf.data;
      }, selection.anchors[0]!);
      request.contexts = snapshot.contexts.map(c => ({ ...c, label: `${titleOf(parent.pieceId)} · ${c.label}` }));
      request.selectionImage = snapshot.selectionImage;
    }
    if (cancelled) return;
    if (state.root !== root) throw new Error('资料库已切换');
    const started = await window.intro.aiStart(request); if (!started.ok) throw new Error(started.error);
    jobId = started.job.id;
    if (cancelled) { await window.intro.aiCancel(jobId); return; }
    let job = started.job;
    while (job.status === 'running' && !cancelled) {
      ui.message.textContent = job.progress;
      await new Promise(resolve => setTimeout(resolve, 750));
      const status = await window.intro.aiStatus(jobId); if (!status.ok) throw new Error(status.error); job = status.job;
    }
    if (cancelled) return;
    if (job.status !== 'ready' || !job.answer) throw new Error(job.error || job.progress);
    if (intent === 'revise') { ui.panel.remove(); showImprovement(job); return; }
    ui.body.innerHTML = renderHtml(job.answer.markdown, [], [], katexMath);
    const changed = selection.kind === 'text' && (
      state.views[parent.pieceId]?.clean !== selection.expected ||
      Array.from(el.columns.querySelectorAll<HTMLElement>('[data-piece-id]')).some(surface => surface.dataset.pieceId === parent.pieceId && surface.querySelector<HTMLTextAreaElement>('textarea.editor')?.value !== selection.expected)
    );
    if (state.root !== root || changed) throw new Error('来源已变化或资料库已切换。回答已保留，可从菜单 View → Codex 回答 查看并复制。');
    if (ui.body.querySelector('.katex-error')) ui.message.textContent = '个别公式暂以源码显示，笔记仍会保存，可在 Source 修正。';
    const saved = await window.intro.aiCommit(job.id); if (!saved.ok) throw new Error(saved.error);
    if (state.root !== root) { ui.message.textContent = '回答已保存到原资料库。'; return; }
    state.views[saved.host.id] = saved.host; state.views[saved.side.id] = saved.side;
    const listed = await window.intro.listPieces(); if (listed.ok) state.pieces = listed.pieces;
    const openParent = state.nodes.find(n => n.id === parentId && n.pieceId === parent.pieceId);
    if (openParent) {
      state.nodes = openSide(state.nodes, parentId, saved.side.id, saved.rivetId);
      state.modes[saved.rivetId] = 'rendered'; pendingAlign = saved.rivetId;
      state.sidePins.add(sidePinId(saved.host.id, saved.rivetId));
      saveSidePins(localStorage, state.root!, state.sidePins);
      renderColumns(); setHot(saved.rivetId);
    }
    renderSidebar(); ui.panel.remove(); setStatus('Codex 回答已保存为 side。');
  } catch (error) {
    if (cancelled) return;
    ui.message.textContent = error instanceof Error ? error.message : String(error);
    cancel.textContent = '关闭'; cancel.onclick = () => ui.panel.remove();
    const login = document.createElement('button'); login.textContent = '连接 Codex';
    login.onclick = async () => { const result = await window.intro.aiLogin(); ui.message.textContent = result.ok ? '请在浏览器完成登录，然后重新选择并提问。' : result.error; };
    ui.actions.append(login);
  }
}

async function showCodexDrafts(): Promise<void> {
  const listed = await window.intro.aiList();
  if (!listed.ok) { setStatus(listed.error, true); return; }
  const ui = aiPanel('Codex 回答草稿');
  ui.message.textContent = listed.jobs.length ? '回答可在这里编辑、保存草稿，再挂回原选区。' : '暂无待处理回答。选区后右键 Ask Codex。';
  const close = document.createElement('button'); close.textContent = '关闭'; close.onclick = () => ui.panel.remove();
  const login = document.createElement('button'); login.textContent = '连接 Codex';
  login.onclick = async () => { const r = await window.intro.aiLogin(); ui.message.textContent = r.ok ? '请在浏览器完成登录。' : r.error; };
  ui.actions.append(close, login);
  for (const job of listed.jobs) {
    const row = document.createElement('section');
    const title = document.createElement('p'); title.textContent = job.answer?.title || job.error || job.progress; row.append(title);
    if (!job.answer && job.rawAnswer) {
      const label = document.createElement('p'); label.textContent = '未通过校验的原始回答（仅供复制检查，未保存为 side）'; row.append(label);
      const raw = document.createElement('textarea'); raw.readOnly = true; raw.value = job.rawAnswer; raw.rows = 8; raw.className = 'ai-question'; row.append(raw);
    }
    if (job.answer) {
      const source = document.createElement('textarea'); source.readOnly = false; source.value = job.answer.markdown; source.rows = 8; source.className = 'ai-question';
      source.setAttribute('aria-label', '回答源码，可编辑并保存'); row.append(source);
      const saveDraft = document.createElement('button'); saveDraft.textContent = '保存草稿';
      const persistDraft = async (): Promise<boolean> => {
        const result = await window.intro.aiEdit(job.id, job.answer!.markdown, source.value);
        if (!result.ok) { title.textContent = result.error; return false; }
        job.answer = result.job.answer; source.value = job.answer!.markdown;
        title.textContent = '草稿已保存'; return true;
      };
      saveDraft.onclick = async () => { saveDraft.disabled = true; try { await persistDraft(); } finally { saveDraft.disabled = false; } };
      source.oninput = () => { title.textContent = '草稿有未保存修改，请保存草稿或挂回原选区'; };
      row.append(saveDraft);
      const attach = document.createElement('button'); attach.textContent = job.intent === 'revise' ? '预览修改稿' : '尝试挂回原选区';
      attach.onclick = async () => {
        if (!await persistDraft()) return;
        if (job.intent === 'revise') { showImprovement(job); return; }
        if (state.root !== job.root) { title.textContent = '请先打开原资料库。'; return; }
        const dirty = Array.from(el.columns.querySelectorAll<HTMLElement>('[data-piece-id]')).some(surface => surface.dataset.pieceId === job.hostId && !!surface.querySelector<HTMLTextAreaElement>('textarea.editor') && surface.querySelector<HTMLTextAreaElement>('textarea.editor')!.value !== state.views[job.hostId]?.clean);
        if (dirty) { title.textContent = '原文有未保存编辑，请先处理编辑后再挂接。'; return; }
        attach.disabled = true;
        const result = await window.intro.aiCommit(job.id);
        if (!result.ok) { title.textContent = result.error; attach.disabled = false; return; }
        if (state.root !== job.root) return;
        state.views[result.host.id] = result.host; state.views[result.side.id] = result.side;
        const pieces = await window.intro.listPieces(); if (pieces.ok) state.pieces = pieces.pieces;
        const parent = state.nodes.find(n => n.pieceId === job.hostId);
        if (parent) { state.nodes = openSide(state.nodes, parent.id, result.side.id, result.rivetId); state.modes[result.rivetId] = 'rendered'; pendingAlign = result.rivetId; }
        renderSidebar(); renderColumns(); title.textContent = '已挂回原选区';
      };
      row.append(attach);
    }
    if (job.status === 'running') {
      const stop = document.createElement('button'); stop.textContent = '取消生成'; stop.onclick = async () => { await window.intro.aiCancel(job.id); title.textContent = '已取消'; }; row.append(stop);
    }
    ui.body.append(row);
  }
}

window.intro.onAiRead(request => {
  void (async () => {
    try {
      if (state.root !== request.root) throw new Error('资料库已切换，停止读取原资料库。');
      const context = await readPdfContextPage(request.pieceId, async () => {
        if (state.root !== request.root) throw new Error('资料库已切换');
        const result = await window.intro.readPdf(request.pieceId); if (!result.ok) throw new Error(result.error); return result.data;
      }, request.page, request.textOnly);
      if (state.root !== request.root) throw new Error('资料库已切换');
      context.label = `${titleOf(request.pieceId)} · ${context.label}`;
      await window.intro.aiProvideContext(request.id, { context });
    } catch (error) { await window.intro.aiProvideContext(request.id, { error: String(error) }); }
  })();
});

function askWholeNote(nodeId: string, intent: 'note' | 'revise'): void {
  const node = state.nodes.find(n => n.id === nodeId); if (!node) return;
  const clean = surfaceOf(nodeId)?.querySelector<HTMLTextAreaElement>('textarea.editor')?.value ?? state.views[node.pieceId]?.clean ?? '';
  if (!clean.trim()) { setStatus('请先写下笔记内容。', true); return; }
  void askCodex(nodeId, { kind: 'text', expected: clean, start: 0, end: clean.length }, intent);
}

function showImprovement(job: AiJobView): void {
  if (!job.answer) return;
  const ui = aiPanel('改进笔记 · 预览'); ui.panel.classList.add('ai-review');
  const comparison = document.createElement('div'); comparison.className = 'ai-comparison';
  for (const [label, text] of [['原文', job.original ?? ''], ['修改稿', job.answer.markdown]]) {
    const section = document.createElement('section'), heading = document.createElement('h3'); heading.textContent = label!;
    const body = document.createElement('div'); body.innerHTML = renderHtml(text!, [], [], katexMath); section.append(heading, body); comparison.append(section);
  }
  ui.body.append(comparison); ui.message.textContent = '确认内容后应用。已有子 side 的来源无法可靠保留时，会拒绝覆盖。';
  const apply = document.createElement('button'); apply.textContent = '应用修改';
  const undo = document.createElement('button'); undo.textContent = '撤销此次改进'; undo.hidden = true;
  const close = document.createElement('button'); close.textContent = '保留草稿，关闭'; close.onclick = () => ui.panel.remove();
  const write = async (revert: boolean): Promise<void> => {
    if (state.root !== job.root) { ui.message.textContent = '请先返回原资料库。'; return; }
    const surfaces = Array.from(el.columns.querySelectorAll<HTMLElement>('[data-piece-id]')).filter(s => s.dataset.pieceId === job.hostId);
    if (surfaces.some(s => { const e = s.querySelector<HTMLTextAreaElement>('textarea.editor'); return e && e.value !== state.views[job.hostId]?.clean; })) { ui.message.textContent = '笔记有未保存编辑，请先处理编辑。'; return; }
    if (!revert && comparison.querySelector('.katex-error')) { ui.message.textContent = '有公式无法渲染，请从草稿复制源码检查。'; return; }
    apply.disabled = undo.disabled = true;
    try {
      const result = await window.intro.aiApply(job.id, revert); if (!result.ok) throw new Error(result.error);
      if (state.root !== job.root) return;
      const before = state.views[job.hostId]?.clean ?? result.piece.clean;
      const timer = persistTimers.get(job.hostId); if (timer) clearTimeout(timer); persistTimers.delete(job.hostId);
      inputHistory.delete(JSON.stringify([state.root, job.hostId]));
      for (const surface of surfaces) { const editor = surface.querySelector<HTMLTextAreaElement>('textarea.editor'); if (editor) editor.value = result.piece.clean; }
      state.views[job.hostId] = result.piece; pinBoard.sourceChanged(job.hostId, before, result.piece.clean);
      renderColumns(); renderSidebar();
      ui.message.textContent = revert ? '已撤销，恢复原笔记。' : '已应用，标题、笔记 ID 和已有关系保留。';
      apply.hidden = !revert; undo.hidden = revert; close.textContent = '关闭';
    } catch (error) { ui.message.textContent = String(error); }
    finally { apply.disabled = undo.disabled = false; }
  };
  apply.onclick = () => { void write(false); }; undo.onclick = () => { void write(true); };
  ui.actions.append(apply, undo, close);
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
  const saved = await saveSource(host.pieceId, editor.value);
  if (!saved.ok) { setStatus(saved.error, true); return; }
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
  state.modes[result.rivetId] = sideId ? "rendered" : "source";
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
  state.modes[state.nodes[0]!.id] = "rendered";
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

async function openLibraryCommand(): Promise<void> {
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
}

function requireOpenLibrary(): boolean {
  if (state.root) return true;
  setStatus("先用 File → Open library 打开一个库。", true);
  return false;
}

async function openPdfCommand(): Promise<void> {
  if (!requireOpenLibrary()) return;
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
}

async function newPieceCommand(): Promise<void> {
  if (!requireOpenLibrary()) return;
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
  state.modes[state.nodes[0]!.id] = "source";
  renderSidebar();
  renderColumns();
  const editor = el.columns.querySelector("textarea.editor") as HTMLTextAreaElement | null;
  editor?.focus();
  setStatus(`Created ${result.piece.title}`);
}

window.intro.onMenuCommand((command) => {
  if (command === "open-library") void openLibraryCommand();
  else if (command === "new-piece") void newPieceCommand();
  else if (command === "open-pdf") void openPdfCommand();
  else if (command === "toggle-pieces") applySidebarHidden(!chromeLayout.sidebarHidden);
  else if (command === "codex-answers") void showCodexDrafts();
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
void document.fonts.ready.then(scheduleChrome);

bindVSplitter(el.splitSidebar, {
  getWidth: () => el.sidebar.getBoundingClientRect().width,
  setWidth: applySidebarWidth,
  clamp: clampSidebarWidth,
});
el.hidePieces.addEventListener("click", () => {
  applySidebarHidden(true);
});
el.sidebar.addEventListener("contextmenu", (ev) => {
  showCtxMenu(ev, [
    { label: "New piece", disabled: !state.root, run: () => { void newPieceCommand(); } },
    { label: "隐藏 Pieces", run: () => applySidebarHidden(true) },
  ]);
});
applySidebarWidth(chromeLayout.sidebarWidth);
applySidebarHidden(chromeLayout.sidebarHidden);

renderSidebar();
renderColumns();
