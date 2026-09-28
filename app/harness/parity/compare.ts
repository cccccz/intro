import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";

export type CompareOptions = {
  baseDir: string;
  headDir: string;
  reportDir: string;
  channel: string;
  /** Differing pixels allowed per screenshot. Same machine, same browser: expect 0. */
  pixelTolerance: number;
};

export type Finding = { scenario: string; file: string; kind: "missing" | "text" | "pixels"; detail: string };

const TEXT_KINDS: Array<[suffix: string, label: string]> = [
  ["calls.json", "IPC 调用"],
  ["disk.txt", "库文件"],
  ["errors.txt", "页面错误"],
  [".aria.yml", "无障碍树"],
  [".dom.txt", "DOM/布局"],
  [".storage.json", "localStorage"],
];

export async function compareCaptures(opts: CompareOptions): Promise<{ findings: Finding[]; report: string }> {
  fs.rmSync(opts.reportDir, { recursive: true, force: true });
  fs.mkdirSync(opts.reportDir, { recursive: true });
  const scenarios = [...new Set([...listDirs(opts.baseDir), ...listDirs(opts.headDir)])].sort();
  const findings: Finding[] = [];
  const sections: string[] = [];
  const rows: string[] = [];
  const browser = await chromium.launch({ headless: true, channel: opts.channel, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  try {
    for (const scenario of scenarios) {
      const a = path.join(opts.baseDir, scenario);
      const b = path.join(opts.headDir, scenario);
      const files = [...new Set([...listFiles(a), ...listFiles(b)])].sort();
      const local: Finding[] = [];
      for (const file of files) {
        const fa = path.join(a, file);
        const fb = path.join(b, file);
        if (!fs.existsSync(fa) || !fs.existsSync(fb)) {
          local.push({ scenario, file, kind: "missing", detail: fs.existsSync(fa) ? "只在 base" : "只在 head" });
          continue;
        }
        if (file.endsWith(".png")) {
          const diff = await pixelDiff(page, fa, fb);
          if (diff.size || diff.count > opts.pixelTolerance) {
            const out = path.join(opts.reportDir, scenario, file.replace(/\.png$/, ".diff.png"));
            fs.mkdirSync(path.dirname(out), { recursive: true });
            if (diff.png) fs.writeFileSync(out, diff.png);
            local.push({ scenario, file, kind: "pixels", detail: diff.size ?? `${diff.count} 个像素不同` });
          }
          continue;
        }
        const ta = fs.readFileSync(fa, "utf8");
        const tb = fs.readFileSync(fb, "utf8");
        if (ta !== tb) local.push({ scenario, file, kind: "text", detail: unifiedDiff(fa, fb) });
      }
      findings.push(...local);
      rows.push(`| ${scenario} | ${local.length === 0 ? "一致" : summarize(local)} |`);
      if (local.length) {
        sections.push(`## ${scenario}\n`);
        for (const finding of local) {
          sections.push(`### ${finding.file}（${labelOf(finding.file)}）\n`);
          if (finding.kind === "text") sections.push("```diff\n" + finding.detail.trimEnd() + "\n```\n");
          else if (finding.kind === "pixels") sections.push(`${finding.detail}。差异图：\`${scenario}/${finding.file.replace(/\.png$/, ".diff.png")}\`（红色为不同像素）\n`);
          else sections.push(`${finding.detail}\n`);
        }
      }
    }
  } finally {
    await browser.close();
  }
  const report = [
    "# parity report",
    "",
    `base: \`${opts.baseDir}\``,
    `head: \`${opts.headDir}\``,
    "",
    "| 场景 | 结果 |",
    "| --- | --- |",
    ...rows,
    "",
    ...sections,
  ].join("\n");
  fs.writeFileSync(path.join(opts.reportDir, "report.md"), report);
  return { findings, report };
}

function labelOf(file: string): string {
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
