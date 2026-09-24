/**
 * Drive the real reading page and leave screenshots plus an accessibility tree.
 *
 *   npm run ui:drive
 *   npm run ui:drive -- --steps app/harness/examples/chain.json --out app/harness/artifacts/latest
 *
 * Steps are JSON: openPiece, clickText, click, scroll, screenshot, aria, wait.
 * Screenshots are evidence. Pass/fail for design rules lives in reading.e2e.ts.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";
import { ANCHOR_A, ANCHOR_C, ANCHOR_D, seedReadingLibrary } from "./fixture.ts";
import { startHarness } from "./server.ts";
import { assertScratchLibrary } from "./session.ts";

export type DriveStep =
  | { do: "openPiece"; title: string }
  | { do: "clickText"; selector: string; text: string }
  | { do: "click"; selector: string }
  | { do: "scroll"; selector: string; to?: "start" | "end" }
  | { do: "screenshot"; name: string }
  | { do: "aria"; name: string; selector?: string }
  | { do: "wait"; selector: string };

export const defaultTour: DriveStep[] = [
  { do: "screenshot", name: "01-library" },
  { do: "openPiece", title: "宿主" },
  { do: "screenshot", name: "02-host" },
  { do: "clickText", selector: '.body-rendered mark[data-rivet]', text: ANCHOR_A },
  { do: "screenshot", name: "03-depth-1" },
  { do: "clickText", selector: '.column[data-depth="1"] .body-rendered mark[data-rivet]', text: ANCHOR_C },
  { do: "clickText", selector: '.column[data-depth="2"] .body-rendered mark[data-rivet]', text: ANCHOR_D },
  { do: "wait", selector: '.column[data-depth="3"]' },
  { do: "screenshot", name: "04-chain" },
  { do: "aria", name: "04-chain", selector: "#board" },
];

export async function openReadingPage(url: string): Promise<{ page: Page; errors: string[]; close: () => Promise<void> }> {
  const channel = process.env.INTRO_BROWSER_CHANNEL || "chrome";
  const browser = await chromium.launch({
    headless: true,
    channel,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 840 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.locator("button.piece-open", { hasText: "宿主" }).waitFor({ timeout: 15000 });
  if (errors.length) throw new Error(errors.join("\n"));
  return {
    page,
    errors,
    close: async () => {
      await browser.close();
    },
  };
}

export async function runSteps(page: Page, steps: DriveStep[], outDir: string): Promise<string[]> {
  fs.mkdirSync(outDir, { recursive: true });
  const written: string[] = [];
  for (const step of steps) {
    if (step.do === "openPiece") {
      await page.locator("button.piece-open", { hasText: step.title }).click();
      await page.locator(`.column[data-depth="0"]`).waitFor();
    } else if (step.do === "clickText") {
      await page.locator(step.selector, { hasText: step.text }).first().click();
    } else if (step.do === "click") {
      await page.locator(step.selector).first().click();
    } else if (step.do === "scroll") {
      await page.locator(step.selector).first().evaluate((el, to) => {
        el.scrollTop = to === "start" ? 0 : el.scrollHeight;
      }, step.to ?? "end");
      await settle(page);
    } else if (step.do === "wait") {
      await page.locator(step.selector).first().waitFor();
    } else if (step.do === "screenshot") {
      const file = path.join(outDir, `${step.name}.png`);
      await page.screenshot({ path: file });
      written.push(file);
    } else if (step.do === "aria") {
      const file = path.join(outDir, `${step.name}.aria.yml`);
      fs.writeFileSync(file, await page.locator(step.selector ?? "#board").ariaSnapshot());
      written.push(file);
    }
    if (step.do === "click" || step.do === "clickText" || step.do === "openPiece") await settle(page);
  }
  return written;
}

export async function settle(page: Page): Promise<void> {
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined)));
  }));
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const allow = process.argv.includes("--allow-library");
  const given = arg("--library");
  const stepsPath = arg("--steps");
  if (given && !stepsPath) {
    throw new Error("打开已有副本时必须提供 --steps。默认巡览只用于临时合成库。");
  }
  const root = given ? assertScratchLibrary(given, allow) : seedReadingLibrary();
  const outDir = path.resolve(arg("--out") ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "artifacts", "latest"));
  const steps = stepsPath
    ? JSON.parse(fs.readFileSync(stepsPath, "utf8")) as DriveStep[]
    : defaultTour;
  const harness = await startHarness(root, allow);
  const opened = await openReadingPage(harness.url);
  try {
    const written = await runSteps(opened.page, steps, outDir);
    if (opened.errors.length) throw new Error(opened.errors.join("\n"));
    process.stdout.write(`${JSON.stringify({ url: harness.url, library: root, outDir, written }, null, 2)}\n`);
  } finally {
    await opened.close();
    await harness.close();
  }
}

const isCli = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  main().catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
}
