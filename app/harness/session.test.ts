import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { assertScratchLibrary } from "./session.ts";

describe("harness library guard", () => {
  it("rejects a directory named paul", () => {
    assert.throws(() => assertScratchLibrary(path.join(os.tmpdir(), "paul")), /paul/);
  });

  it("rejects a path outside the temp directory unless the caller allows a copy", () => {
    assert.throws(() => assertScratchLibrary("/workspace"), /临时目录/);
    assert.equal(assertScratchLibrary("/workspace", true), path.resolve("/workspace"));
  });

  it("accepts a temp subdirectory", () => {
    const root = path.join(os.tmpdir(), "intro-ui-test");
    assert.equal(assertScratchLibrary(root), path.resolve(root));
  });
});
