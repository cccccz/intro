import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';

type Candidate = { bin: string; version: number[] };
const minimum = [0, 153, 4];
function compare(a: number[], b: number[]): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
}
export function supportedVersion(output: string): number[] | null {
  const match = output.trim().match(/^codex-cli (\d+)\.(\d+)\.(\d+)(?:[-+][^\s]+)?(?:\s|$)/);
  if (!match) return null;
  const version = match.slice(1, 4).map(Number);
  return compare(version, minimum) >= 0 ? version : null;
}
function inspect(bin: string): Promise<string> {
  return new Promise((resolve, reject) => execFile(bin, ['--version'], { windowsHide: true, timeout: 5000, maxBuffer: 8192 }, (error, stdout) => error ? reject(error) : resolve(stdout)));
}
export async function chooseRuntime(candidates: string[], probe = inspect): Promise<string> {
  const results = await Promise.all(candidates.map(async bin => {
    try { const version = supportedVersion(await probe(bin)); return version ? { bin, version } : null; }
    catch { return null; }
  }));
  const compatible = results.filter((c): c is Candidate => c !== null);
  compatible.sort((a, b) => compare(b.version, a.version));
  if (!compatible.length) throw new Error('未找到兼容的 Codex CLI（需要 0.153.4 或更新版本）。请更新 Codex，或用 INTRO_CODEX_BIN 指定 codex.exe。');
  return compatible[0]!.bin;
}
export function runtimeCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  const candidates = new Set<string>();
  const add = (file: string): void => { if (fs.existsSync(file) && fs.statSync(file).isFile()) candidates.add(file); };
  const envPath = Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1] || '';
  for (const folder of envPath.split(path.delimiter).filter(Boolean)) add(path.join(folder.replace(/^"|"$/g, ''), process.platform === 'win32' ? 'codex.exe' : 'codex'));
  if (process.platform === 'win32') {
    const localRoots = new Set([env.LOCALAPPDATA, path.join(os.homedir(), 'AppData', 'Local')].filter((p): p is string => Boolean(p)));
    for (const local of localRoots) {
      const roots = [path.join(local, 'OpenAI', 'Codex', 'bin'), path.join(local, 'Packages', 'OpenAI.Codex_2p2nqsd0c76g0', 'LocalCache', 'Local', 'OpenAI', 'Codex', 'bin')];
      for (const root of roots) {
        try {
          add(path.join(root, 'codex.exe'));
          for (const entry of fs.readdirSync(root, { withFileTypes: true })) if (entry.isDirectory()) add(path.join(root, entry.name, 'codex.exe'));
        } catch { /* An optional desktop installation need not exist or be accessible. */ }
      }
    }
  }
  return [...candidates];
}
export async function resolveCodexRuntime(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  if (env.INTRO_CODEX_BIN) {
    try { return await chooseRuntime([env.INTRO_CODEX_BIN]); }
    catch { throw new Error('INTRO_CODEX_BIN 指定的程序不存在或版本不兼容。请指向 0.153.4 或更新版本的 codex.exe。'); }
  }
  return chooseRuntime(runtimeCandidates(env));
}
