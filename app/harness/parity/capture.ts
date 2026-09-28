import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import { startHarness, type HarnessBackend } from "../server.ts";
import { domSignature } from "./dom-signature.ts";
import { IdNormalizer } from "./normalize.ts";
import type { Scenario, ScenarioContext } from "./scenarios.ts";

/** One checkout under test: its built renderer, its harness session (backend) and its preload stand-in. */
export type Side = {
  label: string;
  tree: string;
  rendererDir: string;
};

export type CaptureOptions = {
  side: Side;
  scenarios: readonly Scenario[];
  seedDir: string;
  /** Same absolute path for both sides, so paths shown in the UI match. */
  libRoot: string;
  out: string;
  channel: string;
};

const VIEWPORT = { width: 1280, height: 840 };
const API_QUIET_MS = 450;
const DOM_QUIET_MS = 250;
const QUIET_LIMIT_MS = 15_000;

type RawCheckpoint = { name: string; png: Buffer; aria: string; dom: string; storage: string };
type SessionClass = new (root: string, allowOutsideTemp?: boolean) => HarnessBackend;

async function loadSession(tree: string): Promise<SessionClass> {
  const file = path.join(tree, "app", "harness", "session.ts");
  if (!fs.existsSync(file)) throw new Error(`${tree} 没有 app/harness/session.ts；parity 需要 harness 之后的提交。`);
  const mod = await import(pathToFileURL(file).href) as { HarnessSession: SessionClass };
  return mod.HarnessSession;
}

export async function captureSide(opts: CaptureOptions): Promise<{ failed: string[] }> {
  const Session = await loadSession(opts.side.tree);
  const bridgePath = path.join(opts.side.tree, "app", "harness", "bridge.js");
  const browser = await chromium.launch({
    headless: true,
    channel: opts.channel,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none", "--disable-lcd-text", "--force-color-profile=srgb"],
  });
  const failed: string[] = [];
  try {
    for (const scenario of opts.scenarios) {
      const ok = await captureScenario(browser, Session, bridgePath, scenario, opts);
      if (!ok) failed.push(scenario.name);
    }
  } finally {
    await browser.close();
  }
  return { failed };
}

async function captureScenario(
  browser: Browser,
  Session: SessionClass,
  bridgePath: string,
  scenario: Scenario,
  opts: CaptureOptions,
): Promise<boolean> {
  fs.rmSync(opts.libRoot, { recursive: true, force: true });
  fs.cpSync(opts.seedDir, opts.libRoot, { recursive: true });
  const calls: Array<{ method: string; args: unknown[]; result: unknown }> = [];
  const session = new Session(opts.libRoot);
  const harness = await startHarness(opts.libRoot, {
    session,
    rendererDir: opts.side.rendererDir,
    bridgePath,
    onCall: (method, args, result) => { calls.push({ method, args, result }); },
  });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
    locale: "zh-CN",
    timezoneId: "UTC",
    colorScheme: "light",
  });
  context.setDefaultTimeout(10_000);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error" && !msg.text().startsWith("Failed to load resource")) errors.push(`console: ${msg.text()}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400) errors.push(`http ${response.status()} ${new URL(response.url()).pathname}`);
  });
  const traffic = trackApi(page);
  await page.addInitScript(() => {
    const w = window as unknown as { __parityLastMutation: number };
    w.__parityLastMutation = performance.now();
    new MutationObserver(() => { w.__parityLastMutation = performance.now(); })
      .observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    // Half-finished transitions make screenshots differ between identical builds.
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = "*,*::before,*::after{transition:none!important;animation:none!important}";
      document.head.append(style);
    });
  });

  const checkpoints: RawCheckpoint[] = [];
  const quiet = (): Promise<void> => waitQuiet(page, traffic);
  const ctx: ScenarioContext = {
    page,
    quiet,
    checkpoint: async (name) => {
      await quiet();
      const index = String(checkpoints.length + 1).padStart(2, "0");
      checkpoints.push({
        name: `${index}-${name}`,
        png: await page.screenshot({ animations: "disabled", caret: "hide", scale: "css" }),
        aria: await page.locator("body").ariaSnapshot(),
        dom: await page.evaluate(domSignature),
        storage: await page.evaluate(() => JSON.stringify(
          Object.keys(localStorage).sort().map((key) => [key, localStorage.getItem(key)]),
          null,
          1,
        )),
      });
    },
  };

  let failure: string | null = null;
  try {
    await page.goto(harness.url, { waitUntil: "domcontentloaded" });
    await page.locator("button.piece-open").first().waitFor({ timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
    await quiet();
    await scenario.run(ctx);
    await quiet();
  } catch (err) {
    failure = err instanceof Error ? err.stack ?? err.message : String(err);
    try {
      checkpoints.push({ name: "zz-failure", png: await page.screenshot(), aria: "", dom: await page.evaluate(domSignature), storage: "[]" });
    } catch { /* The page may already be gone. */ }
  } finally {
    await context.close();
    await harness.close();
  }

  const disk = dumpLibrary(opts.libRoot);
  const norm = new IdNormalizer([opts.libRoot, path.resolve(opts.libRoot)]);
  const callText = calls.map((call) => JSON.stringify(summarizeCall(call), null, 1));
  norm.normalizeAll(callText);
  for (const cp of checkpoints) norm.normalizeAll([cp.dom, cp.aria, cp.storage]);
  norm.normalizeAll([disk]);

  const dir = path.join(opts.out, scenario.name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "calls.json"), `[\n${callText.map((text) => norm.apply(text)).join(",\n")}\n]\n`);
  fs.writeFileSync(path.join(dir, "disk.txt"), norm.apply(disk));
  fs.writeFileSync(path.join(dir, "errors.txt"), norm.apply([...errors, ...(failure ? [`scenario failed: ${failure}`] : [])].join("\n")));
  for (const cp of checkpoints) {
    fs.writeFileSync(path.join(dir, `${cp.name}.png`), cp.png);
    fs.writeFileSync(path.join(dir, `${cp.name}.aria.yml`), norm.apply(cp.aria));
    fs.writeFileSync(path.join(dir, `${cp.name}.dom.txt`), norm.apply(cp.dom));
    fs.writeFileSync(path.join(dir, `${cp.name}.storage.json`), norm.apply(cp.storage));
  }
  return failure === null;
}

