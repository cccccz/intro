import fs from 'node:fs';
import { Library } from '../library/index.ts';
import { add, parse, strip, flattenRivetSpecs } from '../marks/index.ts';
import { joinDoc } from '../library/frontmatter.ts';
import { revision, atomicWrite } from './commit.ts';

export type RevisionPlan = { file: string; before: string; after: string };
export function prepareRevision(lib: Library, id: string, expectedRevision: string, markdown: string): RevisionPlan {
  if (revision(lib, id) !== expectedRevision) throw new Error('笔记已变化，未覆盖。修改稿仍保留。');
  const host = lib.load(id);
  if (host.medium !== 'text') throw new Error('只能改进文本笔记');
  if (!markdown.trim() || /<<\/?r\b/.test(markdown)) throw new Error('修改稿含无效正文或内部标记');
  const parsed = parse(host.body); if (parsed.damage.length) throw new Error('原笔记挂接标记损坏，未覆盖');
  const clean = strip(host.body);
  const anchors = flattenRivetSpecs(parsed.rivets).map(spec => {
    if (markdown === clean) return spec;
    const excerpt = clean.slice(spec.start, spec.end);
    const start = markdown.indexOf(excerpt);
    if (start < 0 || markdown.indexOf(excerpt, start + 1) !== -1) throw new Error('修改稿改写了子 side 的来源，或来源重复而无法定位。请保留原片段，或复制修改稿另存笔记。');
    return { ...spec, start, end: start + excerpt.length };
  });
  const after = joinDoc({ hasFrontmatter: host.matterLines.length > 0, matterLines: host.matterLines, body: add(markdown, anchors) });
  return { file: host.path, before: fs.readFileSync(host.path, 'utf8'), after };
}
export function applyRevision(plan: RevisionPlan, undo = false): void {
  const current = fs.readFileSync(plan.file, 'utf8');
  const expected = undo ? plan.after : plan.before, next = undo ? plan.before : plan.after;
  if (current === next) return;
  if (current !== expected) throw new Error('笔记在此之后已被编辑，未覆盖。');
  atomicWrite(plan.file, next);
}
