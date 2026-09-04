/**
 * Window-math only: intersecting pages, overscan, clamp.
 * IntersectionObserver / canvas mount-unmount are not covered here.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PDF_OVERSCAN_PAGES,
  currentPageFromScroll,
  expandPageWindow,
  intersectingPagesFromScroll,
  pageCountInRange,
  pageInRange,
  rasterWindowFromScroll,
  samePageRange,
  windowPageCountCap,
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

/** `pageCountInRange(window) ≤ intersecting + 2×overscan`, independent of `numPages`. */
function assertWindowCap(
  range: { from: number; to: number },
  intersectingCount: number,
  overscan: number,
  detail: string,
): void {
  const cap = windowPageCountCap(intersectingCount, overscan);
  const count = pageCountInRange(range);
  assert.ok(
    count <= cap,
    `${detail}: pageCountInRange=${count} exceeds cap ${cap} (intersecting=${intersectingCount}, 2×overscan=${2 * overscan})`,
  );
}

describe("windowPageCountCap", () => {
  it("is intersecting pages plus overscan on both sides, not numPages", () => {
    assert.equal(windowPageCountCap(1, 2), 1 + 2 * 2);
    assert.equal(windowPageCountCap(2, 2), 2 + 2 * 2);
    assert.equal(windowPageCountCap(3, PDF_OVERSCAN_PAGES), 3 + 2 * PDF_OVERSCAN_PAGES);
    assert.equal(windowPageCountCap(0, 2), 1 + 2 * 2);
    assert.equal(windowPageCountCap(400, 2), 404);
  });
});

describe("expandPageWindow", () => {
  it("seeds the first window when nothing intersects yet", () => {
    assert.deepEqual(expandPageWindow([], 100), { from: 1, to: 1 + PDF_OVERSCAN_PAGES * 2 });
    assert.deepEqual(expandPageWindow([], 3), { from: 1, to: 3 });
    assert.deepEqual(expandPageWindow([], 0), { from: 1, to: 0 });
    assertWindowCap(expandPageWindow([], 2000), 0, PDF_OVERSCAN_PAGES, "empty seed, 2000 pages");
    assertWindowCap(expandPageWindow([], 400), 0, PDF_OVERSCAN_PAGES, "empty seed, 400 pages");
  });

  it("adds overscan on both sides and clamps to the document", () => {
    assert.deepEqual(expandPageWindow([1], 10, 2), { from: 1, to: 3 });
    assert.deepEqual(expandPageWindow([5], 10, 2), { from: 3, to: 7 });
    assert.deepEqual(expandPageWindow([10], 10, 2), { from: 8, to: 10 });
    assert.deepEqual(expandPageWindow([4, 5, 6], 20, 2), { from: 2, to: 8 });
    assert.deepEqual(expandPageWindow([6, 4], 20, 2), { from: 2, to: 8 });
    assertWindowCap(expandPageWindow([1], 10, 2), 1, 2, "start clamp");
    assertWindowCap(expandPageWindow([10], 10, 2), 1, 2, "end clamp");
    assertWindowCap(expandPageWindow([4, 5, 6], 20, 2), 3, 2, "mid span");
  });

  it("caps at intersecting + 2×overscan independent of numPages", () => {
    const intersecting = [400, 401];
    const overscan = 2;
    const cap = windowPageCountCap(intersecting.length, overscan);
    assert.equal(cap, intersecting.length + 2 * overscan);

    for (const numPages of [401, 400, 2000]) {
      const range = expandPageWindow(intersecting, numPages, overscan);
      assertWindowCap(range, intersecting.length, overscan, `numPages=${numPages}`);
    }

    const unclamped = expandPageWindow(intersecting, 2000, overscan);
    assert.deepEqual(unclamped, { from: 398, to: 403 });
    assert.equal(pageCountInRange(unclamped), cap);
    assert.equal(pageInRange(1, unclamped), false);
    assert.equal(pageInRange(400, unclamped), true);
    assert.equal(pageInRange(2000, unclamped), false);

    const a = expandPageWindow([200], 400, overscan);
    const b = expandPageWindow([200], 2000, overscan);
    assert.deepEqual(a, b);
    assertWindowCap(a, 1, overscan, "same mid-doc window on 400 vs 2000");
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
    const overscan = 2;
    const hit = intersectingPagesFromScroll(pages.tops, pages.heights, 850, 200);
    const range = rasterWindowFromScroll(pages.tops, pages.heights, 850, 200, overscan);
    assert.deepEqual(range, { from: 1, to: 4 });
    assert.equal(samePageRange(range, { from: 1, to: 4 }), true);
    assertWindowCap(range, hit.length, overscan, "small 20-page stack");
  });

  it("pins to the last pages when scrolled past the end", () => {
    const overscan = 2;
    const lastTop = pages.tops[19]!;
    const hit = intersectingPagesFromScroll(pages.tops, pages.heights, lastTop + 900, 400);
    const range = rasterWindowFromScroll(pages.tops, pages.heights, lastTop + 900, 400, overscan);
    assert.deepEqual(range, { from: 18, to: 20 });
    assert.equal(hit.length, 0);
    assertWindowCap(range, 0, overscan, "past last page");
  });

  it("reports the first visible page for the jump control", () => {
    assert.equal(currentPageFromScroll(pages.tops, pages.heights, 0, 600), 1);
    assert.equal(currentPageFromScroll(pages.tops, pages.heights, 850, 200), 2);
    assert.equal(currentPageFromScroll(pages.tops, pages.heights, pages.tops[19]! + 900, 400), 20);
  });

  it("keeps pageCountInRange ≤ intersecting + 2×overscan on long synthetic scrolls", () => {
    const overscan = 2;
    const viewports = [400, 900, 2500];
    for (const numPages of [400, 2000]) {
      const long = stack(numPages, 792);
      const lastTop = long.tops[long.tops.length - 1]!;
      for (const viewport of viewports) {
        for (let scroll = 0; scroll <= lastTop + viewport; scroll += 350) {
          const hit = intersectingPagesFromScroll(long.tops, long.heights, scroll, viewport);
          const range = rasterWindowFromScroll(long.tops, long.heights, scroll, viewport, overscan);
          assertWindowCap(
            range,
            hit.length,
            overscan,
            `numPages=${numPages} viewport=${viewport} scroll=${scroll} hit=${hit.length}`,
          );
        }
      }
    }
  });
});
