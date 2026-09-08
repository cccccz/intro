import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Library } from '../library/index.ts';
import { addMark, strip, ulid } from '../marks/index.ts';
import { joinDoc, setMatterTitle } from '../library/frontmatter.ts';
import { addOverlayRivet, serializeOverlay } from '../pdf/overlay.ts';
import type { AiSelection, AiAnswer } from '../electron/renderer/ai-types.ts';

export function atomicWrite(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  try { fs.writeFileSync(tmp, content, { encoding: 'utf8', flag: 'wx' }); fs.renameSync(tmp, file); }
  finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
}
export function revision(lib: Library, hostId: string): string {
  const host = lib.load(hostId);
  const hash = createHash('sha256').update(fs.readFileSync(host.path));
  if (host.medium === 'pdf') {
    hash.update(fs.existsSync(host.overlayPath) ? fs.readFileSync(host.overlayPath) : '');
    const stat = fs.statSync(host.pdfPath);
    hash.update(`${stat.size}:${stat.mtimeMs}`);
  }
  return hash.digest('hex');
}
export type CommitPlan = { sideId: string; rivetId: string; hostId: string; root: string; before: string; after: string; hostPath: string; sourcePath: string; pdfStamp?: { path: string; size: number; mtimeMs: number }; sidePath: string; sideRaw: string };
export function prepareCommit(lib: Library, hostId: string, expectedRevision: string, selection: AiSelection, answer: AiAnswer): CommitPlan {
  if (revision(lib, hostId) !== expectedRevision) throw new Error('来源已变化，回答已保留。请重新选择来源。');
  if (!answer.markdown.trim() || /<<\/?r\b/.test(answer.markdown)) throw new Error('回答含无效正文或内部挂接标记');
  const host = lib.load(hostId);
  const sideId = ulid(), rivetId = ulid();
  let hostPath: string, after: string;
  if (host.medium === 'text' && selection.kind === 'text') {
    if (strip(host.body) !== selection.expected) throw new Error('选区原文已变化');
    const marked = addMark(host.body, selection, { id: rivetId, to: sideId });
    hostPath = host.path;
    after = joinDoc({ hasFrontmatter: host.matterLines.length > 0, matterLines: host.matterLines, body: marked });
  } else if (host.medium === 'pdf' && selection.kind === 'pdf') {
    hostPath = host.overlayPath;
    after = serializeOverlay(addOverlayRivet(host.overlay, { id: rivetId, to: sideId, anchors: selection.anchors }));
  } else throw new Error('选区类型与来源不一致');
  const pdfStamp = host.medium === 'pdf' ? { path: host.pdfPath, size: fs.statSync(host.pdfPath).size, mtimeMs: fs.statSync(host.pdfPath).mtimeMs } : undefined;
  return { sideId, rivetId, hostId, root: lib.root, hostPath, sourcePath: host.path, pdfStamp, before: fs.existsSync(hostPath) ? fs.readFileSync(hostPath, 'utf8') : '', after,
    sidePath: path.join(lib.root, `${sideId}.intro.md`),
    sideRaw: joinDoc({ hasFrontmatter: true, matterLines: setMatterTitle([], answer.title.slice(0, 200)), body: answer.markdown }) };
}
/** Caller must persist the plan in its job journal before applying it. Retry is idempotent. */
export function applyCommit(plan: CommitPlan): void {
  if (!fs.existsSync(plan.sourcePath)) throw new Error('来源已删除，回答未挂接');
  if (plan.pdfStamp) {
    const now = fs.statSync(plan.pdfStamp.path);
    if (now.size !== plan.pdfStamp.size || now.mtimeMs !== plan.pdfStamp.mtimeMs) throw new Error('PDF 来源已变化，回答未挂接');
  }
  const current = fs.existsSync(plan.hostPath) ? fs.readFileSync(plan.hostPath, 'utf8') : '';
  if (current !== plan.before && current !== plan.after) throw new Error('来源已变化，未覆盖。回答保留在 Codex 草稿中。');
  if (fs.existsSync(plan.sidePath)) {
    if (fs.readFileSync(plan.sidePath, 'utf8') !== plan.sideRaw) throw new Error('回答笔记已变化，未覆盖');
  } else atomicWrite(plan.sidePath, plan.sideRaw);
  if (current !== plan.after) atomicWrite(plan.hostPath, plan.after);
}
