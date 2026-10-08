import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

export type Finding = {
  scenario: string;
  file: string;
  kind: "missing" | "text" | "pixels";
  detail: string;
  diffPng?: Buffer;
};

const TEXT_KINDS: Array<[suffix: string, label: string]> = [
  ["calls.json", "IPC 调用"],
  ["disk.txt", "库文件"],
  ["errors.txt", "页面错误"],
  [".aria.yml", "无障碍树"],
  [".dom.txt", "DOM/布局"],
  [".storage.json", "localStorage"],
];

export class Comparer {
  private readonly browser: Browser;
  private readonly page: Page;
  private readonly tolerance: number;

  private constructor(browser: Browser, page: Page, tolerance: number) {
    this.browser = browser;
    this.page = page;
    this.tolerance = tolerance;
  }

  static async open(channel: string, pixelTolerance: number): Promise<Comparer> {
    const browser = await chromium.launch({ headless: true, channel, args: ["--no-sandbox"] });
    return new Comparer(browser, await browser.newPage(), pixelTolerance);
  }

  close(): Promise<void> {
    return this.browser.close();
  }

  /** Every file that differs between two capture trees, optionally limited to some scenarios. */
  async diff(baseDir: string, headDir: string, only?: ReadonlySet<string>): Promise<Finding[]> {
    const scenarios = [...new Set([...listDirs(baseDir), ...listDirs(headDir)])]
      .filter((name) => !only || only.has(name))
      .sort();
    const findings: Finding[] = [];
    for (const scenario of scenarios) {
      const a = path.join(baseDir, scenario);
      const b = path.join(headDir, scenario);
      for (const file of [...new Set([...listFiles(a), ...listFiles(b)])].sort()) {
        const fa = path.join(a, file);
        const fb = path.join(b, file);
        if (!fs.existsSync(fa) || !fs.existsSync(fb)) {
          findings.push({ scenario, file, kind: "missing", detail: fs.existsSync(fa) ? "只在 base" : "只在 head" });
        } else if (file.endsWith(".png")) {
          const px = await pixelDiff(this.page, fa, fb);
          if (px.size || px.count > this.tolerance) {
            findings.push({ scenario, file, kind: "pixels", detail: px.size ?? `${px.count} 个像素不同`, ...(px.png ? { diffPng: px.png } : {}) });
          }
        } else if (fs.readFileSync(fa, "utf8") !== fs.readFileSync(fb, "utf8")) {
          findings.push({ scenario, file, kind: "text", detail: unifiedDiff(fa, fb) });
        }
      }
    }
    return findings;
  }
}

export const findingKey = (f: Pick<Finding, "scenario" | "file">): string => `${f.scenario}/${f.file}`;

export function writeReport(opts: {
  reportDir: string;
  baseLabel: string;
  headLabel: string;
  scenarios: readonly string[];
  confirmed: readonly Finding[];
  unstable: readonly Finding[];
  failed: readonly string[];
}): string {
  fs.rmSync(opts.reportDir, { recursive: true, force: true });
  fs.mkdirSync(opts.reportDir, { recursive: true });
  const rows: string[] = [];
  const sections: string[] = [];
  for (const scenario of opts.scenarios) {
    const mine = opts.confirmed.filter((f) => f.scenario === scenario);
    const shaky = opts.unstable.filter((f) => f.scenario === scenario);
    const failed = opts.failed.filter((name) => name.endsWith(`/${scenario}`));
    const cells = [
      mine.length ? summarize(mine) : "一致",
      ...(shaky.length ? [`不稳定：${summarize(shaky)}`] : []),
      ...(failed.length ? [`未跑完：${failed.join("、")}`] : []),
    ];
    rows.push(`| ${scenario} | ${cells.join("；")} |`);
    if (!mine.length) continue;
    sections.push(`## ${scenario}\n`);
    for (const finding of mine) {
      sections.push(`### ${finding.file}（${labelOf(finding.file)}）\n`);
      if (finding.kind === "text") {
        sections.push("```diff\n" + finding.detail.trimEnd() + "\n```\n");
      } else if (finding.kind === "pixels") {
        const rel = `${scenario}/${finding.file.replace(/\.png$/, ".diff.png")}`;
        if (finding.diffPng) {
          fs.mkdirSync(path.join(opts.reportDir, scenario), { recursive: true });
          fs.writeFileSync(path.join(opts.reportDir, rel), finding.diffPng);
        }
        sections.push(`${finding.detail}。差异图：\`${rel}\`（红色为不同像素）\n`);
      } else {
        sections.push(`${finding.detail}\n`);
      }
    }
  }
  const report = [
    "# parity report",
    "",
    `base: ${opts.baseLabel}`,
    `head: ${opts.headLabel}`,
    "",
    "「一致」：两侧逐字节相同（截图逐像素）。「不稳定」：同一份 base 连跑两次也不同，或 head 重跑后与 base 相同；只提示，不算差异。",
    "",
    "| 场景 | 结果 |",
    "| --- | --- |",
    ...rows,
    "",
    ...sections,
    ...(opts.unstable.length
      ? ["## 不稳定的检查点", "", ...opts.unstable.map((f) => `- ${findingKey(f)}（${labelOf(f.file)}）：${f.kind === "text" ? "文本" : f.detail}`), ""]
      : []),
  ].join("\n");
  const file = path.join(opts.reportDir, "report.md");
  fs.writeFileSync(file, report);
  return file;
}

