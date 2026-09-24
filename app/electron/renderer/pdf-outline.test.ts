import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ancestorKeys,
  currentOutlineKey,
  filterOutline,
  flattenOutline,
  initialExpanded,
  matchParts,
  nearestShown,
  visibleRows,
  type OutlineItem,
} from "./pdf-outline.ts";

const leaf = (title: string, page: number | null): OutlineItem => ({ title, page, children: [] });
const node = (title: string, page: number | null, children: OutlineItem[]): OutlineItem => ({ title, page, children });

const book: OutlineItem[] = [
  node("Part One", 1, [
    node("Chapter 1", 2, [leaf("1.1 Intro", 2), leaf("1.2 Returns", 4)]),
    leaf("Chapter 2", 6),
  ]),
  node("Part Two", 8, [node("Chapter 3", 9, [leaf("3.1 Correlation", 10)])]),
  leaf("Index", null),
];

const titles = (rows: { title: string }[]): string[] => rows.map((r) => r.title);

describe("flattenOutline", () => {
  it("lists entries in reading order with index-path keys and levels", () => {
    const rows = flattenOutline(book);
    assert.deepEqual(rows.map((r) => [r.key, r.level, r.title]), [
      ["0", 0, "Part One"],
      ["0.0", 1, "Chapter 1"],
      ["0.0.0", 2, "1.1 Intro"],
      ["0.0.1", 2, "1.2 Returns"],
      ["0.1", 1, "Chapter 2"],
      ["1", 0, "Part Two"],
      ["1.0", 1, "Chapter 3"],
      ["1.0.0", 2, "3.1 Correlation"],
      ["2", 0, "Index"],
    ]);
    assert.equal(rows[0]!.hasChildren, true);
    assert.equal(rows[2]!.hasChildren, false);
    assert.equal(rows[3]!.parent, "0.0");
  });

  it("derives ancestors from the key", () => {
    assert.deepEqual(ancestorKeys("0.3.1"), ["0", "0.3"]);
    assert.deepEqual(ancestorKeys("2"), []);
  });
});

describe("currentOutlineKey", () => {
  const rows = flattenOutline(book);

  it("picks the section with the greatest start page not after the reading page", () => {
    assert.equal(currentOutlineKey(rows, 5), "0.0.1");
    assert.equal(currentOutlineKey(rows, 7), "0.1");
    assert.equal(currentOutlineKey(rows, 99), "1.0.0");
  });

  it("prefers the deeper entry when a chapter and its first section share a page", () => {
    assert.equal(currentOutlineKey(rows, 2), "0.0.0");
    assert.equal(currentOutlineKey(rows, 3), "0.0.0");
  });

  it("has no current section before the first entry or without page numbers", () => {
    assert.equal(currentOutlineKey(flattenOutline([leaf("Late", 5)]), 2), null);
    assert.equal(currentOutlineKey(flattenOutline([leaf("No dest", null)]), 3), null);
  });
});

describe("initialExpanded", () => {
  it("opens only the path to the current section", () => {
    const rows = flattenOutline(book);
    const open = initialExpanded(rows, "0.0.1");
    assert.deepEqual([...open].sort(), ["0", "0.0"]);
    assert.deepEqual(titles(visibleRows(rows, open, null)), [
      "Part One", "Chapter 1", "1.1 Intro", "1.2 Returns", "Chapter 2", "Part Two", "Index",
    ]);
  });

  it("opens a lone book-title root and single-entry levels below it", () => {
    const wrapped = flattenOutline([node("Book", 1, [node("Volume", 1, [leaf("A", 2), leaf("B", 3)])])]);
    assert.deepEqual([...initialExpanded(wrapped, null)].sort(), ["0", "0.0"]);
  });

  it("keeps a flat outline folded when nothing is current", () => {
    assert.deepEqual([...initialExpanded(flattenOutline(book), null)], []);
  });
});

describe("filterOutline", () => {
  const rows = flattenOutline(book);

  it("shows matches with their ancestors, case-insensitively", () => {
    const filter = filterOutline(rows, "  CORREL ");
    assert.ok(filter);
    assert.deepEqual([...filter.matches], ["1.0.0"]);
    assert.deepEqual(titles(visibleRows(rows, new Set(), filter)), ["Part Two", "Chapter 3", "3.1 Correlation"]);
  });

  it("ignores folding while filtering and is off for a blank query", () => {
    const filter = filterOutline(rows, "chapter");
    assert.deepEqual(titles(visibleRows(rows, new Set(), filter)), [
      "Part One", "Chapter 1", "Chapter 2", "Part Two", "Chapter 3",
    ]);
    assert.equal(filterOutline(rows, "   "), null);
  });

  it("reports no rows when nothing matches", () => {
    const filter = filterOutline(rows, "zzz");
    assert.deepEqual(visibleRows(rows, new Set(), filter), []);
  });
});

describe("nearestShown", () => {
  it("falls back to the closest visible ancestor of a folded current section", () => {
    const shown = new Set(["0", "1", "2"]);
    assert.equal(nearestShown("0.0.1", shown), "0");
    assert.equal(nearestShown("1", shown), "1");
    assert.equal(nearestShown(null, shown), null);
    assert.equal(nearestShown("3.1", shown), null);
  });
});

describe("matchParts", () => {
  it("splits every occurrence of the query", () => {
    assert.deepEqual(matchParts("Vol and vol", "vol"), [
      { text: "Vol", hit: true },
      { text: " and ", hit: false },
      { text: "vol", hit: true },
    ]);
    assert.deepEqual(matchParts("Plain", ""), [{ text: "Plain", hit: false }]);
  });
});
