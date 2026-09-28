import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { filterRows, hangPath, pieceTree, type TreeLink } from "./piece-tree.ts";

const link = (hostId: string, rivetId: string, sideId: string, order: number, page?: number): TreeLink => ({
  hostId, rivetId, sideId, order, excerpt: "", ...(page ? { page } : {}),
});

describe("pieceTree", () => {
  const pieces = [
    { id: "a-note", medium: "text" as const },
    { id: "b-side", medium: "text" as const },
    { id: "c-deep", medium: "text" as const },
    { id: "z-book", medium: "pdf" as const },
    { id: "loose", medium: "text" as const },
  ];
  const links = [
    link("z-book", "r2", "b-side", 200, 2),
    link("z-book", "r1", "a-note", 100, 1),
    link("b-side", "r3", "c-deep", 5),
    link("a-note", "r4", "b-side", 1),
  ];

  it("puts PDFs first and nests sides by position, repeating reused pieces", () => {
    const rows = pieceTree(pieces, links);
    assert.deepEqual(rows.map((row) => `${"  ".repeat(row.depth)}${row.pieceId}`), [
      "z-book",
      "  a-note",
      "    b-side",
      "      c-deep",
      "  b-side",
      "    c-deep",
      "loose",
    ]);
    assert.equal(new Set(rows.map((row) => row.key)).size, rows.length);
    assert.equal(rows[0]!.hasChildren, true);
    assert.equal(rows.at(-1)!.hasChildren, false);
  });

  it("survives cycles and links to missing pieces", () => {
    const rows = pieceTree(
      [{ id: "x", medium: "text" }, { id: "y", medium: "text" }],
      [link("x", "r1", "y", 0), link("y", "r2", "x", 0), link("x", "r3", "gone", 1)],
    );
    assert.deepEqual(rows.map((row) => [row.pieceId, row.depth]), [["x", 0], ["y", 1]]);
  });

  it("keeps matches and their ancestors when filtering", () => {
    const rows = pieceTree(pieces, links);
    const keep = filterRows(rows, (row) => row.pieceId === "c-deep");
    assert.deepEqual(rows.filter((row) => keep.has(row.key)).map((row) => row.pieceId), [
      "z-book", "a-note", "b-side", "c-deep", "b-side", "c-deep",
    ]);
  });
});

describe("hangPath", () => {
  it("walks up to the root host through the first parent", () => {
    const links = [link("book", "r1", "a", 10, 3), link("a", "r2", "b", 0), link("other", "r9", "b", 50)];
    assert.deepEqual(hangPath("b", links).map((l) => l.rivetId), ["r1", "r2"]);
    assert.deepEqual(hangPath("b", links, links[2]).map((l) => l.rivetId), ["r9"]);
    assert.deepEqual(hangPath("book", links), []);
  });

  it("stops on a cycle", () => {
    const links = [link("x", "r1", "y", 0), link("y", "r2", "x", 0)];
    assert.ok(hangPath("y", links).length <= 2);
  });
});
