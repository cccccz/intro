/** Zoom + page-jump helpers for the virtualized PDF column. */

export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 4;
export const ZOOM_STEP = 1.25;
/** `1` = fit the column width. Other values are multipliers on that fit. */
export const ZOOM_FIT = 1;

/** Position relative to a page; inter-page whitespace remains a pixel gap. */
export type ReadingOffset = { fraction: number; gap: number };

export function readingOffset(top: number, height: number, scrollTop: number): ReadingOffset {
  const offset = scrollTop - top;
  return offset < 0
    ? { fraction: 0, gap: offset }
    : { fraction: Math.min(1, offset / Math.max(1, height)), gap: 0 };
}

export function readingScrollTop(top: number, height: number, anchor: ReadingOffset): number {
  return Math.max(0, top + height * anchor.fraction + anchor.gap);
}

export function clampZoom(value: number): number {
  if (!Number.isFinite(value)) {
    return ZOOM_FIT;
  }
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
}

export function zoomIn(zoom: number): number {
  return clampZoom(clampZoom(zoom) * ZOOM_STEP);
}

export function zoomOut(zoom: number): number {
  return clampZoom(clampZoom(zoom) / ZOOM_STEP);
}

export function formatZoom(zoom: number): string {
  const z = clampZoom(zoom);
  if (Math.abs(z - ZOOM_FIT) < 1e-6) {
    return "Fit";
  }
  return `${Math.round(z * 100)}%`;
}

/** Evenly spread page numbers used to estimate the body page width. */
export function fitSamplePages(numPages: number, count = 25): number[] {
  if (!Number.isFinite(numPages) || numPages < 1) {
    return [1];
  }
  const n = Math.min(Math.floor(numPages), count);
  if (n === 1) {
    return [1];
  }
  const out = new Set<number>();
  for (let i = 0; i < n; i++) {
    out.add(1 + Math.round((i * (numPages - 1)) / (n - 1)));
  }
  return [...out];
}

/** Median width, so a narrow cover or a wide fold-out does not set the fit for every page. */
export function fitReferenceWidth(widths: number[]): number {
  const valid = widths.filter((w) => Number.isFinite(w) && w > 0).sort((a, b) => a - b);
  if (!valid.length) {
    return 612;
  }
  const mid = valid.length >> 1;
  return valid.length % 2 ? valid[mid]! : (valid[mid - 1]! + valid[mid]!) / 2;
}

export function clampPage(page: number, numPages: number): number {
  if (!Number.isFinite(numPages) || numPages < 1) {
    return 1;
  }
  if (!Number.isFinite(page)) {
    return 1;
  }
  return Math.min(numPages, Math.max(1, Math.round(page)));
}

export function parsePageInput(raw: string, numPages: number): number {
  return clampPage(Number(String(raw).trim()), numPages);
}
