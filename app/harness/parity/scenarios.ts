/**
 * Parity scenarios: the same user actions run against two builds. Each checkpoint records screenshot,
 * accessibility tree, DOM signature and localStorage; the run records every IPC call and the library on disk.
 *
 * Scenarios use today's selectors. When a refactor renames a selector on purpose, change the scenario in the
 * same commit and expect that scenario to differ once.
 */
import type { Locator, Page } from "playwright";
import { ANCHOR_A, ANCHOR_B, ANCHOR_C, ANCHOR_D, SIDE_A, SIDE_B } from "../fixture.ts";

export type ScenarioContext = {
  page: Page;
  checkpoint: (name: string) => Promise<void>;
  quiet: () => Promise<void>;
};

export type Scenario = {
  name: string;
  run: (ctx: ScenarioContext) => Promise<void>;
};

async function openPiece(ctx: ScenarioContext, title: string): Promise<void> {
  await ctx.page.locator("button.piece-open", { hasText: title }).first().click();
  await ctx.page.locator('.column[data-depth="0"]').waitFor();
  await ctx.quiet();
}

async function clickMark(ctx: ScenarioContext, depth: number, text: string): Promise<void> {
  await ctx.page.locator(`.column[data-depth="${depth}"] .body-rendered mark[data-rivet]`, { hasText: text }).first().click();
  await ctx.quiet();
}

async function menu(ctx: ScenarioContext, label: string): Promise<void> {
  await ctx.page.locator(".ctx-menu [role=menuitem]", { hasText: label }).first().click();
  await ctx.quiet();
}

/** Select `text` in a source editor and open the body context menu without moving the selection. */
async function contextOnSelection(ctx: ScenarioContext, editor: Locator, text: string): Promise<void> {
  await editor.evaluate((node, wanted) => {
    const area = node as HTMLTextAreaElement;
    const start = area.value.indexOf(wanted);
    if (start < 0) throw new Error(`text not in editor: ${wanted}`);
    area.focus();
    area.setSelectionRange(start, start + wanted.length);
    const box = area.getBoundingClientRect();
    area.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: box.x + 40, clientY: box.y + 40 }));
  }, text);
  await ctx.quiet();
}

async function contextOn(ctx: ScenarioContext, target: Locator): Promise<void> {
  await target.first().click({ button: "right", position: { x: 20, y: 12 } });
  await ctx.quiet();
}

async function toSource(ctx: ScenarioContext, depth: number): Promise<Locator> {
  await contextOn(ctx, ctx.page.locator(`.column[data-depth="${depth}"] .body-rendered`));
  await menu(ctx, "Source");
  return ctx.page.locator(`.column[data-depth="${depth}"] textarea.editor`).first();
}

function card(ctx: ScenarioContext, pieceId: string): Locator {
  return ctx.page.locator(`article.card[data-piece-id="${pieceId}"]`);
}

async function openPdf(ctx: ScenarioContext): Promise<void> {
  await ctx.page.locator("button.piece-open", { hasText: "outline-book" }).click();
  await ctx.page.waitForFunction(() => {
    const btn = document.querySelector<HTMLButtonElement>(".pdf-outline-btn");
    return btn?.textContent === "Outline" && !btn.disabled && document.querySelector(".pdf-page canvas");
  });
  await ctx.quiet();
}

