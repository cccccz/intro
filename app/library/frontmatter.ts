/**
 * Display name lives in YAML frontmatter on `{id}.intro.md`.
 * The filename stem `{id}` is the only stable identity (rivet `to=`, disk name).
 * Title is a mutable label, not a second id. Not a `.meta.json` or title DB.
 *
 * Mark parse/strip/add see only the body after the closing `---` fence.
 */

export function normalizeTitle(value: string | undefined | null): string | undefined {
  if (value == null) {
    return undefined;
  }
  const title = value.trim();
  return title.length > 0 ? title : undefined;
}

/** Short label when the piece has no title. Full id stays a secondary/tooltip. */
export function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

export type SplitDoc = {
  hasFrontmatter: boolean;
  matterLines: string[];
  body: string;
};

export function splitDoc(raw: string): SplitDoc {
  const open = raw.startsWith("---\r\n") ? "---\r\n" : raw.startsWith("---\n") ? "---\n" : null;
  if (!open) {
    return { hasFrontmatter: false, matterLines: [], body: raw };
  }
  const rest = raw.slice(open.length);
  const close = rest.match(/\r?\n---(?:\r?\n|$)/);
  if (!close || close.index === undefined) {
    return { hasFrontmatter: false, matterLines: [], body: raw };
  }
  const yaml = rest.slice(0, close.index);
  const body = rest.slice(close.index + close[0].length);
  return {
    hasFrontmatter: true,
    matterLines: yaml.length === 0 ? [] : yaml.split(/\r?\n/),
    body,
  };
}

export function joinDoc(doc: SplitDoc): string {
  const lines = doc.matterLines;
  if (!doc.hasFrontmatter && lines.length === 0) {
    return doc.body;
  }
  const inner = lines.join("\n");
  return `---\n${inner}${inner.length > 0 ? "\n" : ""}---\n${doc.body}`;
}

function parseYamlScalar(raw: string): string {
  const s = raw.trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  return s;
}

function yamlScalar(value: string): string {
  if (value === "" || /[:#\n\r\\]|^\s|\s$|^['"]/.test(value)) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return value;
}

const TITLE_LINE = /^title\s*:(?:[ \t]+(.*))?$/;

export function titleFromMatter(lines: readonly string[]): string | undefined {
  for (const line of lines) {
    const match = line.match(TITLE_LINE);
    if (match) {
      return normalizeTitle(parseYamlScalar(match[1] ?? ""));
    }
  }
  return undefined;
}

export function setMatterTitle(lines: readonly string[], title: string | undefined): string[] {
  const without = lines.filter((line) => !TITLE_LINE.test(line));
  const next = normalizeTitle(title);
  if (!next) {
    return without;
  }
  return [`title: ${yamlScalar(next)}`, ...without];
}

export function withTitle(raw: string, title: string | undefined): string {
  const split = splitDoc(raw);
  const matterLines = setMatterTitle(split.matterLines, title);
  return joinDoc({
    hasFrontmatter: matterLines.length > 0,
    matterLines,
    body: split.body,
  });
}

/** UI label. Empty title → excerpt, else PDF filename, else short id. Never a second identity. */
export function displayTitle(opts: {
  id: string;
  title?: string | null;
  sourceName?: string | null;
  excerpt?: string | null;
  medium: "text" | "pdf";
}): string {
  const titled = normalizeTitle(opts.title);
  if (titled) {
    return titled;
  }
  const excerpt = normalizeTitle(opts.excerpt?.replace(/\s+/g, " "));
  if (excerpt) {
    return excerpt;
  }
  if (opts.medium === "pdf") {
    return normalizeTitle(opts.sourceName) ?? shortId(opts.id);
  }
  return shortId(opts.id);
}