export function labelOf(file: string): string {
  if (file.endsWith(".png")) return "截图";
  return TEXT_KINDS.find(([suffix]) => file.endsWith(suffix))?.[1] ?? "文件";
}

function summarize(findings: readonly Finding[]): string {
  const counts = new Map<string, number>();
  for (const f of findings) counts.set(labelOf(f.file), (counts.get(labelOf(f.file)) ?? 0) + 1);
  return [...counts].map(([label, n]) => `${label} ×${n}`).join("，");
}

function listDirs(dir: string): string[] {
  return fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name) : [];
}

function listFiles(dir: string): string[] {
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => fs.statSync(path.join(dir, name)).isFile()) : [];
}

function unifiedDiff(a: string, b: string): string {
  const run = spawnSync("git", ["diff", "--no-index", "--no-color", "-U3", "--", a, b], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const text = run.stdout || run.stderr || "(git diff 无输出)";
  const lines = text.split("\n");
  return lines.length > 200 ? `${lines.slice(0, 200).join("\n")}\n…（共 ${lines.length} 行，截断）` : text;
}

async function pixelDiff(page: Page, a: string, b: string): Promise<{ count: number; size?: string; png?: Buffer }> {
  const toUrl = (file: string): string => `data:image/png;base64,${fs.readFileSync(file).toString("base64")}`;
  const result = await page.evaluate(async ([ua, ub]) => {
    const load = (src: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("image decode failed"));
      img.src = src;
    });
    const [ia, ib] = await Promise.all([load(ua), load(ub)]);
    if (ia.width !== ib.width || ia.height !== ib.height) {
      return { count: -1, size: `尺寸不同：${ia.width}x${ia.height} → ${ib.width}x${ib.height}`, png: "" };
    }
    const pixels = (img: HTMLImageElement): Uint8ClampedArray => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const g = canvas.getContext("2d")!;
      g.drawImage(img, 0, 0);
      return g.getImageData(0, 0, img.width, img.height).data;
    };
    const pa = pixels(ia);
    const pb = pixels(ib);
    const out = document.createElement("canvas");
    out.width = ia.width;
    out.height = ia.height;
    const g = out.getContext("2d")!;
    const image = g.createImageData(ia.width, ia.height);
    let count = 0;
    for (let i = 0; i < pa.length; i += 4) {
      const same = pa[i] === pb[i] && pa[i + 1] === pb[i + 1] && pa[i + 2] === pb[i + 2] && pa[i + 3] === pb[i + 3];
      if (same) {
        const grey = 200 + (pa[i]! + pa[i + 1]! + pa[i + 2]!) / 3 * 0.2;
        image.data[i] = image.data[i + 1] = image.data[i + 2] = grey;
      } else {
        count++;
        image.data[i] = 230; image.data[i + 1] = 20; image.data[i + 2] = 20;
      }
      image.data[i + 3] = 255;
    }
    if (count === 0) return { count, png: "" };
    g.putImageData(image, 0, 0);
    return { count, png: out.toDataURL("image/png") };
  }, [toUrl(a), toUrl(b)] as const);
  return {
    count: result.count,
    ...(result.size ? { size: result.size } : {}),
    ...(result.png ? { png: Buffer.from(result.png.split(",")[1]!, "base64") } : {}),
  };
}
