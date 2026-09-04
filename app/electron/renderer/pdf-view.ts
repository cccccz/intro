/** Shapes match `app/pdf/overlay.ts`. Duplicated: renderer build cannot import that tree. */

import { clampPage, clampZoom, readingOffset, readingScrollTop, ZOOM_FIT } from "./pdf-nav.ts";
import {
  PDF_OVERSCAN_PAGES,
  PDF_RESIZE_DEBOUNCE_MS,
  currentPageFromScroll,
  pageInRange,
  rasterWindowFromScroll,
  samePageRange,
  type PageRange,
} from "./pdf-window.ts";

export type PdfUserRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PdfAnchor = {
  page: number;
  rect: PdfUserRect;
};

export type OverlayRivet = {
  id: string;
  to: string | null;
  anchors: PdfAnchor[];
  quote?: string;
};

type PdfViewport = {
  width: number;
  height: number;
  convertToViewportPoint: (x: number, y: number) => [number, number];
  convertToPdfPoint: (x: number, y: number) => [number, number];
};

type PdfPage = {
  getViewport: (opts: { scale: number }) => PdfViewport;
  render: (opts: {
    canvasContext: CanvasRenderingContext2D;
    viewport: PdfViewport;
  }) => { promise: Promise<void>; cancel: () => void };
};

type PdfOutlineNode = {
  title?: string;
  dest?: unknown;
  items?: PdfOutlineNode[];
};

type PdfDocument = {
  numPages: number;
  getPage: (n: number) => Promise<PdfPage>;
  getOutline?: () => Promise<PdfOutlineNode[] | null>;
  getDestination?: (id: string) => Promise<unknown>;
  getPageIndex?: (ref: unknown) => Promise<number>;
};

export type PdfOutlineEntry = {
  title: string;
  page: number | null;
  children: PdfOutlineEntry[];
};

type PdfJsModule = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (src: { data: ArrayBuffer | Uint8Array }) => { promise: Promise<PdfDocument> };
};

export type PdfSelection = {
  anchors: PdfAnchor[];
};

export type PdfViewHandle = {
  destroy: () => void;
  getSelection: () => PdfSelection | null;
  clearSelection: () => void;
  setRivets: (rivets: readonly OverlayRivet[], openIds: readonly string[]) => void;
  getZoom: () => number;
  setZoom: (zoom: number) => Promise<void>;
  gotoPage: (page: number) => void;
  numPages: () => number;
  currentPage: () => number;
  getScroll: () => { top: number; left: number };
  setScroll: (top: number, left: number) => void;
  getOutline: () => Promise<PdfOutlineEntry[]>;
};

const docCache = new Map<string, Promise<PdfDocument>>();
let pdfjsReady: Promise<PdfJsModule> | null = null;

function loadPdfJs(): Promise<PdfJsModule> {
  if (!pdfjsReady) {
    pdfjsReady = (async () => {
      const href = new URL("./vendor/pdf.min.mjs", import.meta.url).href;
      const worker = new URL("./vendor/pdf.worker.min.mjs", import.meta.url).href;
      const mod = (await import(href)) as PdfJsModule;
      mod.GlobalWorkerOptions.workerSrc = worker;
      return mod;
    })();
  }
  return pdfjsReady;
}

function asBinary(data: ArrayBuffer | Uint8Array): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

export function forgetPdfDoc(id: string): void {
  docCache.delete(id);
}

export function forgetAllPdfDocs(): void {
  docCache.clear();
}

function loadDocument(id: string, data: ArrayBuffer | Uint8Array): Promise<PdfDocument> {
  const existing = docCache.get(id);
  if (existing) {
    return existing;
  }
  const task = loadPdfJs().then((pdfjs) => pdfjs.getDocument({ data: asBinary(data) }).promise);
  docCache.set(id, task);
  task.catch(() => {
    if (docCache.get(id) === task) {
      docCache.delete(id);
    }
  });
  return task;
}

function pageRelativeBox(
  viewport: PdfViewport,
  rect: PdfUserRect,
): { left: number; top: number; width: number; height: number } {
  const [x1, y1] = viewport.convertToViewportPoint(rect.x, rect.y + rect.height);
  const [x2, y2] = viewport.convertToViewportPoint(rect.x + rect.width, rect.y);
  const left = Math.min(x1, x2);
  const top = Math.min(y1, y2);
  const width = Math.abs(x2 - x1);
  const height = Math.abs(y2 - y1);
  return {
    left: (left / viewport.width) * 100,
    top: (top / viewport.height) * 100,
    width: (width / viewport.width) * 100,
    height: (height / viewport.height) * 100,
  };
}

