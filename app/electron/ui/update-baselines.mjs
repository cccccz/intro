#!/usr/bin/env node
/**
 * Update local / cached visual baselines. Never git-add screenshot paths.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const argv = process.argv.slice(2);

const BANNED_RE =
  /(test-results|playwright-report|blob-report|playwright\/\.cache|\.ui-baselines|__screenshots__|-snapshots|explore-report|explore\/)/i;

function isBannedPath(p) {
  const n = p.replace(/\\/g, "/");
  if (BANNED_RE.test(n)) {
    return true;
  }
  return /\.(png|webm|zip)$/i.test(n) && /screenshot|baseline|snapshot|trace/i.test(n);
}

const joined = argv.join(" ");
const gitAdd = /\bgit\b/.test(joined) && /\badd\b/.test(joined);
if (gitAdd || argv.includes("add")) {
  const paths = argv.filter((a) => a !== "git" && a !== "add" && !a.startsWith("-"));
  if (paths.length === 0 || paths.some(isBannedPath)) {
    console.error("update-baselines: refusing git add of screenshot/baseline/report paths");
    process.exit(1);
  }
}

const playwrightCli = path.join(root, "node_modules", "@playwright", "test", "cli.js");
const result = spawnSync(
  process.execPath,
  [playwrightCli, "test", "--project=visual", "--update-snapshots"],
  { cwd: root, stdio: "inherit" },
);

const staged = spawnSync("git", ["diff", "--cached", "--name-only"], {
  cwd: root,
  encoding: "utf8",
});
if (staged.status === 0) {
  const bad = staged.stdout.split(/\r?\n/).filter((line) => line && isBannedPath(line));
  if (bad.length) {
    console.error("update-baselines: screenshot/report paths are staged; unstage them. Do not commit:");
    for (const line of bad) {
      console.error(`  ${line}`);
    }
    process.exit(1);
  }
}

console.error("Baselines stay in .ui-baselines (gitignored). Do not git add screenshots.");
process.exit(result.status ?? 1);
