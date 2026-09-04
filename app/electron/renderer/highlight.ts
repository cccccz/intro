/** Range of a rivet in clean (stripped) text. */
export type RivetRange = {
  id: string;
  start: number;
  end: number;
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

type Event = { pos: number; kind: "start" | "end"; rivet: RivetRange };

/**
 * Textarea/HTML geometry provider: paint `[data-rivet]` from clean ranges.
 * View only — offsets come from parsed marks; nothing here is written back.
 */
export function highlightHtml(
  clean: string,
  rivets: readonly RivetRange[],
  openIds: readonly string[] = [],
): string {
  const events: Event[] = [];
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

  let html = "";
  let cursor = 0;
  for (const ev of events) {
    if (ev.pos > cursor) {
      html += escapeHtml(clean.slice(cursor, ev.pos));
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
    html += escapeHtml(clean.slice(cursor));
  }
  // Textareas keep a trailing line box; the mirror needs the same extra break.
  return `${html}\n`;
}
