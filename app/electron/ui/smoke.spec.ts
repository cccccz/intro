import { expect, test } from "@playwright/test";
import {
  assertNotFormalLibrary,
  closeIntro,
  isFormalLibraryPath,
  launchIntro,
  type IntroSession,
} from "./helpers";

test("helpers refuse the formal paul library path", () => {
  expect(isFormalLibraryPath("C:\\Users\\Zheng\\Desktop\\paul")).toBe(true);
  expect(isFormalLibraryPath("/Users/Zheng/Desktop/paul")).toBe(true);
  expect(() => assertNotFormalLibrary("/tmp/intro-backups/x/paul")).toThrow(/paul/);
  expect(isFormalLibraryPath("/tmp/intro-ui-abc/library")).toBe(false);
});

test.describe.serial("S0 window smoke (no library)", () => {
  let session: IntroSession | undefined;

  test.beforeAll(async () => {
    session = await launchIntro();
  });

  test.afterAll(async () => {
    await closeIntro(session);
  });

  test("S0-1 launches without crash and yields firstWindow", async () => {
    if (!session) {
      throw new Error("Electron session missing");
    }
    const { window, app, pageErrors } = session;
    expect(window.isClosed()).toBe(false);
    await expect(window.locator("header strong")).toHaveText("intro");
    await expect(window.locator("#workspace")).toBeVisible();
    const windows = app.windows();
    expect(windows.length).toBeGreaterThanOrEqual(1);
    expect(pageErrors).toEqual([]);
  });

  test("S0-2 empty chrome without a library: #sidebar-empty and .empty-main", async () => {
    if (!session) {
      throw new Error("Electron session missing");
    }
    const { window } = session;
    await expect(window.locator("#lib-path")).toHaveText(/No library open/);
    const sidebarEmpty = window.locator("#sidebar-empty");
    await expect(sidebarEmpty).toHaveCount(1);
    await expect(sidebarEmpty).toHaveText(/Open a folder to start/);
    // renderer hides #sidebar-empty until a library is open (`hidden = !state.root`).
    await expect(window.locator(".empty-main")).toBeVisible();
    await expect(window.locator(".empty-main")).toHaveText(/Open a local library folder to write/);
  });

  test("S0-3 dragging #split-sidebar changes the sidebar width", async () => {
    if (!session) {
      throw new Error("Electron session missing");
    }
    const { window } = session;
    const sidebar = window.locator("#sidebar");
    const splitter = window.locator("#split-sidebar");
    await expect(splitter).toBeVisible();
    const before = await sidebar.evaluate((el) => parseFloat(getComputedStyle(el).width));
    const box = await splitter.boundingBox();
    if (!box) {
      throw new Error("#split-sidebar has no bounding box");
    }
    const startX = box.x + box.width / 2;
    const startY = box.y + Math.max(box.height / 2, 8);
    await window.mouse.move(startX, startY);
    await window.mouse.down();
    await window.mouse.move(startX + 80, startY, { steps: 8 });
    await window.mouse.up();
    const after = await sidebar.evaluate((el) => parseFloat(getComputedStyle(el).width));
    expect(after).toBeGreaterThan(before + 20);
  });
});
