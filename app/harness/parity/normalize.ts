/**
 * Generated ids (ULID pieces/rivets, UUID pins) and the scratch library path differ between two runs of the
 * same behaviour. Parity captures name them by first appearance instead, so equal behaviour gives equal text.
 */

/** Not inside a longer word, but a JSON escape such as `\n` right before the id still counts as a boundary. */
const BEFORE = String.raw`(?:(?<![0-9A-Za-z])|(?<=\\[nrtbf]))`;
const AFTER = String.raw`(?![0-9A-Za-z])`;
const ULID = new RegExp(`${BEFORE}[0-9A-HJKMNP-TV-Z]{26}${AFTER}`, "g");
const UUID = new RegExp(`${BEFORE}[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}${AFTER}`, "gi");
/** Same cut as shortId() in the renderer and frontmatter: untitled pieces show the first 8 characters. */
const SHORT = 8;

export const LIBRARY_TOKEN = "<library>";

export class IdNormalizer {
  private readonly names = new Map<string, string>();
  private readonly roots: string[];

  constructor(roots: readonly string[] = []) {
    const variants = new Set<string>();
    for (const root of roots) {
      if (!root) continue;
      variants.add(root);
      variants.add(root.replaceAll("\\", "/"));
      variants.add(JSON.stringify(root).slice(1, -1));
    }
    this.roots = [...variants].sort((a, b) => b.length - a.length);
  }

  /** Assign names in reading order. Call in the same order on both sides. */
  learn(text: string): void {
    const found: Array<{ index: number; id: string }> = [];
    for (const re of [ULID, UUID]) {
      for (const match of text.matchAll(re)) found.push({ index: match.index, id: match[0] });
    }
    found.sort((a, b) => a.index - b.index);
    for (const { id } of found) {
      const key = id.toLowerCase();
      if (!this.names.has(key)) this.names.set(key, `<id${this.names.size + 1}>`);
    }
  }

  apply(text: string): string {
    let out = text;
    for (const root of this.roots) out = out.split(root).join(LIBRARY_TOKEN);
    out = out.replace(ULID, (id) => this.names.get(id.toLowerCase()) ?? id);
    out = out.replace(UUID, (id) => this.names.get(id.toLowerCase()) ?? id);
    for (const [id, name] of this.names) {
      if (id.length !== 26) continue;
      const short = id.slice(0, SHORT).toUpperCase();
      out = out.replace(new RegExp(`${BEFORE}${short}${AFTER}`, "g"), `${name.slice(0, -1)}:short>`);
    }
    return out;
  }

  /** learn() then apply() over a sequence, so later texts reuse earlier names. */
  normalizeAll(texts: readonly string[]): string[] {
    for (const text of texts) this.learn(text);
    return texts.map((text) => this.apply(text));
  }
}
