import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { ANCHOR_A, ANCHOR_B, ANCHOR_C, ANCHOR_D, seedReadingLibrary, SIDE_A } from "./fixture.ts";
import { openReadingPage, runSteps, settle, type DriveStep } from "./drive.ts";
import { startHarness, type HarnessServer } from "./server.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const goldenPath = path.join(here, "goldens", "chain.aria.yml");
// Git may check the golden out with CRLF on Windows.
const lf = (text: string): string => text.replace(/\r\n/g, "\n");

describe("reading navigation", { timeout: 180_000 }, () => {
  let root = "";
  let harness: HarnessServer;

  before(async () => {
    root = seedReadingLibrary();
    harness = await startHarness(root);
  });

  after(async () => {
    await harness.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("shows one depth column at a time window of three", async () => {
    const opened = await openReadingPage(harness.url);
    const out = fs.mkdtempSync(path.join(root, "shots-"));
    try {
      const steps: DriveStep[] = [
        { do: "openPiece", title: "宿主" },
        { do: "clickText", selector: ".body-rendered mark[data-rivet]", text: ANCHOR_A },
        { do: "clickText", selector: '.column[data-depth="1"] .body-rendered mark[data-rivet]', text: ANCHOR_C },
        { do: "clickText", selector: '.column[data-depth="2"] .body-rendered mark[data-rivet]', text: ANCHOR_D },
        { do: "wait", selector: '.column[data-depth="3"]' },
        { do: "screenshot", name: "chain" },
      ];
      const written = await runSteps(opened.page, steps, out);
      assert.equal(fs.readFileSync(written[0]!).subarray(0, 8).toString("hex"), "89504e470d0a1a0a");

      const columns = await opened.page.locator("section.column").evaluateAll((nodes) => nodes.map((node) => ({
        depth: (node as HTMLElement).dataset.depth ?? "",
        hidden: (node as HTMLElement).hidden,
      })));
      assert.deepEqual(columns.map((column) => column.depth), ["0", "1", "2", "3"]);
      assert.deepEqual(columns.filter((column) => !column.hidden).map((column) => column.depth), ["1", "2", "3"]);
      assert.equal(await opened.page.locator("#wires").getAttribute("aria-hidden"), "true");
      assert.equal(await opened.page.getByRole("navigation", { name: "阅读层级" }).count(), 1);
      assert.equal(await opened.page.getByText("图谱", { exact: true }).count(), 0);

      const aria = await opened.page.locator("#board").ariaSnapshot();
      if (process.env.INTRO_UI_REFRESH === "1") {
        fs.mkdirSync(path.dirname(goldenPath), { recursive: true });
        fs.writeFileSync(goldenPath, aria);
      }
      assert.equal(fs.existsSync(goldenPath), true, "missing golden; rerun with INTRO_UI_REFRESH=1");
      assert.equal(lf(aria).trim(), lf(fs.readFileSync(goldenPath, "utf8")).trim());
      assert.deepEqual(opened.errors, []);
    } finally {
      await opened.close();
    }
  });

  it("stacks same-depth sides in one column", async () => {
    const opened = await openReadingPage(harness.url);
    try {
      await runSteps(opened.page, [
        { do: "openPiece", title: "宿主" },
        { do: "clickText", selector: ".body-rendered mark[data-rivet]", text: ANCHOR_A },
        { do: "clickText", selector: ".body-rendered mark[data-rivet]", text: ANCHOR_B },
      ], fs.mkdtempSync(path.join(root, "shots-")));
      assert.equal(await opened.page.locator('section.column[data-depth="1"]').count(), 1);
      assert.equal(await opened.page.locator('section.column[data-depth="1"] article.card').count(), 2);
      assert.deepEqual(opened.errors, []);
    } finally {
      await opened.close();
    }
  });

  it("hides an unpinned side when its source scrolls away and keeps a pinned side", async () => {
    const opened = await openReadingPage(harness.url);
    const page = opened.page;
    try {
      await runSteps(page, [
        { do: "openPiece", title: "宿主" },
        { do: "clickText", selector: ".body-rendered mark[data-rivet]", text: ANCHOR_A },
      ], fs.mkdtempSync(path.join(root, "shots-")));
      const card = page.locator(`article.card[data-piece-id="${SIDE_A}"]`);
      await card.locator("button.side-pin").click();
      await settle(page);
      await page.locator('.column[data-depth="0"] .body-rendered').evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      await settle(page);
      assert.equal(await card.evaluate((el) => (el as HTMLElement).hidden), false);

      await card.locator("button.side-pin").click();
      await settle(page);
      assert.equal(await card.evaluate((el) => (el as HTMLElement).hidden), true);
      assert.equal(await page.locator('section.column[data-depth="1"]').evaluate((el) => (el as HTMLElement).hidden), false);
      assert.deepEqual(opened.errors, []);
    } finally {
      await opened.close();
    }
  });
});
