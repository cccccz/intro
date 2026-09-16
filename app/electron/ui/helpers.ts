import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));

export const repoRoot = path.resolve(here, "../../..");
export const electronBinary = require("electron") as string;

export type TempWorkspace = {
  root: string;
  userData: string;
  library: string;
};

export type IntroSession = {
  app: ElectronApplication;
  window: Page;
  paths: TempWorkspace;
  pageErrors: string[];
};

export function isFormalLibraryPath(p: string): boolean {
  const normalized = path.resolve(p).replace(/\\/g, "/").toLowerCase();
  if (normalized.includes("/desktop/paul")) {
    return true;
  }
  if (normalized.includes("/intro-backups/") && /\/paul(\/|$)/.test(normalized)) {
    return true;
  }
  return path.posix.basename(normalized) === "paul";
}

export function assertNotFormalLibrary(p: string): void {
  if (isFormalLibraryPath(p)) {
    throw new Error(`Refusing formal library path (paul): ${p}`);
  }
}

export function makeTempWorkspace(): TempWorkspace {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "intro-ui-"));
  const tmp = os.tmpdir().replace(/\\/g, "/").toLowerCase();
  const resolved = path.resolve(root).replace(/\\/g, "/").toLowerCase();
  if (!resolved.startsWith(tmp) || !path.basename(root).startsWith("intro-ui-")) {
    throw new Error(`Refusing to use non-temp workspace: ${root}`);
  }
  assertNotFormalLibrary(root);
  const userData = path.join(root, "userData");
  const library = path.join(root, "library");
  fs.mkdirSync(userData);
  fs.mkdirSync(library);
  assertNotFormalLibrary(library);
  assertNotFormalLibrary(userData);
  return { root, userData, library };
}

export function cleanupTemp(root: string): void {
  const tmp = os.tmpdir().replace(/\\/g, "/").toLowerCase();
  const resolved = path.resolve(root).replace(/\\/g, "/").toLowerCase();
  if (!resolved.startsWith(tmp) || !path.basename(root).startsWith("intro-ui-")) {
    throw new Error(`Refusing to delete non-temp workspace: ${root}`);
  }
  assertNotFormalLibrary(root);
  fs.rmSync(root, { recursive: true, force: true });
}

export type LaunchOptions = {
  /** false/undefined: no --library (empty chrome). true: temp empty library. string: that path. */
  library?: boolean | string;
  extraArgs?: string[];
};

export async function launchIntro(opts: LaunchOptions = {}): Promise<IntroSession> {
  const paths = makeTempWorkspace();
  const args = [repoRoot, `--user-data-dir=${paths.userData}`];
  if (process.platform === "linux") {
    args.push("--no-sandbox", "--disable-dev-shm-usage");
  }
  if (opts.library === true) {
    args.push("--library", paths.library);
  } else if (typeof opts.library === "string") {
    assertNotFormalLibrary(opts.library);
    args.push("--library", path.resolve(opts.library));
  }
  if (opts.extraArgs) {
    for (const arg of opts.extraArgs) {
      if (!arg.startsWith("-") && fs.existsSync(arg)) {
        assertNotFormalLibrary(arg);
      }
      args.push(arg);
    }
  }

  const pageErrors: string[] = [];
  const app = await electron.launch({
    executablePath: electronBinary,
    args,
    cwd: repoRoot,
    timeout: 60_000,
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
    },
  });
  app.on("window", (page) => {
    page.on("pageerror", (err) => {
      pageErrors.push(String(err));
    });
  });
  const window = await app.firstWindow();
  window.on("pageerror", (err) => {
    pageErrors.push(String(err));
  });
  await window.waitForLoadState("domcontentloaded");
  return { app, window, paths, pageErrors };
}

export async function closeIntro(session: IntroSession | undefined): Promise<void> {
  if (!session) {
    return;
  }
  try {
    await session.app.close();
  } catch {
    /* already exited */
  }
  cleanupTemp(session.paths.root);
}
