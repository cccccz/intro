import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPdfMagic, minimalPdf } from "./fixture.ts";
import {
  OverlayError,
  addOverlayRivet,
  emptyOverlay,
  parseOverlay,
  quadsToRects,
  removeOverlayRivet,
  serializeOverlay,
} from "./overlay.ts";
import { createHostMeta, parseHostMeta, pdfFileName } from "./host.ts";

describe("PDF overlay model", () => {
  it("round-trips an overlay rivet without character offsets", () => {
    const overlay = addOverlayRivet(emptyOverlay(), {
      id: "rv1",
      to: "side01",
      anchors: [{ page: 1, rect: { x: 72, y: 400, width: 200, height: 16 } }],
      quote: "optional later",
    });
    const raw = serializeOverlay(overlay);
    assert.doesNotMatch(raw, /start|end|offset|index/);
    const parsed = parseOverlay(raw);
    assert.equal(parsed.formatVersion, 1);
    assert.equal(parsed.rivets.length, 1);
    assert.equal(parsed.rivets[0].id, "rv1");
    assert.equal(parsed.rivets[0].to, "side01");
    assert.deepEqual(parsed.rivets[0].anchors[0], {
      page: 1,
      rect: { x: 72, y: 400, width: 200, height: 16 },
    });
  });

  it("normalizes QuadPoints by min/max regardless of vertex order", () => {
    // ISO-ish: BL, BR, TL, TR
    const iso = [10, 20, 50, 20, 10, 40, 50, 40];
    // Acrobat-ish: TL, TR, BL, BR
    const acrobat = [10, 40, 50, 40, 10, 20, 50, 20];
    const expected = { x: 10, y: 20, width: 40, height: 20 };
    assert.deepEqual(quadsToRects(iso), [expected]);
    assert.deepEqual(quadsToRects(acrobat), [expected]);
  });

  it("accepts several quads and rejects a collapsed one", () => {
    assert.equal(quadsToRects([0, 0, 2, 0, 0, 1, 2, 1, 5, 5, 8, 5, 5, 7, 8, 7]).length, 2);
    assert.throws(() => quadsToRects([0, 0, 0, 0, 0, 0, 0, 0]), OverlayError);
    assert.throws(() => quadsToRects([1, 2, 3]), OverlayError);
  });

  it("refuses invalid pages, empty anchors, and duplicate ids", () => {
    assert.throws(
      () =>
        addOverlayRivet(emptyOverlay(), {
          id: "rv1",
          to: "side01",
          anchors: [{ page: 0, rect: { x: 0, y: 0, width: 1, height: 1 } }],
        }),
      OverlayError,
    );
    assert.throws(
      () => addOverlayRivet(emptyOverlay(), { id: "rv1", to: "side01", anchors: [] }),
      OverlayError,
    );
    const one = addOverlayRivet(emptyOverlay(), {
      id: "rv1",
      to: "side01",
      anchors: [{ page: 1, rect: { x: 0, y: 0, width: 1, height: 1 } }],
    });
    assert.throws(
      () =>
        addOverlayRivet(one, {
          id: "rv1",
          to: "side02",
          anchors: [{ page: 1, rect: { x: 2, y: 2, width: 1, height: 1 } }],
        }),
      /duplicate/,
    );
  });

  it("removes an overlay rivet by id", () => {
    const one = addOverlayRivet(emptyOverlay(), {
      id: "rv1",
      to: "side01",
      anchors: [{ page: 1, rect: { x: 0, y: 0, width: 1, height: 1 } }],
    });
    const two = addOverlayRivet(one, {
      id: "rv2",
      to: "side02",
      anchors: [{ page: 1, rect: { x: 2, y: 2, width: 1, height: 1 } }],
    });
    const leftover = removeOverlayRivet(two, "rv1");
    assert.deepEqual(
      leftover.rivets.map((r) => r.id),
      ["rv2"],
    );
    assert.throws(() => removeOverlayRivet(leftover, "rv1"), OverlayError);
  });

  it("does not treat a selection as an index into PDF bytes", () => {
    const pdf = minimalPdf();
    assert.ok(isPdfMagic(pdf));
    const overlay = addOverlayRivet(emptyOverlay(), {
      id: "rv1",
      to: "side01",
      anchors: [{ page: 1, rect: { x: 10, y: 10, width: 30, height: 12 } }],
    });
    for (const rivet of overlay.rivets) {
      assert.equal("start" in rivet, false);
      assert.equal("end" in rivet, false);
      for (const anchor of rivet.anchors) {
        assert.ok(anchor.page >= 1);
        assert.ok(anchor.rect.width > 0);
      }
    }
  });
});

describe("PDF host metadata", () => {
  it("requires pdf basename to match {id}.pdf", () => {
    const meta = createHostMeta("host01", "paper.pdf");
    assert.equal(meta.pdf, pdfFileName("host01"));
    assert.equal(meta.sourceName, "paper.pdf");
    assert.deepEqual(parseHostMeta(JSON.stringify(meta)), meta);
    assert.throws(
      () =>
        parseHostMeta(
          JSON.stringify({ formatVersion: 1, medium: "pdf", id: "host01", pdf: "other.pdf" }),
        ),
      OverlayError,
    );
  });
});
