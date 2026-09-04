import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { add, parse, strip } from "../marks/index.ts";
import { Library } from "./library.ts";
import { PIECE_EXT } from "./types.ts";

const temps: string[] = [];

function tmpLibrary(): Library {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "intro-lib-"));
  temps.push(root);
  return new Library(root);
}

afterEach(() => {
  for (const root of temps.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("library on disk", () => {
  it("creates a piece as {id}.intro.md and resolves id to path", () => {
    const lib = tmpLibrary();
    const piece = lib.createPiece({ id: "host01", body: "正文" });
    assert.equal(piece.id, "host01");
    assert.equal(path.basename(piece.path), `host01${PIECE_EXT}`);
    assert.equal(lib.resolve("host01"), piece.path);
    assert.equal(lib.load("host01").body, "正文");
  });

  it("round-trips load/save of a marked body", () => {
    const lib = tmpLibrary();
    const clean = "宿主一段可以再挂侧边。";
    const marked = add(clean, [{ id: "rv1", to: "side01", start: 0, end: 2 }]);
    lib.createPiece({ id: "host01", body: marked });
    lib.createPiece({ id: "side01", body: "侧边" });

    const loaded = lib.load("host01");
    assert.equal(loaded.body, marked);
    assert.equal(strip(loaded.body), clean);
    assert.deepEqual(parse(loaded.body).damage, []);

    const updated = add(clean, [
      { id: "rv1", to: "side01", start: 0, end: 2 },
      { id: "rv2", to: "side01", start: 2, end: 4 },
    ]);
    lib.save("host01", updated);
    assert.equal(lib.load("host01").body, updated);
    assert.equal(strip(lib.load("host01").body), clean);
  });

  it("resolves a piece in a subdirectory", () => {
    const lib = tmpLibrary();
    const nested = lib.createPiece({
      id: "noteA",
      dir: "drafts",
      body: "nested",
    });
    assert.ok(nested.path.includes(`${path.sep}drafts${path.sep}`));
    assert.equal(lib.resolve("noteA"), nested.path);
    assert.equal(lib.load("noteA").body, "nested");
  });

  it("generates a ULID when id is omitted", () => {
    const lib = tmpLibrary();
    const piece = lib.createPiece({ body: "" });
    assert.match(piece.id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
    assert.ok(lib.resolve(piece.id));
  });
});
