import type { Library } from "../library/index.ts";
import { pieceView } from "./loop.ts";

/** One hang: rivet `rivetId` in `hostId` opens `sideId`. Rebuilt from marks and overlays on demand. */
export type LinkDto = {
  hostId: string;
  rivetId: string;
  sideId: string;
  /** PDF hosts: page of the first anchor. */
  page?: number;
  /** Text hosts: UTF-16 offset in the clean body, for ordering. PDF hosts: top of the first anchor in page order. */
  order: number;
  excerpt: string;
};

const EXCERPT_MAX = 60;

function excerptOf(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= EXCERPT_MAX ? flat : `${flat.slice(0, EXCERPT_MAX)}…`;
}

/**
 * Who hangs whom, across the whole library. Not stored: a missing or stale answer is fixed
 * by calling this again. Unreadable pieces are skipped rather than failing the list.
 */
export function libraryLinks(lib: Library): LinkDto[] {
  const links: LinkDto[] = [];
  for (const listed of lib.list()) {
    let view;
    try {
      view = pieceView(lib.load(listed.id));
    } catch {
      continue;
    }
    for (const rivet of view.rivets) {
      if (!rivet.to) continue;
      links.push({
        hostId: view.id,
        rivetId: rivet.id,
        sideId: rivet.to,
        order: rivet.start,
        excerpt: excerptOf(view.clean.slice(rivet.start, rivet.end)),
      });
    }
    for (const rivet of view.overlayRivets) {
      if (!rivet.to) continue;
      const first = rivet.anchors[0];
      links.push({
        hostId: view.id,
        rivetId: rivet.id,
        sideId: rivet.to,
        ...(first ? { page: first.page } : {}),
        order: first ? first.page * 1e6 - (first.rect.y + first.rect.height) : 0,
        excerpt: excerptOf(rivet.quote ?? ""),
      });
    }
  }
  return links;
}