function paintOverlays(
  pageEl: HTMLElement,
  page: number,
  viewport: PdfViewport,
  rivets: readonly OverlayRivet[],
  openIds: readonly string[],
  hooks: {
    onRivetEnter?: (id: string) => void;
    onRivetLeave?: () => void;
    onRivetClick?: (id: string) => void;
  },
): void {
  const layer = pageEl.querySelector(".pdf-overlay") as HTMLElement | null;
  if (!layer) {
    return;
  }
  const keepDraft = layer.querySelector(".pdf-draft");
  layer.replaceChildren();
  for (const rivet of rivets) {
    for (const anchor of rivet.anchors) {
      if (anchor.page !== page) {
        continue;
      }
      const box = pageRelativeBox(viewport, anchor.rect);
      const mark = document.createElement("div");
      mark.className = "pdf-hl";
      mark.dataset.rivet = rivet.id;
      if (openIds.includes(rivet.id)) {
        mark.classList.add("open");
      }
      mark.style.left = `${box.left}%`;
      mark.style.top = `${box.top}%`;
      mark.style.width = `${box.width}%`;
      mark.style.height = `${box.height}%`;
      mark.addEventListener("pointerenter", () => hooks.onRivetEnter?.(rivet.id));
      mark.addEventListener("pointerleave", () => hooks.onRivetLeave?.());
      mark.addEventListener("click", (ev) => {
        ev.stopPropagation();
        hooks.onRivetClick?.(rivet.id);
      });
      layer.append(mark);
    }
  }
  if (keepDraft) {
    layer.append(keepDraft);
  }
}

function isRenderCancel(err: unknown): boolean {
  if (!err || typeof err !== "object" || !("name" in err)) {
    return false;
  }
  const name = String((err as { name: unknown }).name);
  return name === "RenderingCancelledException" || name === "AbortException";
}

type PageSlot = {
  el: HTMLElement;
  viewport: PdfViewport;
  page: number;
  canvas: HTMLCanvasElement | null;
  renderGen: number;
  renderTask: { cancel: () => void; promise: Promise<void> } | null;
};

function clientToPdfRect(
  pageEl: HTMLElement,
  viewport: PdfViewport,
  a: { x: number; y: number },
  b: { x: number; y: number },
): PdfUserRect | null {
  const box = pageEl.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) {
    return null;
  }
  const toPdf = (clientX: number, clientY: number): [number, number] => {
    const vx = ((clientX - box.left) / box.width) * viewport.width;
    const vy = ((clientY - box.top) / box.height) * viewport.height;
    return viewport.convertToPdfPoint(vx, vy);
  };
  const [x1, y1] = toPdf(a.x, a.y);
  const [x2, y2] = toPdf(b.x, b.y);
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  const width = Math.abs(x2 - x1);
  const height = Math.abs(y2 - y1);
  if (width < 2 || height < 2) {
    return null;
  }
  return { x, y, width, height };
}

async function destToPage(doc: PdfDocument, dest: unknown): Promise<number | null> {
  try {
    let explicit = dest;
    if (typeof dest === "string") {
      explicit = (await doc.getDestination?.(dest)) ?? null;
    }
    if (!Array.isArray(explicit) || explicit[0] == null) {
      return null;
    }
    const index = await doc.getPageIndex?.(explicit[0]);
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0) {
      return null;
    }
    return index + 1;
  } catch {
    return null;
  }
}

async function resolveOutline(
  doc: PdfDocument,
  items: PdfOutlineNode[] | null | undefined,
): Promise<PdfOutlineEntry[]> {
  if (!items?.length) {
    return [];
  }
  const out: PdfOutlineEntry[] = [];
  for (const item of items) {
    out.push({
      title: String(item.title ?? "").trim() || "(untitled)",
      page: item.dest != null ? await destToPage(doc, item.dest) : null,
      children: await resolveOutline(doc, item.items),
    });
  }
  return out;
}

