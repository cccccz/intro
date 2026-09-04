/** Range of a rivet in clean (stripped) text. */
export type RivetRange = {
  id: string;
  start: number;
  end: number;
};

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type RivetBound = { pos: number; kind: "start" | "end"; rivet: RivetRange };

/** Sorted start/end events for in-range rivets. Shared by source wrap and rendered sentinels. */
export function rivetBounds(clean: string, rivets: readonly RivetRange[]): RivetBound[] {
  const events: RivetBound[] = [];
  for (const rivet of rivets) {
    if (rivet.start < 0 || rivet.end > clean.length || rivet.start >= rivet.end) {
      continue;
    }
    events.push({ pos: rivet.start, kind: "start", rivet });
    events.push({ pos: rivet.end, kind: "end", rivet });
  }
  events.sort((a, b) => {
    if (a.pos !== b.pos) {
      return a.pos - b.pos;
    }
    if (a.kind !== b.kind) {
      return a.kind === "end" ? -1 : 1;
    }
    const da = a.rivet.end - a.rivet.start;
    const db = b.rivet.end - b.rivet.start;
    return a.kind === "start" ? db - da : da - db;
  });
  return events;
}

/**
 * Wrap clean ranges in `[data-rivet]` marks. `formatText` sees each unmarked
 * slice (source view escapes only). View-layer only; not a persist format.
 */
export function wrapRivets(
  clean: string,
  rivets: readonly RivetRange[],
  openIds: readonly string[],
  formatText: (text: string) => string,
): string {
  const events = rivetBounds(clean, rivets);

  let html = "";
  let cursor = 0;
  for (const ev of events) {
    if (ev.pos > cursor) {
      html += formatText(clean.slice(cursor, ev.pos));
      cursor = ev.pos;
    }
    if (ev.kind === "start") {
      const cls = openIds.includes(ev.rivet.id) ? ' class="open"' : "";
      html += `<mark data-rivet="${escapeHtml(ev.rivet.id)}"${cls}>`;
    } else {
      html += "</mark>";
    }
  }
  if (cursor < clean.length) {
    html += formatText(clean.slice(cursor));
  }
  return html;
}

/**
 * Textarea/HTML geometry provider: paint `[data-rivet]` from clean ranges.
 * View only — offsets come from parsed marks; nothing here is written back.
 */
export function highlightHtml(
  clean: string,
  rivets: readonly RivetRange[],
  openIds: readonly string[] = [],
): string {
  // Textareas keep a trailing line box; the mirror needs the same extra break.
  return `${wrapRivets(clean, rivets, openIds, escapeHtml)}\n`;
}
