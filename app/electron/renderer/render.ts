import { escapeHtml, rivetBounds, type RivetRange } from "./highlight.ts";

export type MathRenderer = (tex: string, displayMode: boolean, sourceStart?: number) => string;

type Katex = {
  renderToString(
    tex: string,
    opts?: { displayMode?: boolean; throwOnError?: boolean },
  ): string;
};

type MdToken = {
  type: string;
  content: string;
  markup?: string;
  block?: boolean;
  map?: [number, number] | null;
  meta?: { display?: boolean; relativeStart?: number; sourceStart?: number };
  children?: MdToken[];
};

type MdInlineState = {
  src: string;
  pos: number;
  posMax: number;
  push: (type: string, tag: string, nesting: number) => MdToken;
};

type MdBlockState = {
  src: string;
  bMarks: number[];
  eMarks: number[];
  tShift: number[];
  sCount: number[];
  blkIndent: number;
  line: number;
  push: (type: string, tag: string, nesting: number) => MdToken;
  getLines: (begin: number, end: number, indent: number, keepLastLF: boolean) => string;
};

type MarkdownIt = {
  core: { ruler: { after: (name: string, rule: string, fn: (state: { tokens: MdToken[] }) => void) => void } };
  render: (src: string) => string;
  disable: (rules: string | string[]) => MarkdownIt;
  block: {
    ruler: {
      before: (
        beforeName: string,
        ruleName: string,
        fn: (state: MdBlockState, start: number, end: number, silent: boolean) => boolean,
        options?: { alt?: string[] },
      ) => void;
    };
  };
  inline: {
    ruler: {
      before: (
        beforeName: string,
        ruleName: string,
        fn: (state: MdInlineState, silent: boolean) => boolean,
      ) => void;
    };
  };
  renderer: {
    rules: Record<string, (tokens: MdToken[], idx: number) => string>;
  };
};

export type MarkdownItFactory = (opts?: Record<string, unknown>) => MarkdownIt;

let markdownItFactory: MarkdownItFactory | undefined;

/** Tests inject the CJS/ESM export; the writer shell uses the vendored global. */
export function setMarkdownIt(factory: MarkdownItFactory): void {
  markdownItFactory = factory;
}

function resolveMarkdownIt(): MarkdownItFactory | undefined {
  if (markdownItFactory) {
    return markdownItFactory;
  }
  const fromGlobal = (globalThis as { markdownit?: MarkdownItFactory }).markdownit;
  return typeof fromGlobal === "function" ? fromGlobal : undefined;
}

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

const MATH_PH_OPEN = "\uE010";
const MATH_PH_CLOSE = "\uE011";
const RIVET_PH_OPEN = "\uE000";
const RIVET_PH_CLOSE = "\uE001";

const ALLOWED_TAGS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "blockquote",
  "pre",
  "code",
  "hr",
  "br",
  "strong",
  "em",
  "a",
]);

const VOID_TAGS = new Set(["br", "hr", "img"]);

/** Drop the element and its inner HTML (do not unwrap). */
const DROP_TREE = new Set(["script", "style", "iframe", "object", "embed", "link", "meta"]);

const ALLOWED_ATTR: Record<string, ReadonlySet<string>> = {
  a: new Set(["href", "title"]),
  code: new Set(["class"]),
  ol: new Set(["start"]),
};

function mathPlaceholder(index: number): string {
  return `${MATH_PH_OPEN}${index}${MATH_PH_CLOSE}`;
}

function rivetStartPh(index: number): string {
  return `${RIVET_PH_OPEN}S${index}${RIVET_PH_CLOSE}`;
}

function rivetEndPh(index: number): string {
  return `${RIVET_PH_OPEN}E${index}${RIVET_PH_CLOSE}`;
}

function insertRivetPlaceholders(clean: string, rivets: readonly RivetRange[]): {
  text: string;
  ids: string[];
} {
  const ids: string[] = [];
  const indexById = new Map<string, number>();
  let text = "";
  let cursor = 0;
  for (const ev of rivetBounds(clean, rivets)) {
    if (ev.pos > cursor) {
      text += clean.slice(cursor, ev.pos);
      cursor = ev.pos;
    }
    if (ev.kind === "start") {
      const i = ids.length;
      ids.push(ev.rivet.id);
      indexById.set(ev.rivet.id, i);
      text += rivetStartPh(i);
    } else {
      const i = indexById.get(ev.rivet.id);
      if (i !== undefined) {
        text += rivetEndPh(i);
      }
    }
  }
  if (cursor < clean.length) {
    text += clean.slice(cursor);
  }
  return { text, ids };
}

