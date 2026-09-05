import assert from "node:assert/strict";
import test from "node:test";
import { loadSidePins, saveSidePins, sidePinId } from "./side-pins.ts";

test("side pins survive reopen and are isolated by library and hanging, not target note", () => {
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
  const first = sidePinId("host-a", "r1");
  const other = sidePinId("host-b", "r1");
  const pins = loadSidePins(storage, "library-a");
  assert.equal(pins.size, 0); // Existing libraries need no migration.
  pins.add(first);
  assert.equal(saveSidePins(storage, "library-a", pins), true);
  assert.equal(loadSidePins(storage, "library-a").has(first), true);
  assert.equal(loadSidePins(storage, "library-a").has(other), false);
  assert.equal(loadSidePins(storage, "library-b").size, 0);
  pins.delete(first);
  saveSidePins(storage, "library-a", pins);
  assert.equal(loadSidePins(storage, "library-a").size, 0);
});

test("invalid preferences are ignored and failed writes are reported", () => {
  for (const raw of ["bad json", "{}", "null", '[1,"oops","[]","[1,2]"]']) {
    assert.equal(loadSidePins({ getItem: () => raw }, "library").size, 0);
  }
  assert.equal(loadSidePins({ getItem: () => { throw Error("unavailable"); } }, "library").size, 0);
  assert.equal(saveSidePins({ setItem: () => { throw Error("full"); } }, "library", new Set()), false);
});