function summarizeCall(call: { method: string; args: unknown[]; result: unknown }): unknown {
  if (call.method === "readPdf") {
    const result = call.result as { ok?: boolean; data?: unknown[] };
    return { method: call.method, args: call.args, result: { ok: result.ok, bytes: Array.isArray(result.data) ? result.data.length : undefined } };
  }
  return call;
}

function trackApi(page: Page): { inflight: () => number; last: () => number } {
  let inflight = 0;
  let last = Date.now();
  const isApi = (url: string): boolean => new URL(url).pathname.startsWith("/api");
  page.on("request", (req) => { if (isApi(req.url())) { inflight++; last = Date.now(); } });
  const done = (req: { url(): string }): void => { if (isApi(req.url())) { inflight = Math.max(0, inflight - 1); last = Date.now(); } };
  page.on("requestfinished", done);
  page.on("requestfailed", done);
  return { inflight: () => inflight, last: () => last };
}

/** No IPC in flight or recently finished (covers the 350ms save debounce), no DOM mutation, then two frames. */
async function waitQuiet(page: Page, traffic: { inflight: () => number; last: () => number }): Promise<void> {
  const deadline = Date.now() + QUIET_LIMIT_MS;
  for (;;) {
    await page.waitForTimeout(60);
    const sinceMutation = await page.evaluate(() =>
      performance.now() - (window as unknown as { __parityLastMutation: number }).__parityLastMutation);
    if (traffic.inflight() === 0 && Date.now() - traffic.last() >= API_QUIET_MS && sinceMutation >= DOM_QUIET_MS) break;
    if (Date.now() > deadline) throw new Error("page did not settle within 15s");
  }
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined)))));
}

/** Every file under the library: text files verbatim, binaries by hash. Sorted by path. */
export function dumpLibrary(root: string): string {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push(full);
    }
  };
  if (fs.existsSync(root)) walk(root);
  const rel = (file: string): string => path.relative(root, file).split(path.sep).join("/");
  return files
    .sort((a, b) => rel(a).localeCompare(rel(b)))
    .map((file) => {
      const bytes = fs.readFileSync(file);
      const text = /\.(md|json|txt|ya?ml)$/i.test(file);
      const body = text
        ? bytes.toString("utf8")
        : `(binary ${bytes.length} bytes sha256 ${createHash("sha256").update(bytes).digest("hex")})`;
      return `=== ${rel(file)}\n${body}${body.endsWith("\n") ? "" : "\n"}`;
    })
    .join("");
}
