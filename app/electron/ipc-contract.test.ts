import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * The renderer API is written out by hand in api.ts, renderer.ts, preload.cjs, main.ts and the browser
 * harness (bridge.js, session.ts). Until they share one definition, method names must agree everywhere.
 */
const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string): string => fs.readFileSync(path.join(app, rel), "utf8");
const EVENTS = new Set(["onAiRead", "onLibraryOpened", "onMenuCommand"]);

function block(text: string, opener: string): string {
  const start = text.indexOf(opener);
  assert.notEqual(start, -1, `missing ${opener}`);
  let depth = 0;
  for (let i = text.indexOf("{", start); i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  throw new Error(`unclosed ${opener}`);
}

function topKeys(body: string): string[] {
  return [...body.matchAll(/^ {2}(\w+)\s*[:(]/gm)].map((m) => m[1]!);
}

function ipcMap(body: string): Map<string, string> {
  return new Map([...body.matchAll(/(\w+):\s*"([^"]+)"/g)].map((m) => [m[1]!, m[2]!]));
}

const sorted = (items: Iterable<string>): string[] => [...new Set(items)].sort();

describe("IPC contract copies", () => {
  const api = read("electron/api.ts");
  const preload = read("electron/preload.cjs");
  const ipc = ipcMap(block(api, "export const IPC"));
  const channels = sorted(ipc.keys());

  it("preload uses the same channel names as api.ts", () => {
    assert.deepEqual([...ipcMap(block(preload, "const IPC")).entries()].sort(), [...ipc.entries()].sort());
  });

  it("every invoke method in IntroApi has a channel", () => {
    const methods = topKeys(block(api, "export type IntroApi")).filter((k) => !EVENTS.has(k));
    assert.deepEqual(sorted(methods), channels);
  });

  it("the renderer's inlined IntroApi lists the same methods as api.ts", () => {
    assert.deepEqual(
      sorted(topKeys(block(read("electron/renderer/renderer.ts"), "type IntroApi"))),
      sorted(topKeys(block(api, "export type IntroApi"))),
    );
  });

  it("main.ts handles every channel", () => {
    const handled = [...read("electron/main.ts").matchAll(/ipcMain\.handle\(\s*IPC\.(\w+)/g)].map((m) => m[1]!);
    assert.deepEqual(sorted(handled), channels);
  });

  it("the harness bridge exposes what preload exposes", () => {
    const exposed = sorted(topKeys(block(preload, 'exposeInMainWorld("intro"')));
    assert.deepEqual(sorted(topKeys(block(read("harness/bridge.js"), "window.intro ="))), exposed);
    assert.deepEqual(exposed.filter((k) => !EVENTS.has(k)), channels);
  });

  it("the harness session answers every channel", () => {
    const cases = [...read("harness/session.ts").matchAll(/case "(\w+)":/g)].map((m) => m[1]!);
    assert.deepEqual(sorted(cases), channels);
  });
});
