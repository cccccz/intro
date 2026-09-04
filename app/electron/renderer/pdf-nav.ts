/** Zoom + page-jump helpers for the virtualized PDF column. */

export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 4;
export const ZOOM_STEP = 1.25;
/** `1` = fit the column width. Other values are multipliers on that fit. */
export const ZOOM_FIT = 1;

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
