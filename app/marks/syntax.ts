import { isPieceId } from "./id.ts";

export const OPEN_START = "<<r";
export const CLOSE_START = "<</r";
export const TAG_END = ">>";
export const MAX_TAG_LEN = 256;

export function formatOpen(id: string, to?: string | null): string {
  if (!isPieceId(id)) {
    throw new Error(`invalid rivet id: ${id}`);
  }
  if (to) {
    if (!isPieceId(to)) {
      throw new Error(`invalid piece id in to: ${to}`);
    }
    return `<<r id="${id}" to="${to}">>`;
  }
  return `<<r id="${id}">>`;
}

export function formatClose(id: string): string {
  if (!isPieceId(id)) {
    throw new Error(`invalid rivet id: ${id}`);
  }
  return `<</r id="${id}">>`;
}

export function parseAttrs(inner: string): Record<string, string> | null {
  if (!/^(\s+[A-Za-z][A-Za-z0-9_-]*="[^"]*")*\s*$/.test(inner)) {
    return null;
  }
  const attrs: Record<string, string> = {};
  for (const match of inner.matchAll(
    /\s+([A-Za-z][A-Za-z0-9_-]*)="([^"]*)"/g,
  )) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}
