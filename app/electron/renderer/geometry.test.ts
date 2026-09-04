import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { attachPoint, rectsIntersect } from "./geometry.ts";

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
});
