import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { parse, strip } from "../marks/index.ts";
import { Library } from "../library/index.ts";
import { hangSide, persistClean, pieceView } from "./loop.ts";
import { closeAt, openRoot, pushSide } from "./session.ts";

const temps: string[] = [];

function tmpLibrary(): Library {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "intro-write-"));
  temps.push(root);
  return new Library(root);
}

afterEach(() => {
  for (const root of temps.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("M1 write loop on disk", () => {
  it("grows a nested rivet tree from clean text", () => {
    const lib = new Library(
      fs.mkdtempSync(path.join(os.tmpdir(), "intro-write-")),
    );
    temps.push(lib.root);

    const host = lib.createPiece({ id: "host01", body: "" });
    persistClean(lib, host.id, "宿主一段可以再挂侧边。");

    const first = hangSide(lib, host.id, { start: 0, end: 2 });
    assert.equal(strip(first.host.body), "宿主一段可以再挂侧边。");
    assert.equal(first.side.body, "");
    const hostTree = parse(lib.load("host01").body);
    assert.deepEqual(hostTree.damage, []);
    assert.equal(hostTree.rivets.length, 1);
    assert.equal(hostTree.rivets[0].to, first.side.id);
    assert.ok(fs.existsSync(first.side.path));

    persistClean(lib, first.side.id, "侧边再问一层。");
    const nested = hangSide(lib, first.side.id, { start: 0, end: 2 });
    const sideTree = parse(lib.load(first.side.id).body);
    assert.deepEqual(sideTree.damage, []);
    assert.equal(sideTree.rivets[0].to, nested.side.id);

    const view = pieceView(lib.load("host01"));
    assert.equal(view.clean, "宿主一段可以再挂侧边。");
    assert.equal(view.rivets[0].to, first.side.id);

    let columns = openRoot("host01");
    columns = pushSide(columns, 0, first.side.id, first.rivetId);
    columns = pushSide(columns, 1, nested.side.id, nested.rivetId);
    assert.equal(columns.length, 3);
    columns = closeAt(columns, 1);
    assert.deepEqual(
      columns.map((c) => c.pieceId),
      ["host01"],
    );
    assert.ok(lib.resolve(first.side.id));
    assert.ok(lib.resolve(nested.side.id));
    assert.match(lib.load("host01").body, /<<r id="/);
  });

  it("hangs an existing side without creating a new file", () => {
    const lib = tmpLibrary();
    lib.createPiece({ id: "host01", body: "abcdef" });
    lib.createPiece({ id: "reuse01", body: "already there" });
    const hung = hangSide(lib, "host01", { start: 1, end: 4 }, { sideId: "reuse01" });
    assert.equal(hung.side.id, "reuse01");
    assert.equal(hung.side.body, "already there");
    assert.equal(parse(hung.host.body).rivets[0].to, "reuse01");
    assert.equal(lib.list().length, 2);
  });

  it("keeps fitting rivets when clean text is only appended", () => {
    const lib = tmpLibrary();
    lib.createPiece({ id: "host01", body: "hello" });
    hangSide(lib, "host01", { start: 0, end: 5 });
    persistClean(lib, "host01", "hello world");
    const view = pieceView(lib.load("host01"));
    assert.equal(view.clean, "hello world");
    assert.equal(view.rivets.length, 1);
    assert.equal(view.rivets[0].start, 0);
    assert.equal(view.rivets[0].end, 5);
  });
});

describe("column session", () => {
  it("pushSide drops the deeper chain; closeAt keeps rivets off-screen", () => {
    const root = openRoot("a");
    const two = pushSide(root, 0, "b", "r1");
    const three = pushSide(two, 1, "c", "r2");
    const branch = pushSide(three, 0, "d", "r3");
    assert.deepEqual(
      branch.map((c) => c.pieceId),
      ["a", "d"],
    );
    assert.deepEqual(closeAt(three, 2).map((c) => c.pieceId), ["a", "b"]);
    assert.deepEqual(closeAt(three, 0), []);
  });
});
