import type { RivetSpec } from "../marks/types.ts";

export type TextEdit = { start: number; end: number; text: string };
export type EditBatch = { expected: string; edits: TextEdit[] };

/** Conservative fallback for callers without an input-event history. */
export function singleEdit(before: string, after: string): TextEdit {
  let start = 0, end = before.length, tail = after.length;
  while (start < end && start < tail && before[start] === after[start]) start++;
  while (end > start && tail > start && before[end - 1] === after[tail - 1]) { end--; tail--; }
  return { start, end, text: after.slice(start, tail) };
}

export function relocateAnchors(before: string, after: string, specs: readonly RivetSpec[], batch?: EditBatch): RivetSpec[] {
  if (batch && batch.expected !== before) throw new Error("原文已变化，未覆盖保存。请保留当前编辑后重新载入。");
  const edits = batch?.edits ?? [singleEdit(before, after)];
  let text = before;
  let result = specs.map(s => ({ ...s }));
  for (const edit of edits) {
    const { start, end } = edit;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > text.length || typeof edit.text !== "string") throw new Error("编辑范围无效，未保存。");
    const delta = edit.text.length - (end - start);
    result = result.map(spec => {
      if (spec.end <= start) return spec;
      if (spec.start >= end) return { ...spec, start: spec.start + delta, end: spec.end + delta };
      if (spec.start <= start && end <= spec.end && spec.end + delta > spec.start)
        return { ...spec, end: spec.end + delta };
      throw new Error("本次修改删除或跨越了 side 的来源，未保存。请撤销这次修改，先解除对应挂接再编辑；side 笔记会保留。");
    });
    text = text.slice(0, start) + edit.text + text.slice(end);
  }
  if (text !== after) throw new Error("编辑记录与正文不一致，未保存。");
  return result;
}
