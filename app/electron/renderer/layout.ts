/** Session chrome: sidebar + column widths. Personal-use, localStorage OK. */

export const LAYOUT_STORAGE_KEY = "intro:chrome-layout:v1";

export const SIDEBAR_MIN = 140;
export const SIDEBAR_MAX = 480;
export const SIDEBAR_DEFAULT = 200;

export const COLUMN_MIN = 240;
export const COLUMN_MAX = 2800;
export const COLUMN_DEFAULT = 360;
export const COLUMN_PDF_DEFAULT = 720;

export type ChromeLayout = {
  sidebarWidth: number;
  columnWidths: Record<string, number>;
};

export type ColumnSize = {
  flex: string;
  width: string;
};

export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) {
    return SIDEBAR_DEFAULT;
  }
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(width)));
}

export function clampColumnWidth(width: number): number {
  if (!Number.isFinite(width)) {
    return COLUMN_DEFAULT;
  }
  return Math.min(COLUMN_MAX, Math.max(COLUMN_MIN, Math.round(width)));
}

export function defaultColumnWidth(depth: number, pdfHost: boolean): number {
  if (pdfHost && depth === 0) {
    return COLUMN_PDF_DEFAULT;
  }
  return COLUMN_DEFAULT;
}

/**
 * Columns stay a fixed px width unless the user drags a splitter.
 * Stored widths win; otherwise PDF host defaults to COLUMN_PDF_DEFAULT, sides to COLUMN_DEFAULT.
 */
export function columnSize(
  stored: number | undefined,
  depth: number,
  pdfHost: boolean,
): ColumnSize {
  const width = stored ?? defaultColumnWidth(depth, pdfHost);
  return { flex: `0 0 ${width}px`, width: `${width}px` };
}

export function emptyLayout(): ChromeLayout {
  return { sidebarWidth: SIDEBAR_DEFAULT, columnWidths: {} };
}

export function parseChromeLayout(raw: unknown): ChromeLayout {
  const fallback = emptyLayout();
  if (!raw || typeof raw !== "object") {
    return fallback;
  }
  const obj = raw as Record<string, unknown>;
  const widths: Record<string, number> = {};
  if (obj.columnWidths && typeof obj.columnWidths === "object") {
    for (const [key, value] of Object.entries(obj.columnWidths as Record<string, unknown>)) {
      if (typeof value === "number") {
        widths[key] = clampColumnWidth(value);
      }
    }
  }
  return {
    sidebarWidth: clampSidebarWidth(typeof obj.sidebarWidth === "number" ? obj.sidebarWidth : SIDEBAR_DEFAULT),
    columnWidths: widths,
  };
}

export function loadChromeLayout(storage: Pick<Storage, "getItem">): ChromeLayout {
  try {
    const raw = storage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) {
      return emptyLayout();
    }
    return parseChromeLayout(JSON.parse(raw) as unknown);
  } catch {
    return emptyLayout();
  }
}

export function saveChromeLayout(storage: Pick<Storage, "setItem">, layout: ChromeLayout): void {
  const next: ChromeLayout = {
    sidebarWidth: clampSidebarWidth(layout.sidebarWidth),
    columnWidths: Object.fromEntries(
      Object.entries(layout.columnWidths).map(([key, value]) => [key, clampColumnWidth(value)]),
    ),
  };
  storage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(next));
}

export function bindVSplitter(
  el: HTMLElement,
  opts: {
    getWidth: () => number;
    setWidth: (width: number) => void;
    clamp: (width: number) => number;
  },
): void {
  if (!el.getAttribute("title")) {
    el.setAttribute("title", "Drag to resize");
  }
  el.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) {
      return;
    }
    ev.preventDefault();
    ev.stopPropagation();
    el.classList.add("dragging");
    document.body.classList.add("is-col-resizing");
    try {
      el.setPointerCapture(ev.pointerId);
    } catch {
      /* window listeners still drive the drag */
    }
    const pointerId = ev.pointerId;
    const startX = ev.clientX;
    const startW = opts.getWidth();
    const move = (e: PointerEvent): void => {
      if (e.pointerId !== pointerId) {
        return;
      }
      opts.setWidth(opts.clamp(startW + (e.clientX - startX)));
    };
    const up = (e: PointerEvent): void => {
      if (e.pointerId !== pointerId) {
        return;
      }
      el.classList.remove("dragging");
      document.body.classList.remove("is-col-resizing");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  });
}
