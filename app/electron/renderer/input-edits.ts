export type TextEdit = { start: number; end: number; text: string };
export type EditBatch = { expected: string; edits: TextEdit[] };
export type InputChange = { before: string; after: string; edit: TextEdit };

/** Use the actual caret/selection to disambiguate repeated text. */
export function inputChange(before: string, after: string, start: number, end: number, inputType: string): InputChange {
  if (start === end && inputType.startsWith("delete")) {
    const count = before.length - after.length;
    if (inputType.endsWith("Backward")) start = Math.max(0, start - count);
    else end = Math.min(before.length, end + count);
  }
  let length = after.length - before.length + end - start;
  if (length < 0 || before.slice(0, start) + after.slice(start, start + length) + before.slice(end) !== after) {
    start = 0; end = before.length; let tail = after.length;
    while (start < end && start < tail && before[start] === after[start]) start++;
    while (end > start && tail > start && before[end - 1] === after[tail - 1]) { end--; tail--; }
    length = tail - start;
  }
  return { before, after, edit: { start, end, text: after.slice(start, start + length) } };
}

export function batchTo(changes: readonly InputChange[], before: string, after: string): EditBatch | undefined {
  if (before === after) return { expected: before, edits: [] };
  // Latest matching chain handles undo/redo without reusing stale events.
  for (let i = changes.length - 1; i >= 0; i--) {
    if (changes[i].before !== before) continue;
    let current = before;
    const edits: TextEdit[] = [];
    for (const change of changes.slice(i)) {
      if (change.before !== current) break;
      edits.push(change.edit); current = change.after;
      if (current === after) return { expected: before, edits };
    }
  }
  return undefined;
}
