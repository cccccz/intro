import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AddError,
  add,
  addMark,
  parse,
  rangesCross,
  strip,
  ulid,
} from "./index.ts";

const clean = "hello 世界 and more text";

describe("nest OK", () => {
  it("parses nested rivets into a tree", () => {
    const body = add(clean, [
      { id: "outer", to: "p1", start: 6, end: 17 },
      { id: "inner", to: "p2", start: 6, end: 8 },
    ]);
    const result = parse(body);
    assert.deepEqual(result.damage, []);
    assert.equal(result.rivets.length, 1);
    assert.equal(result.rivets[0].id, "outer");
    assert.equal(result.rivets[0].to, "p1");
    assert.equal(result.rivets[0].children.length, 1);
    assert.equal(result.rivets[0].children[0].id, "inner");
    assert.equal(result.rivets[0].children[0].to, "p2");
    assert.equal(clean.slice(result.rivets[0].cleanStart, result.rivets[0].cleanEnd), "世界 and more");
    assert.equal(
      clean.slice(
        result.rivets[0].children[0].cleanStart,
        result.rivets[0].children[0].cleanEnd,
      ),
      "世界",
    );
  });

  it("allows adjacent ranges and equal ranges (equal nests in spec order)", () => {
    const body = add("abcdef", [
      { id: "left", start: 0, end: 3 },
      { id: "right", start: 3, end: 6 },
      { id: "wrap", start: 0, end: 3 },
    ]);
    const result = parse(body);
    assert.deepEqual(result.damage, []);
    assert.equal(result.rivets.length, 2);
    assert.equal(result.rivets[0].id, "left");
    assert.equal(result.rivets[0].children[0].id, "wrap");
    assert.equal(result.rivets[1].id, "right");
  });
});

describe("strip reversible", () => {
  it("strip(add(clean, rivets)) === clean", () => {
    const marked = add(clean, [
      { id: "A", to: "note1", start: 0, end: 5 },
      { id: "B", to: "note2", start: 6, end: 8 },
    ]);
    assert.notEqual(marked, clean);
    assert.equal(strip(marked), clean);
    assert.ok(marked.includes('<<r id="A" to="note1">>'));
    assert.ok(marked.includes('<</r id="B">>'));
  });

  it("strip leaves a host with no marks unchanged", () => {
    assert.equal(strip(clean), clean);
    assert.equal(add(clean, []), clean);
  });

  it("addMark on a marked body stays reversible", () => {
    const once = add(clean, [{ id: "A", to: "p1", start: 0, end: 5 }]);
    const twice = addMark(once, { start: 6, end: 8 }, { id: "B", to: "p2" });
    assert.equal(strip(twice), clean);
    const tree = parse(twice);
    assert.deepEqual(tree.damage, []);
    assert.equal(tree.rivets.map((r) => r.id).join(","), "A,B");
  });
});

describe("crossing flagged as damage", () => {
  it("parse reports crossing and does not invent a tree repair", () => {
    const damaged =
      '<<r id="A" to="p1">>aaa <<r id="B" to="p2">>bbb<</r id="A">>ccc<</r id="B">>';
    const result = parse(damaged);
    assert.ok(result.damage.some((d) => d.kind === "crossing"));
    assert.ok(result.damage.some((d) => d.kind === "unclosed"));
    assert.equal(result.rivets.length, 0);
  });

  it("add refuses crossing ranges", () => {
    assert.equal(rangesCross({ start: 0, end: 5 }, { start: 3, end: 8 }), true);
    assert.throws(
      () =>
        add("0123456789", [
          { id: "A", start: 0, end: 5 },
          { id: "B", start: 3, end: 8 },
        ]),
      (err: unknown) =>
        err instanceof AddError && err.damage.some((d) => d.kind === "crossing"),
    );
  });

  it("addMark refuses to write into a damaged host", () => {
    const damaged = 'x<<r id="A">>y<</r id="B">>z';
    assert.throws(
      () => addMark(damaged, { start: 0, end: 1 }, { id: "C" }),
      AddError,
    );
  });
});

describe("ids", () => {
  it("ulid is 26 Crockford chars and unique", () => {
    const a = ulid();
    const b = ulid();
    assert.match(a, /^[0-9A-HJKMNP-TV-Z]{26}$/);
    assert.notEqual(a, b);
  });
});
