import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  META_FORMAT_VERSION,
  MetaError,
  displayTitle,
  emptyMeta,
  normalizeTitle,
  parseMeta,
  serializeMeta,
} from "./meta.ts";

describe("displayTitle", () => {
  it("uses a manual title when set", () => {
    assert.equal(displayTitle({ title: "  Proof  ", medium: "text" }), "Proof");
    assert.equal(
      displayTitle({ title: "My paper", sourceName: "scan.pdf", medium: "pdf" }),
      "My paper",
    );
  });

  it("does not fall back to a piece id", () => {
    assert.equal(displayTitle({ title: "", medium: "text" }), "Untitled");
    assert.equal(displayTitle({ title: "   ", medium: "text" }), "Untitled");
    assert.equal(displayTitle({ medium: "text" }), "Untitled");
    assert.equal(displayTitle({ sourceName: "paper.pdf", medium: "pdf" }), "paper.pdf");
    assert.equal(displayTitle({ medium: "pdf" }), "Untitled PDF");
  });
});

describe("piece meta sidecar", () => {
  it("round-trips a title and drops a blank one", () => {
    const raw = serializeMeta({ formatVersion: META_FORMAT_VERSION, title: "  Side note  " });
    assert.match(raw, /"title": "Side note"/);
    assert.deepEqual(parseMeta(raw), { formatVersion: 1, title: "Side note" });
    assert.equal(normalizeTitle("  "), undefined);
    assert.deepEqual(parseMeta(serializeMeta({ formatVersion: 1, title: "   " })), emptyMeta());
  });

  it("rejects a bad sidecar without guessing", () => {
    assert.throws(() => parseMeta("{"), MetaError);
    assert.throws(() => parseMeta("[]"), MetaError);
    assert.throws(() => parseMeta(JSON.stringify({ formatVersion: 2, title: "x" })), MetaError);
    assert.throws(() => parseMeta(JSON.stringify({ formatVersion: 1, title: 3 })), MetaError);
  });
});
