/** Shapes match `app/pdf/overlay.ts`. Duplicated: renderer build cannot import that tree. */

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
  }) => { promise: Promise<void> };
};

type PdfDocument = {
  numPages: number;
  getPage: (n: number) => Promise<PdfPage>;
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
}): Promise<PdfViewHandle> {
  const root = opts.root;
  root.replaceChildren();
  const doc = await loadDocument(opts.pieceId, opts.data);
  let rivets = opts.rivets;
  let openIds = opts.openIds;
  let selection: PdfSelection | null = null;
  let dead = false;
  const pages: { el: HTMLElement; viewport: PdfViewport; page: number }[] = [];

  const scaleFor = async (pageNo: number): Promise<number> => {
    const page = await doc.getPage(pageNo);
    const base = page.getViewport({ scale: 1 });
    const width = Math.max(240, root.clientWidth - 16);
    return width / base.width;
  };

  const renderPages = async (): Promise<void> => {
    if (dead) {
      return;
    }
    const scale = await scaleFor(1);
    root.replaceChildren();
    pages.length = 0;
    for (let n = 1; n <= doc.numPages; n++) {
      if (dead) {
        return;
      }
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale });
      const pageEl = document.createElement("div");
      pageEl.className = "pdf-page";
      pageEl.dataset.page = String(n);
      pageEl.style.width = `${viewport.width}px`;
      pageEl.style.height = `${viewport.height}px`;
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const overlay = document.createElement("div");
      overlay.className = "pdf-overlay";
      pageEl.append(canvas, overlay);
      root.append(pageEl);
      const ctx = canvas.getContext("2d");
      if (ctx) {
        await page.render({ canvasContext: ctx, viewport }).promise;
      }
      pages.push({ el: pageEl, viewport, page: n });
      paintOverlays(pageEl, n, viewport, rivets, openIds, opts);
    }
    bindDraw();
    paintDraft();
    opts.onChrome();
  };

  let draw: { page: number; start: { x: number; y: number } } | null = null;

  const paintDraft = (): void => {
    for (const page of pages) {
      const layer = page.el.querySelector(".pdf-overlay");
      layer?.querySelectorAll(".pdf-draft").forEach((node) => node.remove());
    }
    if (!selection) {
      return;
    }
    for (const anchor of selection.anchors) {
      const page = pages.find((p) => p.page === anchor.page);
      if (!page) {
        continue;
      }
      const box = pageRelativeBox(page.viewport, anchor.rect);
      const draft = document.createElement("div");
      draft.className = "pdf-draft";
      draft.style.left = `${box.left}%`;
      draft.style.top = `${box.top}%`;
      draft.style.width = `${box.width}%`;
      draft.style.height = `${box.height}%`;
      page.el.querySelector(".pdf-overlay")?.append(draft);
    }
  };

  const bindDraw = (): void => {
    for (const page of pages) {
      const overlay = page.el.querySelector(".pdf-overlay") as HTMLElement | null;
      if (!overlay) {
        continue;
      }
      overlay.onpointerdown = (ev) => {
        if (ev.button !== 0) {
          return;
        }
        const target = ev.target as HTMLElement;
        if (target.closest(".pdf-hl")) {
          return;
        }
        draw = { page: page.page, start: { x: ev.clientX, y: ev.clientY } };
        overlay.setPointerCapture(ev.pointerId);
        ev.preventDefault();
      };
      overlay.onpointermove = (ev) => {
        if (!draw || draw.page !== page.page) {
          return;
        }
        const rect = clientToPdfRect(page.el, page.viewport, draw.start, {
          x: ev.clientX,
          y: ev.clientY,
        });
        selection = rect ? { anchors: [{ page: page.page, rect }] } : null;
        paintDraft();
      };
      overlay.onpointerup = (ev) => {
        if (!draw || draw.page !== page.page) {
          return;
        }
        const rect = clientToPdfRect(page.el, page.viewport, draw.start, {
          x: ev.clientX,
          y: ev.clientY,
        });
        selection = rect ? { anchors: [{ page: page.page, rect }] } : null;
        draw = null;
        paintDraft();
        opts.onChrome();
      };
    }
  };

  await renderPages();

  let lastWidth = root.clientWidth;
  const ro = new ResizeObserver(() => {
    const width = root.clientWidth;
    if (Math.abs(width - lastWidth) < 8) {
      return;
    }
    lastWidth = width;
    void renderPages();
  });
  ro.observe(root);

  return {
    destroy: () => {
      dead = true;
      ro.disconnect();
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
      for (const page of pages) {
        paintOverlays(page.el, page.page, page.viewport, rivets, openIds, opts);
      }
      paintDraft();
      opts.onChrome();
    },
  };
}
