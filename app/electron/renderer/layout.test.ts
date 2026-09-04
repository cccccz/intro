import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COLUMN_DEFAULT,
  COLUMN_MAX,
  COLUMN_MIN,
  COLUMN_PDF_DEFAULT,
  LAYOUT_STORAGE_KEY,
  SIDEBAR_DEFAULT,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  clampColumnWidth,
  clampSidebarWidth,
  columnSize,
  defaultColumnWidth,
  emptyLayout,
  loadChromeLayout,
  parseChromeLayout,
  saveChromeLayout,
} from "./layout.ts";

describe("chrome layout", () => {
  it("clamps sidebar and column widths", () => {
    assert.equal(clampSidebarWidth(200), 200);
    assert.equal(clampSidebarWidth(10), SIDEBAR_MIN);
    assert.equal(clampSidebarWidth(9999), SIDEBAR_MAX);
    assert.equal(clampSidebarWidth(Number.NaN), SIDEBAR_DEFAULT);
    assert.equal(clampColumnWidth(360), 360);
    assert.equal(clampColumnWidth(10), COLUMN_MIN);
    assert.equal(clampColumnWidth(4000), COLUMN_MAX);
    assert.equal(COLUMN_PDF_DEFAULT, 720);
    assert.equal(COLUMN_MAX, 2800);
    assert.equal(defaultColumnWidth(0, true), COLUMN_PDF_DEFAULT);
    assert.equal(defaultColumnWidth(1, false), COLUMN_DEFAULT);
  });

  it("keeps every column at a fixed px width until the user stores a drag", () => {
    assert.deepEqual(columnSize(undefined, 0, true), {
      flex: `0 0 ${COLUMN_PDF_DEFAULT}px`,
      width: `${COLUMN_PDF_DEFAULT}px`,
    });
    assert.deepEqual(columnSize(undefined, 0, false), {
      flex: `0 0 ${COLUMN_DEFAULT}px`,
      width: `${COLUMN_DEFAULT}px`,
    });
    assert.deepEqual(columnSize(undefined, 1, false), {
      flex: `0 0 ${COLUMN_DEFAULT}px`,
      width: `${COLUMN_DEFAULT}px`,
    });
    assert.deepEqual(columnSize(640, 0, true), { flex: "0 0 640px", width: "640px" });
    assert.deepEqual(columnSize(1200, 0, true), { flex: "0 0 1200px", width: "1200px" });
    assert.equal(clampColumnWidth(1200), 1200);
  });

  it("round-trips a stored layout and ignores junk", () => {
    const memory = new Map<string, string>();
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value);
      },
    };
    saveChromeLayout(storage, {
      sidebarWidth: 12,
      columnWidths: { "0": 500, "1": 80, bad: Number.NaN as unknown as number },
    });
    assert.equal(memory.has(LAYOUT_STORAGE_KEY), true);
    const loaded = loadChromeLayout(storage);
    assert.equal(loaded.sidebarWidth, SIDEBAR_MIN);
    assert.equal(loaded.columnWidths["0"], 500);
    assert.equal(loaded.columnWidths["1"], COLUMN_MIN);
    assert.deepEqual(parseChromeLayout(null), emptyLayout());
    assert.deepEqual(loadChromeLayout({ getItem: () => "not-json" }), emptyLayout());
  });
});
