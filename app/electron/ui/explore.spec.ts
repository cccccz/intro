import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { closeIntro, launchIntro, repoRoot } from "./helpers";

const DIALOG_IDS = new Set(["btn-open", "btn-open-pdf"]);
const SKIP_IDS = new Set(["btn-codex", ...DIALOG_IDS]);

type EnumeratedButton = {
  id: string;
  text: string;
  disabled: boolean;
};

function seedNumber(raw: string): number {
  const asNum = Number(raw);
  if (Number.isFinite(asNum)) {
    return asNum >>> 0;
  }
  let h = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed || 1;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], rand: () => number): T[] {
  const next = items.slice();
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

test("explore: click a few enabled buttons and write report.json", async () => {
  const seed = process.env.INTRO_EXPLORE_SEED ?? "1";
  const maxClicks = Math.max(1, Number(process.env.INTRO_EXPLORE_MAX_CLICKS ?? "3") || 3);
  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-s${seed}`;
  const outDir = path.join(repoRoot, "test-results", "explore", runId);
  fs.mkdirSync(outDir, { recursive: true });

  const startedAt = new Date().toISOString();
  const clicked: { id: string; text: string; ok: boolean; error?: string }[] = [];
  let enumerated: EnumeratedButton[] = [];
  let session: Awaited<ReturnType<typeof launchIntro>> | undefined;
  let launchError: string | undefined;

  try {
    session = await launchIntro({ library: true });
    const page = session.window;
    await page.locator("#workspace").waitFor({ state: "visible" });

    enumerated = await page.locator("button").evaluateAll((buttons) =>
      buttons.map((btn) => ({
        id: btn.id,
        text: (btn.textContent ?? "").trim(),
        disabled: (btn as HTMLButtonElement).disabled,
      })),
    );

    const rand = mulberry32(seedNumber(seed));
    const candidates = shuffle(
      enumerated.filter((b) => b.id && !b.disabled && !SKIP_IDS.has(b.id)),
      rand,
    ).slice(0, maxClicks);

    for (const btn of candidates) {
      try {
        await page.locator(`#${btn.id}`).click({ timeout: 5000 });
        clicked.push({ id: btn.id, text: btn.text, ok: true });
        await page.waitForTimeout(200);
      } catch (err) {
        clicked.push({ id: btn.id, text: btn.text, ok: false, error: String(err) });
      }
    }
  } catch (err) {
    launchError = String(err);
    throw err;
  } finally {
    const report = {
      runId,
      seed,
      startedAt,
      finishedAt: new Date().toISOString(),
      ok: !launchError,
      launchError: launchError ?? null,
      pageErrors: session?.pageErrors ?? [],
      enumerated,
      clicked,
      skippedIds: [...SKIP_IDS],
      library: "temp",
      notes: "Did not click Open library / Open PDF (native dialogs) or Codex (network).",
    };
    fs.writeFileSync(path.join(outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    await closeIntro(session);
  }

  expect(fs.existsSync(path.join(outDir, "report.json"))).toBe(true);
});