export const scenarios: Scenario[] = [
  {
    name: "library-start",
    run: async (ctx) => {
      await ctx.checkpoint("start");
    },
  },
  {
    name: "chain-rendered",
    run: async (ctx) => {
      await openPiece(ctx, "宿主");
      await ctx.checkpoint("host");
      await clickMark(ctx, 0, ANCHOR_A);
      await ctx.checkpoint("depth-1");
      await clickMark(ctx, 1, ANCHOR_C);
      await clickMark(ctx, 2, ANCHOR_D);
      await ctx.checkpoint("chain");
      await ctx.page.locator("nav[aria-label='阅读层级'] button", { hasText: "←" }).click();
      await ctx.quiet();
      await ctx.checkpoint("window-back");
      await clickMark(ctx, 0, ANCHOR_A);
      await ctx.checkpoint("close-by-mark");
    },
  },
  {
    name: "same-depth-stack",
    run: async (ctx) => {
      await openPiece(ctx, "宿主");
      await clickMark(ctx, 0, ANCHOR_A);
      await clickMark(ctx, 0, ANCHOR_B);
      await ctx.checkpoint("stacked");
      await card(ctx, SIDE_A).hover();
      await ctx.quiet();
      await ctx.checkpoint("hot-card");
    },
  },
  {
    name: "pin-offscreen",
    run: async (ctx) => {
      await openPiece(ctx, "宿主");
      await clickMark(ctx, 0, ANCHOR_A);
      await card(ctx, SIDE_A).locator("button.side-pin").click();
      await ctx.quiet();
      await ctx.page.locator('.column[data-depth="0"] .body-rendered').evaluate((el) => { el.scrollTop = el.scrollHeight; });
      await ctx.quiet();
      await ctx.checkpoint("pinned-scrolled");
      await card(ctx, SIDE_A).locator("button.side-pin").click();
      await ctx.quiet();
      await ctx.checkpoint("unpinned-hint");
      await ctx.page.locator('section.column[data-depth="1"] .offscreen-hints button').first().click();
      await ctx.quiet();
      await ctx.checkpoint("revealed");
    },
  },
  {
    name: "source-mode-and-menu",
    run: async (ctx) => {
      await openPiece(ctx, "宿主");
      await contextOn(ctx, ctx.page.locator('.column[data-depth="0"] .body-rendered'));
      await ctx.checkpoint("body-menu");
      await menu(ctx, "Source");
      await ctx.checkpoint("source");
      await ctx.page.locator('.column[data-depth="0"] .rivets button.rivet').first().click();
      await ctx.quiet();
      await ctx.checkpoint("source-with-side");
    },
  },
  {
    name: "new-side-and-type",
    run: async (ctx) => {
      await openPiece(ctx, "宿主");
      const editor = await toSource(ctx, 0);
      await contextOnSelection(ctx, editor, "阅读填充。阅读填充。");
      await menu(ctx, "New side");
      await ctx.page.locator('.column[data-depth="1"] textarea.editor').waitFor();
      await ctx.quiet();
      await ctx.checkpoint("new-side");
      await ctx.page.locator('.column[data-depth="1"] textarea.editor').focus();
      await ctx.page.keyboard.type("新侧注的第一行 $x^2$");
      await ctx.quiet();
      await ctx.checkpoint("typed");
    },
  },
  {
    name: "hang-existing",
    run: async (ctx) => {
      await openPiece(ctx, "宿主");
      const editor = await toSource(ctx, 0);
      await contextOnSelection(ctx, editor, "第 2 段");
      await menu(ctx, "Hang existing…");
      await ctx.page.locator("dialog.piece-picker").waitFor();
      await ctx.quiet();
      await ctx.checkpoint("picker");
      await ctx.page.locator("dialog.piece-picker input[type=search]").fill("第三层");
      await ctx.quiet();
      await ctx.checkpoint("picker-filtered");
      await ctx.page.locator("dialog.piece-picker .piece-picker-list button").first().click();
      await ctx.quiet();
      await ctx.checkpoint("hung");
    },
  },
  {
    name: "rename-close-detach",
    run: async (ctx) => {
      await openPiece(ctx, "宿主");
      await clickMark(ctx, 0, ANCHOR_A);
      await card(ctx, SIDE_A).locator("button.card-more").click();
      await ctx.quiet();
      await ctx.checkpoint("card-menu");
      await menu(ctx, "Rename");
      await ctx.page.locator("dialog.piece-picker input").fill("改过的名字");
      await ctx.checkpoint("rename-dialog");
      await ctx.page.locator("dialog.piece-picker button[type=submit]").click();
      await ctx.quiet();
      await ctx.checkpoint("renamed");
      await card(ctx, SIDE_A).locator("button.card-more").click();
      await menu(ctx, "Close");
      await ctx.checkpoint("closed");
      await clickMark(ctx, 0, ANCHOR_A);
      await card(ctx, SIDE_A).locator("button.card-more").click();
      await menu(ctx, "解除挂接");
      await ctx.checkpoint("detached");
    },
  },
  {
    name: "delete-note",
    run: async (ctx) => {
      ctx.page.on("dialog", (dialog) => { void dialog.accept(); });
      await openPiece(ctx, "宿主");
      await clickMark(ctx, 0, ANCHOR_B);
      await card(ctx, SIDE_B).locator("button.card-more").click();
      await menu(ctx, "删除笔记");
      await ctx.checkpoint("deleted");
    },
  },
  {
    name: "sidebar",
    run: async (ctx) => {
      await ctx.page.locator("#piece-filter").fill("层");
      await ctx.quiet();
      await ctx.checkpoint("filtered");
      await ctx.page.locator("#piece-filter").fill("");
      await ctx.quiet();
      const fold = ctx.page.locator("#piece-list button.piece-fold").first();
      if (await fold.count()) {
        await fold.click();
        await ctx.quiet();
      }
      await ctx.checkpoint("folded");
      await contextOn(ctx, ctx.page.locator("#piece-list button.piece-open").first());
      await ctx.checkpoint("row-menu");
      await ctx.page.keyboard.press("Escape");
      await ctx.page.locator("#btn-hide-pieces").click();
      await ctx.quiet();
      await ctx.checkpoint("hidden");
    },
  },
  {
    name: "column-resize",
    run: async (ctx) => {
      await openPiece(ctx, "宿主");
      await clickMark(ctx, 0, ANCHOR_A);
      const splitter = ctx.page.locator('.column[data-depth="1"] ~ .col-splitter, .col-splitter').last();
      const box = await splitter.boundingBox();
      if (box) {
        await ctx.page.mouse.move(box.x + box.width / 2, box.y + 200);
        await ctx.page.mouse.down();
        await ctx.page.mouse.move(box.x + box.width / 2 - 120, box.y + 200, { steps: 6 });
        await ctx.page.mouse.up();
        await ctx.quiet();
      }
      await ctx.checkpoint("column-narrowed");
      const resize = card(ctx, SIDE_A).locator(".card-resize");
      const edge = await resize.boundingBox();
      if (edge) {
        await ctx.page.mouse.move(edge.x + 40, edge.y + edge.height / 2);
        await ctx.page.mouse.down();
        await ctx.page.mouse.move(edge.x + 40, edge.y - 150, { steps: 6 });
        await ctx.page.mouse.up();
        await ctx.quiet();
      }
      await ctx.checkpoint("card-shortened");
    },
  },
  {
    name: "pdf-host",
    run: async (ctx) => {
      await openPdf(ctx);
      await ctx.checkpoint("opened");
      const host = ctx.page.locator('.column[data-depth="0"]');
      await host.locator("button[title='Zoom in']").click();
      await ctx.quiet();
      await ctx.checkpoint("zoomed");
      await host.locator(".pdf-page-jump input").fill("5");
      await host.locator(".pdf-page-jump input").press("Enter");
      await ctx.quiet();
      await host.locator(".pdf-outline-btn").click();
      await ctx.quiet();
      await ctx.checkpoint("outline");
      await ctx.page.keyboard.press("Escape");
      await ctx.quiet();
      await host.locator("button", { hasText: /^Rivets/ }).click();
      await ctx.quiet();
      await ctx.checkpoint("rivets-drawer");
    },
  },
  {
    name: "pdf-new-side",
    run: async (ctx) => {
      await openPdf(ctx);
      const overlay = ctx.page.locator('.pdf-page[data-page="1"] .pdf-overlay');
      const box = await overlay.boundingBox();
      if (!box) throw new Error("page 1 overlay not laid out");
      await ctx.page.mouse.move(box.x + 60, box.y + 60);
      await ctx.page.mouse.down();
      await ctx.page.mouse.move(box.x + 260, box.y + 140, { steps: 8 });
      await ctx.page.mouse.up();
      await ctx.quiet();
      await ctx.checkpoint("region");
      await ctx.page.mouse.click(box.x + 150, box.y + 100, { button: "right" });
      await ctx.quiet();
      await ctx.checkpoint("region-menu");
      await menu(ctx, "New side");
      await ctx.page.locator('.column[data-depth="1"]').waitFor();
      await ctx.quiet();
      await ctx.checkpoint("pdf-side");
    },
  },
  {
    name: "ai-dialog",
    run: async (ctx) => {
      await openPiece(ctx, "宿主");
      await clickMark(ctx, 0, ANCHOR_A);
      await card(ctx, SIDE_A).locator("button", { hasText: "AI…" }).click();
      await ctx.quiet();
      await ctx.checkpoint("ai-menu");
      await menu(ctx, "向这篇笔记提问");
      await ctx.checkpoint("ask-dialog");
      await ctx.page.keyboard.press("Escape");
      await ctx.quiet();
      await ctx.checkpoint("dismissed");
    },
  },
];
