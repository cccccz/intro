import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PDF_OVERSCAN_PAGES,
  expandPageWindow,
  intersectingPagesFromScroll,
  pageCountInRange,
  pageInRange,
  rasterWindowFromScroll,
  samePageRange,
} from "./pdf-window.ts";

function stack(
  count: number,
  height: number,
  gap = 10,
  pad = 8,
): { tops: number[]; heights: number[] } {
  const heights = Array.from({ length: count }, () => height);
  const tops: number[] = [];
  let y = pad;
  for (let i = 0; i < count; i++) {
    tops.push(y);
    y += height + gap;
  }
  return { tops, heights };
}

describe("expandPageWindow", () => {
  it("seeds the first window when nothing intersects yet", () => {
    assert.deepEqual(expandPageWindow([], 100), { from: 1, to: 1 + PDF_OVERSCAN_PAGES * 2 });
    assert.deepEqual(expandPageWindow([], 3), { from: 1, to: 3 });
    assert.deepEqual(expandPageWindow([], 0), { from: 1, to: 0 });
  });

  it("adds overscan on both sides and clamps to the document", () => {
    assert.deepEqual(expandPageWindow([1], 10, 2), { from: 1, to: 3 });
    assert.deepEqual(expandPageWindow([5], 10, 2), { from: 3, to: 7 });
    assert.deepEqual(expandPageWindow([10], 10, 2), { from: 8, to: 10 });
    assert.deepEqual(expandPageWindow([4, 5, 6], 20, 2), { from: 2, to: 8 });
    assert.deepEqual(expandPageWindow([6, 4], 20, 2), { from: 2, to: 8 });
  });

  it("stays bounded on a long document", () => {
    const range = expandPageWindow([400, 401], 2000, 2);
    assert.deepEqual(range, { from: 398, to: 403 });
    assert.equal(pageCountInRange(range), 6);
    assert.equal(pageInRange(1, range), false);
    assert.equal(pageInRange(400, range), true);
    assert.equal(pageInRange(2000, range), false);
  });
});

describe("rasterWindowFromScroll", () => {
  const pages = stack(20, 800);

  it("treats only overlapping placeholders as intersecting", () => {
    // pad 8 + page1 800 → page 2 starts at 818
    assert.deepEqual(intersectingPagesFromScroll(pages.tops, pages.heights, 0, 600), [1]);
    assert.deepEqual(intersectingPagesFromScroll(pages.tops, pages.heights, 850, 200), [2]);
    assert.deepEqual(intersectingPagesFromScroll(pages.tops, pages.heights, 800, 50), [1, 2]);
  });

  it("rasters the intersecting pages plus overscan", () => {
    const range = rasterWindowFromScroll(pages.tops, pages.heights, 850, 200, 2);
    assert.deepEqual(range, { from: 1, to: 4 });
    assert.equal(samePageRange(range, { from: 1, to: 4 }), true);
  });

  it("pins to the last pages when scrolled past the end", () => {
    const lastTop = pages.tops[19]!;
    const range = rasterWindowFromScroll(pages.tops, pages.heights, lastTop + 900, 400, 2);
    assert.deepEqual(range, { from: 18, to: 20 });
  });

  it("does not raster the whole document when the viewport is small", () => {
    const long = stack(1000, 792);
    const range = rasterWindowFromScroll(long.tops, long.heights, 792 * 50, 900, 2);
    assert.ok(pageCountInRange(range) <= 8);
    assert.ok(range.from > 1);
    assert.ok(range.to < 1000);
  });

  it("keeps a bounded window while scrolling through hundreds of pages", () => {
    const long = stack(400, 792);
    let maxMounted = 0;
    const lastTop = long.tops[long.tops.length - 1]!;
    for (let scroll = 0; scroll <= lastTop; scroll += 500) {
      const range = rasterWindowFromScroll(long.tops, long.heights, scroll, 900, 2);
      maxMounted = Math.max(maxMounted, pageCountInRange(range));
    }
    assert.ok(maxMounted <= 8, `window grew to ${maxMounted}`);
  });
});
