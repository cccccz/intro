import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { attachPoint, firstPaintedRects, rectsIntersect } from "./geometry.ts";

describe("anchor geometry", () => {
  it("attachPoint uses the last rect’s right-center", () => {
    assert.equal(attachPoint([]), null);
    assert.deepEqual(
      attachPoint([
        { left: 0, top: 0, right: 10, bottom: 10 },
        { left: 0, top: 12, right: 20, bottom: 22 },
      ]),
      { x: 20, y: 17 },
    );
  });

  it("rectsIntersect allows a small slop", () => {
    const a = { left: 0, top: 0, right: 10, bottom: 10 };
    assert.equal(rectsIntersect(a, { left: 4, top: 0, right: 18, bottom: 10 }), true);
    assert.equal(rectsIntersect(a, { left: 20, top: 0, right: 30, bottom: 10 }), false);
  });

  it("firstPaintedRects skips nodes with no boxes", () => {
    const hidden = { getClientRects: () => [] };
    const shown = {
      getClientRects: () => [{ left: 1, top: 2, right: 3, bottom: 4 }],
    };
    assert.deepEqual(firstPaintedRects([hidden, shown]), [
      { left: 1, top: 2, right: 3, bottom: 4 },
    ]);
    assert.deepEqual(firstPaintedRects([hidden]), []);
  });
});


it("merges a term and its superscript without retaining nested boxes", async () => {
  const { mathRegions } = await import("./math-regions.ts");
  assert.deepEqual(mathRegions([
    {left:0,top:10,right:12,bottom:30}, {left:13,top:10,right:27,bottom:30},
    {left:25,top:2,right:32,bottom:18}, {left:2,top:12,right:8,bottom:25},
  ]), [{left:0,top:2,right:32,bottom:30}]);
  const nativeLike = Object.create({left:0,top:0,right:10,bottom:10});
  assert.deepEqual(mathRegions([nativeLike]), [{left:0,top:0,right:10,bottom:10}]);
  assert.equal(mathRegions([
    {left:0,top:0,right:12,bottom:20}, {left:40,top:0,right:50,bottom:20},
    {left:0,top:30,right:12,bottom:50},
  ]).length,3);
});
