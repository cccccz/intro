import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { IdNormalizer } from "./normalize.ts";

const A = "01M3MPQGH4FJTJTYMWH3B5ZHP9";
const B = "01M3MPTVKHS8WHA0G4KRG7N969";

describe("parity id normalizer", () => {
  it("names ids by first appearance so two runs compare equal", () => {
    const run = (first: string, second: string): string[] =>
      new IdNormalizer().normalizeAll([`hang ${first} then ${second}`, `open ${second}`]);
    assert.deepEqual(run(A, B), run(B, A));
    assert.deepEqual(run(A, B), ["hang <id1> then <id2>", "open <id2>"]);
  });

  it("finds ids right after a JSON escape and inside file names", () => {
    const [out] = new IdNormalizer().normalizeAll([`"title\\n${A}\\n/lib/${A}.intro.md"`]);
    assert.equal(out, `"title\\n<id1>\\n/lib/<id1>.intro.md"`);
  });

  it("leaves longer tokens alone", () => {
    const [out] = new IdNormalizer().normalizeAll([`x${A}`, `${A}Z`]);
    assert.equal(out, `x${A}`);
  });

  it("replaces the 8-character short form after the full id is known", () => {
    const [, out] = new IdNormalizer().normalizeAll([A, `untitled ${A.slice(0, 8)}`]);
    assert.equal(out, "untitled <id1:short>");
  });

  it("replaces the library root in raw, slash and JSON-escaped form", () => {
    const norm = new IdNormalizer(["C:\\tmp\\lib"]);
    assert.equal(norm.apply('C:\\tmp\\lib\\a.md C:/tmp/lib/b.md "C:\\\\tmp\\\\lib\\\\c.md"'), '<library>\\a.md <library>/b.md "<library>\\\\c.md"');
  });

  it("names pin UUIDs too", () => {
    const [out] = new IdNormalizer().normalizeAll(["pin 3f2b8c1e-8d4a-4b7e-9c1d-2a6f0e9b7c55"]);
    assert.equal(out, "pin <id1>");
  });
});