function restoreRivets(html: string, ids: readonly string[], openIds: readonly string[]): string {
  const open = new Set(openIds);
  let depth = 0;
  let out = html.replace(/\uE000([SE])(\d+)\uE001/g, (_m, kind: string, n: string) => {
    const id = ids[Number(n)];
    if (!id) {
      return "";
    }
    if (kind === "S") {
      depth += 1;
      const cls = open.has(id) ? ' class="open"' : "";
      return `<mark data-rivet="${escapeHtml(id)}"${cls}>`;
    }
    if (depth === 0) {
      return "";
    }
    depth -= 1;
    return "</mark>";
  });
  while (depth > 0) {
    out += "</mark>";
    depth -= 1;
  }
  return out;
}

function restoreMath(html: string, parts: readonly string[]): string {
  return html.replace(/\uE010(\d+)\uE011/g, (_m, n: string) => parts[Number(n)] ?? "");
}

function mathInline(state: MdInlineState, silent: boolean): boolean {
  const slash = state.src.slice(state.pos, state.pos + 2);
  const latex = slash === "\\(" || slash === "\\[";
  if (!latex && state.src.charCodeAt(state.pos) !== 0x24) {
    return false;
  }
  const display = latex ? slash === "\\[" : state.src.charCodeAt(state.pos + 1) === 0x24;
  const openLen = latex || display ? 2 : 1;
  const close = latex ? (display ? "\\]" : "\\)") : (display ? "$$" : "$");
  const start = state.pos + openLen;
  if (start > state.posMax) {
    return false;
  }
  let i = start;
  while (i < state.posMax) {
    const ch = state.src.charCodeAt(i);
    if (!display && ch === 0x0a) {
      return false;
    }
    if (state.src.startsWith(close, i)) {
      if (!latex && display && state.src.charCodeAt(i + 1) !== 0x24) {
        i += 1;
        continue;
      }
      const tex = state.src.slice(start, i);
      if (!tex || (!display && tex.includes("\n"))) {
        return false;
      }
      if (!silent) {
        const token = state.push("math_inline", "span", 0);
        token.content = tex;
        token.markup = latex ? slash : (display ? "$$" : "$");
        token.meta = { display, relativeStart: start };
      }
      state.pos = i + close.length;
      return true;
    }
    i += 1;
  }
  return false;
}

function mathBlock(state: MdBlockState, start: number, end: number, silent: boolean): boolean {
  if (state.sCount[start]! - state.blkIndent >= 4) {
    return false;
  }
  const pos = state.bMarks[start]! + state.tShift[start]!;
  const max = state.eMarks[start]!;
  const opener = state.src.slice(pos, pos + 2);
  const closer = opener === "\\[" ? "\\]" : "$$";
  if (pos + 2 > max || (opener !== "$$" && opener !== "\\[")) {
    return false;
  }
  const first = state.src.slice(pos + 2, max);
  const sameLine = first.trimEnd();
  if (sameLine.endsWith(closer) && sameLine.length > 2) {
    if (silent) {
      return true;
    }
    const token = state.push("math_block", "div", 0);
    token.block = true;
    token.content = sameLine.slice(0, sameLine.length - 2);
    token.markup = opener;
    token.map = [start, start + 1];
    state.line = start + 1;
    return true;
  }
  let next = start;
  let found = false;
  let lastLine = "";
  while (next + 1 < end) {
    next += 1;
    const linePos = state.bMarks[next]! + state.tShift[next]!;
    const lineMax = state.eMarks[next]!;
    if (linePos < lineMax && state.tShift[next]! < state.blkIndent) {
      break;
    }
    const line = state.src.slice(linePos, lineMax);
    if (line.trim().endsWith(closer)) {
      lastLine = line.trim().slice(0, -2);
      found = true;
      break;
    }
  }
  if (!found) {
    return false;
  }
  if (silent) {
    return true;
  }
  const token = state.push("math_block", "div", 0);
  token.block = true;
  token.content =
    (first.trim() ? `${first.trim()}\n` : "") +
    state.getLines(start + 1, next, state.tShift[start]!, false) +
    lastLine;
  token.markup = opener;
  token.map = [start, next + 1];
  state.line = next + 1;
  return true;
}

