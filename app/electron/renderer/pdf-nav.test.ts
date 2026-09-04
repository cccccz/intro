import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ZOOM_FIT,
  ZOOM_MAX,
  ZOOM_MIN,
  clampPage,
  clampZoom,
  formatZoom,
  parsePageInput,
  zoomIn,
  zoomOut,
  readingOffset,
  readingScrollTop,
} from "./pdf-nav.ts";
import { currentPageFromScroll } from "./pdf-window.ts";

describe("PDF reading position on resize", () => {
  it("keeps page 200 at 40 percent through repeated width changes", () => {
    const tops = (height: number) => Array.from({ length: 1401 }, (_, i) => 4 + i * (height + 10));
    let height = 1000;
    let scroll = tops(height)[199] + height * 0.4;
    for (const next of [600, 1200, 450, 1000]) {
      const before = tops(height);
      const page = currentPageFromScroll(before, before.map(() => height), scroll, 500);
      assert.equal(page, 200);
      const anchor = readingOffset(before[page - 1], height, scroll);
      const after = tops(next);
      scroll = readingScrollTop(after[page - 1], next, anchor);
      assert.equal(currentPageFromScroll(after, after.map(() => next), scroll, 500), 200);
      assert.ok(Math.abs((scroll - after[199]) / next - 0.4) < 1e-10);
      height = next;
    }
  });

  it("preserves a fixed gap before a page rather than scaling the page margins", () => {
    assert.equal(readingScrollTop(2024, 2000, readingOffset(1014, 1000, 1008)), 2018);
    assert.equal(readingScrollTop(4, 500, readingOffset(4, 1000, 0)), 0);
  });

  it("uses the selected page geometry with mixed page sizes", () => {
    const anchor = readingOffset(830, 600, 1130);
    assert.equal(readingScrollTop(1230, 900, anchor), 1680);
  });
});

describe("clampPage", () => {
  it("clamps to [1, numPages] and rounds", () => {
    assert.equal(clampPage(1, 12), 1);
    assert.equal(clampPage(12, 12), 12);
    assert.equal(clampPage(0, 12), 1);
    assert.equal(clampPage(-4, 12), 1);
    assert.equal(clampPage(99, 12), 12);
    assert.equal(clampPage(3.6, 12), 4);
    assert.equal(clampPage(Number.NaN, 12), 1);
    assert.equal(clampPage(5, 0), 1);
    assert.equal(clampPage(5, Number.NaN), 1);
  });

  it("parses a page input the same way", () => {
    assert.equal(parsePageInput(" 7 ", 20), 7);
    assert.equal(parsePageInput("", 20), 1);
    assert.equal(parsePageInput("nope", 20), 1);
    assert.equal(parsePageInput("999", 8), 8);
  });
});

describe("clampZoom", () => {
  it("keeps a fit-width multiplier in range", () => {
    assert.equal(clampZoom(ZOOM_FIT), 1);
    assert.equal(clampZoom(0), ZOOM_MIN);
    assert.equal(clampZoom(99), ZOOM_MAX);
    assert.equal(clampZoom(Number.NaN), ZOOM_FIT);
    assert.equal(zoomIn(1), 1.25);
    assert.equal(zoomOut(1.25), 1);
    assert.equal(zoomOut(ZOOM_MIN), ZOOM_MIN);
    assert.equal(zoomIn(ZOOM_MAX), ZOOM_MAX);
    assert.equal(formatZoom(1), "Fit");
    assert.equal(formatZoom(1.25), "125%");
  });
});
