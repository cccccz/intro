import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { parse, strip } from "../marks/index.ts";
import { Library } from "../library/index.ts";
import { hangSide, persistClean, pieceView } from "./loop.ts";
import {
  ROOT_ID,
  closeNode,
  nodesAtDepth,
  openRoot,
  openSide,
} from "./session.ts";

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
    columns = openSide(columns, ROOT_ID, first.side.id, first.rivetId);
    columns = openSide(columns, first.rivetId, nested.side.id, nested.rivetId);
    assert.equal(columns.length, 3);
    columns = closeNode(columns, first.rivetId);
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

  it("two host rivets stack at d1; hanging from one side opens d2", () => {
    const lib = tmpLibrary();
    lib.createPiece({ id: "host01", body: "alpha beta" });
    const a = hangSide(lib, "host01", { start: 0, end: 5 });
    const b = hangSide(lib, "host01", { start: 6, end: 10 });
    persistClean(lib, a.side.id, "from alpha");
    const nested = hangSide(lib, a.side.id, { start: 0, end: 4 });
    const host = parse(lib.load("host01").body);
    assert.equal(host.rivets.length, 2);
    let nodes = openRoot("host01");
    nodes = openSide(nodes, ROOT_ID, a.side.id, a.rivetId);
    nodes = openSide(nodes, ROOT_ID, b.side.id, b.rivetId);
    nodes = openSide(nodes, a.rivetId, nested.side.id, nested.rivetId);
    assert.equal(nodesAtDepth(nodes, 1).length, 2);
    assert.deepEqual(
      nodesAtDepth(nodes, 2).map((n) => n.pieceId),
      [nested.side.id],
    );
  });
});

describe("open session", () => {
  it("stacks same-depth sides and opens the next depth from a side", () => {
    const root = openRoot("a");
    const one = openSide(root, ROOT_ID, "b", "r1");
    const stacked = openSide(one, ROOT_ID, "c", "r2");
    assert.deepEqual(
      stacked.map((n) => [n.pieceId, n.depth]),
      [
        ["a", 0],
        ["b", 1],
        ["c", 1],
      ],
    );
    const nested = openSide(stacked, "r1", "d", "r3");
    assert.equal(nodesAtDepth(nested, 1).length, 2);
    assert.deepEqual(
      nodesAtDepth(nested, 2).map((n) => n.pieceId),
      ["d"],
    );
    assert.deepEqual(openSide(nested, "r1", "d", "r3").map((n) => n.id), nested.map((n) => n.id));
  });

  it("closeNode drops the subtree and leaves a same-layer sibling", () => {
    const stacked = openSide(openSide(openRoot("a"), ROOT_ID, "b", "r1"), ROOT_ID, "c", "r2");
    const nested = openSide(stacked, "r1", "d", "r3");
    assert.deepEqual(
      closeNode(nested, "r1").map((n) => n.pieceId),
      ["a", "c"],
    );
    assert.deepEqual(closeNode(nested, ROOT_ID), []);
  });
});
