import { escapeHtml, wrapRivets, type RivetRange } from "./highlight.ts";

export type MathRenderer = (tex: string, displayMode: boolean) => string;

type Katex = {
  renderToString(
    tex: string,
    opts?: { displayMode?: boolean; throwOnError?: boolean },
  ): string;
};

/** Read-oriented fallback when KaTeX is not loaded. TeX stays escaped text. */
export function fallbackMath(tex: string, displayMode: boolean): string {
  const cls = displayMode ? ' class="tex display"' : ' class="tex"';
  const tag = displayMode ? "div" : "span";
  return `<${tag}${cls}>${escapeHtml(tex)}</${tag}>`;
}

function globalKatex(): Katex | undefined {
  return (globalThis as { katex?: Katex }).katex;
}

/** KaTeX when present (writer shell); otherwise the fallback span/div. */
export function katexMath(tex: string, displayMode: boolean): string {
  const katex = globalKatex();
  if (!katex) {
    return fallbackMath(tex, displayMode);
  }
  try {
    return katex.renderToString(tex, { displayMode, throwOnError: false });
  } catch {
    return fallbackMath(tex, displayMode);
  }
}

const MATH_RE = /\$\$([\s\S]+?)\$\$|\$([^$\n]+)\$/g;

function inlineMd(escaped: string): string {
  const codes: string[] = [];
  let html = escaped.replace(/`([^`]+)`/g, (_m, code: string) => {
    codes.push(`<code>${code}</code>`);
    return `\u0000C${codes.length - 1}\u0000`;
  });
  html = html.replace(
    /^(#{1,3}) (.+)$/gm,
    (_m, hashes: string, title: string) =>
      `<strong class="h${hashes.length}">${title}</strong>`,
  );
  html = html.replace(/^[-*] (.+)$/gm, '<span class="li">$1</span>');
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>");
  return html.replace(/\u0000C(\d+)\u0000/g, (_m, i: string) => codes[Number(i)] ?? "");
}

export function markupInline(text: string, math: MathRenderer = fallbackMath): string {
  let html = "";
  let cursor = 0;
  MATH_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MATH_RE.exec(text))) {
    if (match.index > cursor) {
      html += inlineMd(escapeHtml(text.slice(cursor, match.index)));
    }
    const display = match[1] !== undefined;
    html += math(display ? match[1] : match[2]!, display);
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) {
    html += inlineMd(escapeHtml(text.slice(cursor)));
  }
  return html;
}

/**
 * Rendered body of the same clean text the source textarea edits.
 * Rivet marks stay so wires / viewport hide still read `rivetId → rects`.
 */
export function renderHtml(
  clean: string,
  rivets: readonly RivetRange[] = [],
  openIds: readonly string[] = [],
  math: MathRenderer = fallbackMath,
): string {
  return wrapRivets(clean, rivets, openIds, (slice) => markupInline(slice, math));
}
