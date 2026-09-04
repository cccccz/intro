/**
 * Display-name sidecar. Not mark SoT and not a second rivet graph.
 *
 * Text: `{id}.intro.md` stays the body. Title lives in `{id}.intro.meta.json`.
 * PDF: same sidecar; if missing, the UI falls back to `sourceName` (filename)
 * from `{id}.intro.host.json`. The piece id is the filename stem only.
 */

export const META_FORMAT_VERSION = 1;
export const META_EXT = ".intro.meta.json";

export class MetaError extends Error {
  readonly name = "MetaError";
}

export type PieceMeta = {
  formatVersion: typeof META_FORMAT_VERSION;
  title?: string;
};

export function metaFileName(id: string): string {
  return `${id}${META_EXT}`;
}

export function emptyMeta(): PieceMeta {
  return { formatVersion: META_FORMAT_VERSION };
}

export function normalizeTitle(value: string | undefined | null): string | undefined {
  if (value == null) {
    return undefined;
  }
  const title = value.trim();
  return title.length > 0 ? title : undefined;
}

/** UI label. Never the piece id — id stays a secondary/tooltip value. */
export function displayTitle(opts: {
  title?: string | null;
  sourceName?: string | null;
  medium: "text" | "pdf";
}): string {
  const titled = normalizeTitle(opts.title);
  if (titled) {
    return titled;
  }
  if (opts.medium === "pdf") {
    return normalizeTitle(opts.sourceName) ?? "Untitled PDF";
  }
  return "Untitled";
}

export function parseMeta(raw: string): PieceMeta {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new MetaError("piece meta is not JSON");
  }
  if (!data || typeof data !== "object") {
    throw new MetaError("piece meta must be an object");
  }
  const obj = data as Record<string, unknown>;
  if (obj.formatVersion !== META_FORMAT_VERSION) {
    throw new MetaError(`unsupported meta formatVersion: ${String(obj.formatVersion)}`);
  }
  if (obj.title !== undefined && typeof obj.title !== "string") {
    throw new MetaError("meta.title must be a string when present");
  }
  return {
    formatVersion: META_FORMAT_VERSION,
    ...(normalizeTitle(obj.title) ? { title: normalizeTitle(obj.title) } : {}),
  };
}

export function serializeMeta(meta: PieceMeta): string {
  const next: PieceMeta = {
    formatVersion: META_FORMAT_VERSION,
    ...(normalizeTitle(meta.title) ? { title: normalizeTitle(meta.title) } : {}),
  };
  parseMeta(JSON.stringify(next));
  return `${JSON.stringify(next, null, 2)}\n`;
}
