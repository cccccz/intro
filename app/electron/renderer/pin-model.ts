import { mathSelection } from "./math-anchors.ts";
export type TextAnchor = { start: number; end: number; quote: string; before: string; after: string };

export function textAnchor(source: string, start: number, end: number): TextAnchor {
  return { start, end, quote: source.slice(start, end), before: source.slice(Math.max(0, start - 40), start), after: source.slice(end, end + 40) };
}

/** Exact matches only; ambiguity is surfaced instead of silently changing sources. */
export function locateText(source: string, anchor: TextAnchor): { start: number; end: number } | null {
  if (!anchor.quote) return null;
  const matches: number[] = [];
  let at = source.indexOf(anchor.quote);
  while (at !== -1) { matches.push(at); at = source.indexOf(anchor.quote, at + 1); }
  if (matches.length === 1) return { start: matches[0], end: matches[0] + anchor.quote.length };
  const contextual = matches.filter(start => source.slice(Math.max(0, start - anchor.before.length), start) === anchor.before && source.slice(start + anchor.quote.length, start + anchor.quote.length + anchor.after.length) === anchor.after);
  return contextual.length === 1 ? { start: contextual[0], end: contextual[0] + anchor.quote.length } : null;
}

/** Mark rendered top-level blocks with source ranges; no HTML is persisted. */
export function mapRenderedBlocks(pane: HTMLElement, source: string): void {
  const factory = (globalThis as unknown as { markdownit?: (options: object) => { parse: (source: string, env: object) => Array<{ level: number; map?: [number, number] | null; nesting: number }> } }).markdownit;
  if (!factory) return;
  const lines = source.split("\n");
  const offsets = [0];
  for (const line of lines) offsets.push(offsets[offsets.length - 1] + line.length + 1);
  const blocks = factory({ html: false }).parse(source, {}).filter(token => token.level === 0 && token.map && token.nesting !== -1);
  // Custom math may change block count. In that case source matching is used alone.
  if (blocks.length !== pane.children.length) return;
  blocks.forEach((block, index) => {
    const element = pane.children[index] as HTMLElement;
    element.dataset.sourceStart = String(offsets[block.map![0]]);
    element.dataset.sourceEnd = String(Math.min(source.length, offsets[block.map![1]]));
  });
}

export function renderedSelection(pane: HTMLElement, source: string): { start: number; end: number; expanded: boolean } | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0).cloneRange();
  if (!pane.contains(range.startContainer) || !pane.contains(range.endContainer)) return null;
  const mathematical = mathSelection(range);
  if (mathematical) return mathematical;
  const elementOf = (node: Node): Element | null => node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
  const mathOf = (node: Node): Element | null => elementOf(node)?.closest(".katex-display, .katex") ?? null;
  const firstMath = mathOf(range.startContainer);
  const lastMath = mathOf(range.endContainer);
  if (firstMath) range.setStartBefore(firstMath.closest(".katex-display") ?? firstMath);
  if (lastMath) range.setEndAfter(lastMath.closest(".katex-display") ?? lastMath);
  const copy = document.createElement("div");
  copy.append(range.cloneContents());
  copy.querySelectorAll(".katex-display, .katex").forEach(math => {
    if (!copy.contains(math)) return;
    const tex = math.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
    if (tex !== undefined && tex !== null) math.replaceWith(document.createTextNode(`${math.classList.contains("katex-display") ? "$$" : "$"}${tex}${math.classList.contains("katex-display") ? "$$" : "$"}`));
  });
  const quote = copy.textContent ?? "";
  const blocks = Array.from(pane.children).filter(block => range.intersectsNode(block)) as HTMLElement[];
  const start = Number(blocks[0]?.dataset.sourceStart);
  const end = Number(blocks[blocks.length - 1]?.dataset.sourceEnd);
  const mapped = Number.isFinite(start) && Number.isFinite(end);
  const region = mapped ? source.slice(start, end) : source;
  const offset = quote ? region.indexOf(quote) : -1;
  if (offset >= 0 && region.indexOf(quote, offset + 1) === -1) return { start: (mapped ? start : 0) + offset, end: (mapped ? start : 0) + offset + quote.length, expanded: Boolean(firstMath || lastMath) };
  return mapped && end > start ? { start, end, expanded: true } : null;
}
