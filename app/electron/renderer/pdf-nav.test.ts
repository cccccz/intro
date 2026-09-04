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
} from "./pdf-nav.ts";

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