export async function mountPdfView(opts: {
  root: HTMLElement;
  pieceId: string;
  data: ArrayBuffer | Uint8Array;
  rivets: readonly OverlayRivet[];
  openIds: readonly string[];
  onChrome: () => void;
  onRivetEnter?: (id: string) => void;
  onRivetLeave?: () => void;
  onRivetClick?: (id: string) => void;
  onPageChange?: (page: number, numPages: number) => void;
}): Promise<PdfViewHandle> {
  const root = opts.root;
  root.replaceChildren();
  const doc = await loadDocument(opts.pieceId, opts.data);
  let rivets = opts.rivets;
  let openIds = opts.openIds;
  let selection: PdfSelection | null = null;
  let dead = false;
  let zoom = ZOOM_FIT;
  let outlineCache: PdfOutlineEntry[] | null = null;
  const pages: PageSlot[] = [];
  const intersecting = new Set<number>();
  let applied: PageRange = { from: 1, to: 0 };
  let applyGen = 0;
  let layoutGen = 0;
  let syncRaf = 0;
  let resizeTimer = 0;

  const scaleFor = async (pageNo: number): Promise<number> => {
    const page = await doc.getPage(pageNo);
    const base = page.getViewport({ scale: 1 });
    const width = Math.max(240, root.clientWidth - 16);
    return (width / base.width) * zoom;
  };

  const readCurrentPage = (): number => {
    // Observer entries may still describe the layout before resize/scroll.
    return currentPageFromScroll(
      pages.map((p) => p.el.offsetTop),
      pages.map((p) => p.el.offsetHeight),
      root.scrollTop,
      root.clientHeight,
    );
  };

  const emitPage = (): void => {
    if (!dead) {
      opts.onPageChange?.(readCurrentPage(), doc.numPages);
    }
  };

  const measureViewports = async (scale: number): Promise<PdfViewport[]> => {
    const viewports: PdfViewport[] = [];
    const chunk = 16;
    for (let start = 1; start <= doc.numPages; start += chunk) {
      if (dead) {
        return viewports;
      }
      const end = Math.min(doc.numPages, start + chunk - 1);
      const batch = await Promise.all(
        Array.from({ length: end - start + 1 }, (_, i) => doc.getPage(start + i)),
      );
      for (const page of batch) {
        viewports.push(page.getViewport({ scale }));
      }
    }
    return viewports;
  };

  let draw: { page: number; start: { x: number; y: number } } | null = null;

  const paintDraft = (): void => {
    for (const slot of pages) {
      const layer = slot.el.querySelector(".pdf-overlay");
      layer?.querySelectorAll(".pdf-draft").forEach((node) => node.remove());
    }
    if (!selection) {
      return;
    }
    for (const anchor of selection.anchors) {
      const slot = pages.find((p) => p.page === anchor.page);
      if (!slot?.canvas) {
        continue;
      }
      const box = pageRelativeBox(slot.viewport, anchor.rect);
      const draft = document.createElement("div");
      draft.className = "pdf-draft";
      draft.style.left = `${box.left}%`;
      draft.style.top = `${box.top}%`;
      draft.style.width = `${box.width}%`;
      draft.style.height = `${box.height}%`;
      slot.el.querySelector(".pdf-overlay")?.append(draft);
    }
  };

  const bindDrawPage = (slot: PageSlot): void => {
    const overlay = slot.el.querySelector(".pdf-overlay") as HTMLElement | null;
    if (!overlay) {
      return;
    }
    overlay.onpointerdown = (ev) => {
      if (ev.button !== 0) {
        return;
      }
      const target = ev.target as HTMLElement;
      if (target.closest(".pdf-hl")) {
        return;
      }
      draw = { page: slot.page, start: { x: ev.clientX, y: ev.clientY } };
      overlay.setPointerCapture(ev.pointerId);
      ev.preventDefault();
    };
    overlay.onpointermove = (ev) => {
      if (!draw || draw.page !== slot.page) {
        return;
      }
      const rect = clientToPdfRect(slot.el, slot.viewport, draw.start, {
        x: ev.clientX,
        y: ev.clientY,
      });
      selection = rect ? { anchors: [{ page: slot.page, rect }] } : null;
      paintDraft();
    };
    overlay.onpointerup = (ev) => {
      if (!draw || draw.page !== slot.page) {
        return;
      }
      const rect = clientToPdfRect(slot.el, slot.viewport, draw.start, {
        x: ev.clientX,
        y: ev.clientY,
      });
      selection = rect ? { anchors: [{ page: slot.page, rect }] } : null;
      draw = null;
      paintDraft();
      opts.onChrome();
    };
  };

  const unmountCanvas = (slot: PageSlot): void => {
    slot.renderGen += 1;
    try {
      slot.renderTask?.cancel();
    } catch {
      /* pdf.js may throw if the task already finished */
    }
    slot.renderTask = null;
    slot.canvas = null;
    slot.el.replaceChildren();
    delete slot.el.dataset.raster;
  };

  const mountCanvas = async (slot: PageSlot): Promise<void> => {
    if (dead || slot.canvas) {
      return;
    }
    const gen = ++slot.renderGen;
    const pdfPage = await doc.getPage(slot.page);
    if (dead || gen !== slot.renderGen) {
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(slot.viewport.width);
    canvas.height = Math.floor(slot.viewport.height);
    const overlay = document.createElement("div");
    overlay.className = "pdf-overlay";
    slot.el.append(canvas, overlay);
    slot.el.dataset.raster = "1";
    slot.canvas = canvas;
    bindDrawPage(slot);
    paintOverlays(slot.el, slot.page, slot.viewport, rivets, openIds, opts);
    paintDraft();
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      opts.onChrome();
      return;
    }
    const task = pdfPage.render({ canvasContext: ctx, viewport: slot.viewport });
    slot.renderTask = task;
    try {
      await task.promise;
    } catch (err) {
      if (isRenderCancel(err)) {
        return;
      }
      console.warn(`pdf page ${slot.page} render failed`, err);
    } finally {
      if (slot.renderTask === task) {
        slot.renderTask = null;
      }
    }
    if (dead || gen !== slot.renderGen) {
      return;
    }
    opts.onChrome();
  };

  const wantedRange = (): PageRange => {
    return rasterWindowFromScroll(
      pages.map((p) => p.el.offsetTop),
      pages.map((p) => p.el.offsetHeight),
      root.scrollTop,
      root.clientHeight,
      PDF_OVERSCAN_PAGES,
    );
  };

  const applyWindow = async (range: PageRange): Promise<void> => {
    if (dead) {
      return;
    }
    const already =
      samePageRange(range, applied) &&
      pages.every((slot) => pageInRange(slot.page, range) === Boolean(slot.canvas));
    if (already) {
      return;
    }
    applied = range;
    root.dataset.rasterFrom = String(range.from);
    root.dataset.rasterTo = String(range.to);
    const gen = ++applyGen;
    for (const slot of pages) {
      if (!pageInRange(slot.page, range) && slot.canvas) {
        unmountCanvas(slot);
      }
    }
    await Promise.all(
      pages.filter((slot) => pageInRange(slot.page, range) && !slot.canvas).map((slot) => mountCanvas(slot)),
    );
    if (dead || gen !== applyGen) {
      return;
    }
    emitPage();
    opts.onChrome();
  };

  const syncWindow = (): void => {
    void applyWindow(wantedRange());
  };

  const scheduleSync = (): void => {
    if (syncRaf) {
      return;
    }
    syncRaf = requestAnimationFrame(() => {
      syncRaf = 0;
      if (!dead) {
        syncWindow();
        emitPage();
      }
    });
  };

  const gotoPage = (page: number): void => {
    if (dead || pages.length === 0) {
      return;
    }
    const n = clampPage(page, doc.numPages);
    const slot = pages[n - 1];
    if (!slot) {
      return;
    }
    slot.el.scrollIntoView({ block: "start" });
    intersecting.clear();
    intersecting.add(n);
    syncWindow();
    emitPage();
  };

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const n = Number((entry.target as HTMLElement).dataset.page);
        if (!Number.isInteger(n) || n < 1) {
          continue;
        }
        if (entry.isIntersecting) {
          intersecting.add(n);
        } else {
          intersecting.delete(n);
        }
      }
      scheduleSync();
    },
    { root, threshold: 0 },
  );

  const sizePage = (slot: PageSlot, viewport: PdfViewport): void => {
    slot.viewport = viewport;
    slot.el.style.width = `${viewport.width}px`;
    slot.el.style.height = `${viewport.height}px`;
  };

  const appendPlaceholder = (n: number, viewport: PdfViewport): void => {
    const pageEl = document.createElement("div");
    pageEl.className = "pdf-page";
    pageEl.dataset.page = String(n);
    pageEl.style.width = `${viewport.width}px`;
    pageEl.style.height = `${viewport.height}px`;
    root.append(pageEl);
    pages.push({
      el: pageEl,
      viewport,
      page: n,
      canvas: null,
      renderGen: 0,
      renderTask: null,
    });
    io.observe(pageEl);
  };

  const layoutPlaceholders = async (): Promise<void> => {
    if (dead) {
      return;
    }
    const gen = ++layoutGen;
    const scale = await scaleFor(1);
    if (dead || gen !== layoutGen) {
      return;
    }
    if (pages.length === 0) {
      const chunk = 16;
      for (let start = 1; start <= doc.numPages; start += chunk) {
        if (dead || gen !== layoutGen) {
          return;
        }
        const end = Math.min(doc.numPages, start + chunk - 1);
        const batch = await Promise.all(
          Array.from({ length: end - start + 1 }, (_, i) => doc.getPage(start + i)),
        );
        if (dead || gen !== layoutGen) {
          return;
        }
        for (let i = 0; i < batch.length; i++) {
          appendPlaceholder(start + i, batch[i]!.getViewport({ scale }));
        }
        if (start === 1) {
          syncWindow();
        }
      }
      syncWindow();
      return;
    }
    const viewports = await measureViewports(scale);
    if (dead || gen !== layoutGen) {
      return;
    }
    // Capture after async measurement, immediately before changing geometry:
    // scrolling or a page jump while measuring must remain authoritative.
    const anchorSlot = pages[readCurrentPage() - 1]!;
    const anchor = readingOffset(anchorSlot.el.offsetTop, anchorSlot.el.offsetHeight, root.scrollTop);
    const scrollLeft = root.scrollLeft;
    for (const slot of pages) {
      const viewport = viewports[slot.page - 1];
      if (!viewport) {
        continue;
      }
      sizePage(slot, viewport);
      if (slot.canvas) {
        unmountCanvas(slot);
      }
    }
    applied = { from: 1, to: 0 };
    root.scrollTop = readingScrollTop(anchorSlot.el.offsetTop, anchorSlot.el.offsetHeight, anchor);
    root.scrollLeft = scrollLeft;
    intersecting.clear();
    syncWindow();
    emitPage();
    opts.onChrome();
  };

  await layoutPlaceholders();

  let lastWidth = root.clientWidth;
  const ro = new ResizeObserver(() => {
    const width = root.clientWidth;
    if (width === lastWidth) {
      return;
    }
    lastWidth = width;
    // Invalidate in-flight measurements immediately, including the debounce interval.
    layoutGen += 1;
    if (resizeTimer) {
      window.clearTimeout(resizeTimer);
    }
    resizeTimer = window.setTimeout(() => {
      resizeTimer = 0;
      void layoutPlaceholders();
    }, PDF_RESIZE_DEBOUNCE_MS);
  });
  ro.observe(root);
  root.addEventListener("scroll", scheduleSync, { passive: true });

  return {
    destroy: () => {
      dead = true;
      if (syncRaf) {
        cancelAnimationFrame(syncRaf);
        syncRaf = 0;
      }
      if (resizeTimer) {
        window.clearTimeout(resizeTimer);
        resizeTimer = 0;
      }
      io.disconnect();
      ro.disconnect();
      root.removeEventListener("scroll", scheduleSync);
      for (const slot of pages) {
        unmountCanvas(slot);
      }
      root.replaceChildren();
    },
    getSelection: () => selection,
    clearSelection: () => {
      selection = null;
      paintDraft();
    },
    setRivets: (next, nextOpen) => {
      rivets = next;
      openIds = nextOpen;
      for (const slot of pages) {
        if (slot.canvas) {
          paintOverlays(slot.el, slot.page, slot.viewport, rivets, openIds, opts);
        }
      }
      paintDraft();
      opts.onChrome();
    },
    getZoom: () => zoom,
    setZoom: async (next) => {
      const z = clampZoom(next);
      if (z === zoom && pages.length > 0) {
        return;
      }
      zoom = z;
      await layoutPlaceholders();
    },
    gotoPage,
    numPages: () => doc.numPages,
    currentPage: readCurrentPage,
    getScroll: () => ({ top: root.scrollTop, left: root.scrollLeft }),
    setScroll: (top, left) => {
      root.scrollTop = top;
      root.scrollLeft = left;
      syncWindow();
      emitPage();
    },
    getOutline: async () => {
      if (outlineCache) {
        return outlineCache;
      }
      try {
        const raw = (await doc.getOutline?.()) ?? [];
        outlineCache = await resolveOutline(doc, raw);
      } catch {
        outlineCache = [];
      }
      return outlineCache;
    },
  };
}