function attachMath(md: MarkdownIt, math: MathRenderer, store: string[], source: string): void {
  md.block.ruler.before("fence", "math_block", mathBlock, {
    alt: ["paragraph", "reference", "blockquote", "list"],
  });
  md.inline.ruler.before("escape", "math_inline", mathInline);
  md.core.ruler.after("inline", "math_source_positions", (state) => {
    const lines = [0];
    for (let i = 0; i < source.length; i++) if (source[i] === "\n") lines.push(i + 1);
    for (const token of state.tokens) {
      if (!token.map) continue;
      const from = lines[token.map[0]] ?? 0;
      const until = lines[token.map[1]] ?? source.length;
      const base = source.indexOf(token.content, from);
      if (base < from || base + token.content.length > until) continue;
      if (token.type === "math_block") token.meta = { ...token.meta, sourceStart: base };
      for (const child of token.children ?? []) {
        if (child.type === "math_inline" && child.meta?.relativeStart !== undefined)
          child.meta.sourceStart = base + child.meta.relativeStart;
      }
    }
  });
  const emit = (token: MdToken, display: boolean): string => {
    const i = store.length;
    store.push(math(token.content, display, token.meta?.sourceStart));
    return mathPlaceholder(i);
  };
  md.renderer.rules.math_block = (tokens, idx) => `${emit(tokens[idx]!, true)}\n`;
  md.renderer.rules.math_inline = (tokens, idx) =>
    emit(tokens[idx]!, Boolean(tokens[idx]!.meta?.display));
}

function decodeAttr(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function safeHref(href: string): boolean {
  const t = href.trim();
  if (/^https?:\/\//i.test(t) || /^mailto:/i.test(t)) {
    return true;
  }
  if (t.startsWith("#") && !t.toLowerCase().startsWith("#javascript")) {
    return true;
  }
  if ((t.startsWith("/") || t.startsWith("./") || t.startsWith("../")) && !t.startsWith("//")) {
    return true;
  }
  return false;
}

function safeClass(value: string): boolean {
  return /^language-[A-Za-z0-9_+-]+$/.test(value.trim());
}

function readAttrs(raw: string): Array<{ name: string; value: string }> {
  const attrs: Array<{ name: string; value: string }> = [];
  const re = /([A-Za-z_:][A-Za-z0-9_.:-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw))) {
    attrs.push({ name: match[1]!.toLowerCase(), value: decodeAttr(match[3] ?? match[4] ?? "") });
  }
  return attrs;
}

function rebuildOpen(name: string, raw: string): string | null {
  const allowed = ALLOWED_ATTR[name];
  const kept: string[] = [];
  let hrefOk = name !== "a";
  for (const attr of readAttrs(raw)) {
    if (!allowed?.has(attr.name) || attr.name.startsWith("on")) {
      continue;
    }
    if (attr.name === "href") {
      if (!safeHref(attr.value)) {
        return null;
      }
      hrefOk = true;
    }
    if (attr.name === "class" && !safeClass(attr.value)) {
      continue;
    }
    kept.push(`${attr.name}="${escapeHtml(attr.value)}"`);
  }
  if (!hrefOk) {
    return null;
  }
  const slash = VOID_TAGS.has(name) ? " /" : "";
  return kept.length > 0 ? `<${name} ${kept.join(" ")}${slash}>` : `<${name}${slash}>`;
}

/**
 * Allowlist pass over markdown-it HTML. User raw HTML never enters (html:false);
 * this still drops unexpected tags/attrs and unsafe hrefs before KaTeX/marks
 * are restored.
 */
