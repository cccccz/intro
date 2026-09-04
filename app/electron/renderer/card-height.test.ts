import assert from "node:assert/strict";
import test from "node:test";
import { CARD_HEIGHT_MAX, CARD_HEIGHT_MIN, cardHeightKey, clampCardHeight, loadCardHeight, saveCardHeight, resizeCardPair } from "./card-height.ts";

test("shared edge preserves total height and respects both minimum heights", () => {
  assert.deepEqual(resizeCardPair(320, 320, 80), [400, 240]);
  assert.deepEqual(resizeCardPair(320, 320, 900), [520, 120]);
  assert.deepEqual(resizeCardPair(320, 320, -900), [120, 520]);
  assert.deepEqual(resizeCardPair(2300, 320, 200), [2400, 220]);
});

test("side height clamps and persists separately per hanging", () => {
  assert.equal(clampCardHeight(20), CARD_HEIGHT_MIN);
  assert.equal(clampCardHeight(9999), CARD_HEIGHT_MAX);
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
  const a = cardHeightKey("library", "rivet-a");
  const b = cardHeightKey("library", "rivet-b");
  saveCardHeight(storage, a, 487.7);
  assert.equal(loadCardHeight(storage, a), 488);
  assert.equal(loadCardHeight(storage, b), null);
  saveCardHeight(storage, a, null);
  assert.equal(loadCardHeight(storage, a), null);
});
