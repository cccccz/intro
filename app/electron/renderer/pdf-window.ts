/**
 * Visible-page window for PDF.js hosts.
 *
 * Strategy: keep a placeholder box per page (viewport width/height, no
 * raster) so scroll height is correct. Raster canvases + overlay DOM only
 * for pages that intersect the scrollport, plus PDF_OVERSCAN_PAGES above
 * and below. Pages that leave that window drop their canvas (and overlay);
 * remounting paints overlay again from sidecar rivets.
 *
 * IntersectionObserver is the live signal; the scroll-metric helpers below
 * seed the first window and are unit-tested without a DOM.
 */

/** Inclusive 1-based page span. Empty when `to < from`. */
export type PageRange = {
  from: number;
  to: number;
};

/** Extra pages rastered on each side of the intersecting set. */
export const PDF_OVERSCAN_PAGES = 2;

/** Wait after the last width change before re-measuring and re-rastering. */
export const PDF_RESIZE_DEBOUNCE_MS = 120;

export function samePageRange(a: PageRange, b: PageRange): boolean {
  return a.from === b.from && a.to === b.to;
}

export function pageInRange(page: number, range: PageRange): boolean {
  return range.to >= range.from && page >= range.from && page <= range.to;
}

export function pageCountInRange(range: PageRange): number {
  if (range.to < range.from) {
    return 0;
  }
  return range.to - range.from + 1;
}

/**
 * Expand intersecting 1-based page numbers by `overscan`, clamped to
 * `[1, numPages]`. An empty intersecting set seeds the first window so the
 * initial layout has something to paint before observers fire.
 */
export function expandPageWindow(
  intersecting: readonly number[],
  numPages: number,
  overscan: number = PDF_OVERSCAN_PAGES,
): PageRange {
  if (numPages < 1) {
    return { from: 1, to: 0 };
  }
  const pad = Math.max(0, overscan);
  if (intersecting.length === 0) {
    return { from: 1, to: Math.min(numPages, 1 + pad * 2) };
  }
  let min = intersecting[0]!;
  let max = intersecting[0]!;
  for (const page of intersecting) {
    if (page < min) {
      min = page;
    }
    if (page > max) {
      max = page;
    }
  }
  return {
    from: Math.max(1, min - pad),
    to: Math.min(numPages, max + pad),
  };
}

/** 1-based page numbers whose boxes overlap `[scrollTop, scrollTop + viewportHeight)`. */
export function intersectingPagesFromScroll(
  pageTops: readonly number[],
  pageHeights: readonly number[],
  scrollTop: number,
  viewportHeight: number,
): number[] {
  const viewStart = scrollTop;
  const viewEnd = scrollTop + Math.max(0, viewportHeight);
  const hit: number[] = [];
  const n = Math.min(pageTops.length, pageHeights.length);
  for (let i = 0; i < n; i++) {
    const top = pageTops[i]!;
    const bottom = top + pageHeights[i]!;
    if (bottom > viewStart && top < viewEnd) {
      hit.push(i + 1);
    }
  }
  return hit;
}

/**
 * Raster window from placeholder metrics. If the viewport sits past the last
 * page, pin to the end instead of seeding page 1.
 */
/** First intersecting page, or the nearest placeholder if the viewport is empty. */
export function currentPageFromScroll(
  pageTops: readonly number[],
  pageHeights: readonly number[],
  scrollTop: number,
  viewportHeight: number,
): number {
  const hit = intersectingPagesFromScroll(pageTops, pageHeights, scrollTop, viewportHeight);
  if (hit.length > 0) {
    return hit[0]!;
  }
  const n = Math.min(pageTops.length, pageHeights.length);
  if (n < 1) {
    return 1;
  }
  if (scrollTop <= pageTops[0]!) {
    return 1;
  }
  const lastBottom = pageTops[n - 1]! + pageHeights[n - 1]!;
  if (scrollTop >= lastBottom) {
    return n;
  }
  let page = 1;
  for (let i = 0; i < n; i++) {
    if (pageTops[i]! <= scrollTop) {
      page = i + 1;
    }
  }
  return page;
}

export function rasterWindowFromScroll(
  pageTops: readonly number[],
  pageHeights: readonly number[],
  scrollTop: number,
  viewportHeight: number,
  overscan: number = PDF_OVERSCAN_PAGES,
): PageRange {
  const n = Math.min(pageTops.length, pageHeights.length);
  const hit = intersectingPagesFromScroll(pageTops, pageHeights, scrollTop, viewportHeight);
  if (hit.length > 0) {
    return expandPageWindow(hit, n, overscan);
  }
  if (n === 0) {
    return { from: 1, to: 0 };
  }
  const lastBottom = pageTops[n - 1]! + pageHeights[n - 1]!;
  if (scrollTop >= lastBottom) {
    return expandPageWindow([n], n, overscan);
  }
  return expandPageWindow([], n, overscan);
}
