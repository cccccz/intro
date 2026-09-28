/**
 * Refactor parity: run the same scenarios against two checkouts and report every difference in IPC calls,
 * library files, accessibility tree, DOM/layout, localStorage and screenshots.
 *
 *   npm run parity                         # working tree vs HEAD (one refactor step before committing)
 *   npm run parity -- --base main          # whole branch vs main
 *   npm run parity -- --base HEAD~3 --head HEAD --only chain-rendered,pdf-host
 *   npm run parity -- --list
 *
 * Both sides use their own renderer build, app/harness/session.ts (library + write code) and bridge.js.
 * Libraries are synthetic copies in the temp directory; the harness refuses a library named paul.
 * Screenshots are compared on this machine only and never committed.
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { seedReadingLibrary } from "../fixture.ts";
import { captureSide, type Side } from "./capture.ts";
import { compareCaptures } from "./compare.ts";
import { scenarios } from "./scenarios.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");

type Args = { base: string; head: string | null; only: string[] | null; out: string; tolerance: number; keep: boolean; list: boolean };

function parseArgs(argv: readonly string[]): Args {
  const value = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    base: value("--base") ?? "HEAD",
    head: value("--head") ?? null,
    only: value("--only")?.split(",").map((s) => s.trim()).filter(Boolean) ?? null,
    out: path.resolve(value("--out") ?? path.join(repo, "app", "harness", "artifacts", "parity")),
    tolerance: Number(value("--pixel-tolerance") ?? "0"),
    keep: argv.includes("--keep"),
    list: argv.includes("--list"),
  };
}

function git(args: readonly string[], cwd = repo): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function run(cmd: string, args: readonly string[], cwd: string): void {
  const result = spawnSync(cmd, args, { cwd, stdio: ["ignore", "inherit", "inherit"] });
  if (result.status !== 0) throw new Error(`${cmd} ${args.join(" ")} 失败（${cwd}）`);
}

/** Check out `ref` into a detached worktree that shares this checkout's node_modules. */
function checkout(ref: string, into: string): string {
  const sha = git(["rev-parse", "--verify", `${ref}^{commit}`]);
  git(["worktree", "add", "--detach", "--force", into, sha]);
  const modules = path.join(into, "node_modules");
  if (!fs.existsSync(modules)) fs.symlinkSync(path.join(repo, "node_modules"), modules, "junction");
  const lockHere = path.join(repo, "package-lock.json");
  const lockThere = path.join(into, "package-lock.json");
  if (fs.existsSync(lockThere) && fs.readFileSync(lockHere, "utf8") !== fs.readFileSync(lockThere, "utf8")) {
    process.stderr.write(`注意：${ref} 的 package-lock.json 与当前不同，两侧共用当前 node_modules。\n`);
  }
  return sha;
}

function build(tree: string): string {
  run(process.execPath, [path.join(repo, "node_modules", "typescript", "bin", "tsc"), "-p", path.join(tree, "app", "electron", "renderer", "tsconfig.json")], tree);
  run(process.execPath, [path.join(tree, "app", "electron", "copy-static.mjs")], tree);
  return path.join(tree, "app", "dist", "electron", "renderer");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.list) {
    for (const s of scenarios) process.stdout.write(`${s.name}\n`);
    return;
  }
  const chosen = args.only ? scenarios.filter((s) => args.only!.includes(s.name)) : scenarios;
  const unknown = args.only?.filter((name) => !scenarios.some((s) => s.name === name)) ?? [];
  if (unknown.length) throw new Error(`没有这些场景：${unknown.join(", ")}（--list 查看）`);
  const channel = process.env.INTRO_BROWSER_CHANNEL || "msedge";

  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "intro-parity-"));
  const worktrees: string[] = [];
  try {
    const baseTree = path.join(runDir, "base-tree");
    const baseSha = checkout(args.base, baseTree);
    worktrees.push(baseTree);
    let headTree = repo;
    let headLabel = "working tree";
    if (args.head) {
      headTree = path.join(runDir, "head-tree");
      headLabel = checkout(args.head, headTree);
      worktrees.push(headTree);
    } else if (git(["status", "--porcelain", "--untracked-files=no"])) {
      headLabel = "working tree（含未提交改动）";
    }
    process.stdout.write(`base ${args.base} = ${baseSha.slice(0, 10)}；head = ${headLabel}\n`);
    const sides: Side[] = [
      { label: "base", tree: baseTree, rendererDir: build(baseTree) },
      { label: "head", tree: headTree, rendererDir: build(headTree) },
    ];

    const seedDir = seedReadingLibrary(fs.mkdtempSync(path.join(runDir, "seed-")));
    const libRoot = path.join(runDir, "library");
    fs.rmSync(args.out, { recursive: true, force: true });
    const failed: string[] = [];
    for (const side of sides) {
      process.stdout.write(`采集 ${side.label}（${chosen.length} 个场景）…\n`);
      const result = await captureSide({ side, scenarios: chosen, seedDir, libRoot, out: path.join(args.out, side.label), channel });
      failed.push(...result.failed.map((name) => `${side.label}/${name}`));
    }
    const { findings } = await compareCaptures({
      baseDir: path.join(args.out, "base"),
      headDir: path.join(args.out, "head"),
      reportDir: path.join(args.out, "report"),
      channel,
      pixelTolerance: args.tolerance,
    });
    const report = path.join(args.out, "report", "report.md");
    if (failed.length) process.stdout.write(`场景未跑完：${failed.join(", ")}（见各自 errors.txt）\n`);
    if (findings.length === 0 && failed.length === 0) {
      process.stdout.write(`一致：${chosen.length} 个场景没有差异。报告 ${report}\n`);
    } else {
      const byScenario = new Map<string, number>();
      for (const f of findings) byScenario.set(f.scenario, (byScenario.get(f.scenario) ?? 0) + 1);
      for (const [name, n] of byScenario) process.stdout.write(`  ${name}: ${n} 处差异\n`);
      process.stdout.write(`有差异。报告 ${report}\n`);
      process.exitCode = 1;
    }
  } finally {
    if (!args.keep) {
      for (const tree of worktrees) {
        // Unlink the shared node_modules first so no recursive delete can reach the real one.
        const modules = path.join(tree, "node_modules");
        if (fs.lstatSync(modules, { throwIfNoEntry: false })?.isSymbolicLink()) fs.unlinkSync(modules);
        try { git(["worktree", "remove", "--force", tree]); } catch { /* Pruned below. */ }
      }
      git(["worktree", "prune"]);
      fs.rmSync(runDir, { recursive: true, force: true });
    } else {
      process.stdout.write(`保留临时目录 ${runDir}（git worktree prune 可清理）\n`);
    }
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exitCode = 1;
});