export function sanitizeHtml(html: string): string {
  const out: string[] = [];
  const stack: string[] = [];
  let dropping: string | null = null;
  const re = /<\/?([A-Za-z][A-Za-z0-9]*)\b[^>]*>/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    if (!dropping) {
      out.push(html.slice(cursor, match.index));
    }
    const raw = match[0];
    const name = match[1]!.toLowerCase();
    const closing = raw.startsWith("</");
    cursor = match.index + raw.length;
    if (dropping) {
      if (closing && name === dropping) {
        dropping = null;
      }
      continue;
    }
    if (DROP_TREE.has(name)) {
      if (!closing && !VOID_TAGS.has(name) && !raw.endsWith("/>")) {
        dropping = name;
      }
      continue;
    }
    if (name === "img") {
      if (!closing) {
        const alt = readAttrs(raw).find((a) => a.name === "alt")?.value ?? "";
        out.push(escapeHtml(alt));
      }
      continue;
    }
    if (!ALLOWED_TAGS.has(name)) {
      continue;
    }
    if (closing) {
      const at = stack.lastIndexOf(name);
      if (at < 0) {
        continue;
      }
      while (stack.length > at) {
        out.push(`</${stack.pop()}>`);
      }
      continue;
    }
    if (VOID_TAGS.has(name)) {
      const tag = rebuildOpen(name, raw);
      if (tag) {
        out.push(tag);
      }
      continue;
    }
    const tag = rebuildOpen(name, raw);
    if (!tag) {
      continue;
    }
    stack.push(name);
    out.push(tag);
  }
  out.push(html.slice(cursor));
  while (stack.length > 0) {
    out.push(`</${stack.pop()}>`);
  }
  return out.join("");
}

function renderMarkdown(src: string, math: MathRenderer): { html: string; math: string[] } {
  const factory = resolveMarkdownIt();
  if (!factory) {
    return { html: src ? `<p>${escapeHtml(src)}</p>\n` : "", math: [] };
  }
  const store: string[] = [];
  const md = factory({ html: false, linkify: false, breaks: false, typographer: false });
  md.disable("table");
  attachMath(md, math, store, src);
  return { html: md.render(src), math: store };
}

/** True when text still has 做法 A delimiters. Markdown must not see these. */
export function hasMarkDelimiters(text: string): boolean {
  return /<<r(?:\s|\/)/.test(text) || /<<\/r\b/.test(text);
}

/** CommonMark subset + `$` / `$$` math. Projection only; do not persist. */
export function markupMarkdown(text: string, math: MathRenderer = fallbackMath): string {
  const rendered = renderMarkdown(text, math);
  return restoreMath(sanitizeHtml(rendered.html), rendered.math);
}

/**
 * Read-only Rendered projection. Input is **clean** text (already `strip` of
 * `.intro.md`) plus rivet ranges from `parse` — rivets first, then markdown.
 * Never pass a marked body: `**` / `#` must not tokenize `<<r>>` delimiters.
 * `[data-rivet]` is view-layer geometry, not SoT. Do not persist this HTML.
 *
 * Supported subset: headings, lists, bold/italic, links, inline code, fenced
 * code, blockquotes, `$...$` / `$$...$$` math. Raw HTML and images are not
 * rendered as markup.
 */
export function renderHtml(
  clean: string,
  rivets: readonly RivetRange[] = [],
  openIds: readonly string[] = [],
  math: MathRenderer = fallbackMath,
): string {
  const marked = insertRivetPlaceholders(clean, rivets);
  const rendered = renderMarkdown(marked.text, (tex, display, sourceStart) => {
    const ranges: { id: string; start: number; end: number }[] = [];
    const active = new Map<number, number>();
    let cleanTex = "", cursor = 0, before = "", after = "";
    for (const match of tex.matchAll(/\uE000([SE])(\d+)\uE001/g)) {
      cleanTex += tex.slice(cursor, match.index);
      const index = Number(match[2]);
      if (match[1] === "S") active.set(index, cleanTex.length);
      else if (active.has(index)) {
        ranges.push({ id: marked.ids[index]!, start: active.get(index)!, end: cleanTex.length });
        active.delete(index);
      } else {
        // The anchor starts outside this formula. End its outer wrapper first,
        // then project its mathematical portion independently.
        before += match[0];
        ranges.push({ id: marked.ids[index]!, start: 0, end: cleanTex.length });
      }
      cursor = match.index! + match[0].length;
    }
    cleanTex += tex.slice(cursor);
    for (const [index, start] of active) {
      ranges.push({ id: marked.ids[index]!, start, end: cleanTex.length });
      after += rivetStartPh(index);
    }
    const start = sourceStart === undefined ? -1 : marked.text.slice(0, sourceStart).replace(/\uE000[SE]\d+\uE001/g, "").length;
    const html = math(cleanTex, display);
    return `${before}<span class="math-source" data-math-start="${start}" data-math-anchors="${escapeHtml(JSON.stringify(ranges))}" data-math-open="${escapeHtml(JSON.stringify(openIds))}">${html}</span>${after}`;
  });
  const safe = sanitizeHtml(rendered.html);
  return restoreRivets(restoreMath(safe, rendered.math), marked.ids, openIds);
}
