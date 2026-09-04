import { isPieceId } from "../marks/id.ts";

export const OVERLAY_FORMAT_VERSION = 1;

/**
 * Axis-aligned box in PDF user space (ISO 32000).
 * Origin is the page bottom-left; y increases up. Not a string index.
 */
export type PdfUserRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** One painted box on one page. `page` is 1-based. */
export type PdfAnchor = {
  page: number;
  rect: PdfUserRect;
};

/**
 * Overlay rivet: view-layer / sidecar SoT for a PDF host.
 * `to` is a side piece id (`{id}.intro.md`). No character offsets.
 */
export type OverlayRivet = {
  id: string;
  to: string | null;
  anchors: PdfAnchor[];
  /** Optional excerpt; never required to re-find the region. */
  quote?: string;
};

export type PdfOverlay = {
  formatVersion: typeof OVERLAY_FORMAT_VERSION;
  rivets: OverlayRivet[];
};

export class OverlayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OverlayError";
  }
}

export function emptyOverlay(): PdfOverlay {
  return { formatVersion: OVERLAY_FORMAT_VERSION, rivets: [] };
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function assertRect(rect: PdfUserRect, label: string): void {
  if (
    !isFiniteNumber(rect.x) ||
    !isFiniteNumber(rect.y) ||
    !isFiniteNumber(rect.width) ||
    !isFiniteNumber(rect.height)
  ) {
    throw new OverlayError(`${label}: rect must be finite numbers`);
  }
  if (rect.width <= 0 || rect.height <= 0) {
    throw new OverlayError(`${label}: rect width/height must be > 0`);
  }
}

function assertAnchor(anchor: PdfAnchor, label: string): void {
  if (!Number.isInteger(anchor.page) || anchor.page < 1) {
    throw new OverlayError(`${label}: page must be a 1-based integer`);
  }
  assertRect(anchor.rect, label);
}

export function assertOverlay(overlay: PdfOverlay): void {
  if (overlay.formatVersion !== OVERLAY_FORMAT_VERSION) {
    throw new OverlayError(`unsupported overlay formatVersion: ${overlay.formatVersion}`);
  }
  if (!Array.isArray(overlay.rivets)) {
    throw new OverlayError("overlay.rivets must be an array");
  }
  const seen = new Set<string>();
  for (const rivet of overlay.rivets) {
    if (!isPieceId(rivet.id)) {
      throw new OverlayError(`invalid rivet id: ${rivet.id}`);
    }
    if (seen.has(rivet.id)) {
      throw new OverlayError(`duplicate overlay rivet id: ${rivet.id}`);
    }
    seen.add(rivet.id);
    if (rivet.to !== null && !isPieceId(rivet.to)) {
      throw new OverlayError(`invalid piece id in to: ${rivet.to}`);
    }
    if (!Array.isArray(rivet.anchors) || rivet.anchors.length === 0) {
      throw new OverlayError(`rivet ${rivet.id}: need at least one page+rect anchor`);
    }
    rivet.anchors.forEach((anchor, i) => {
      assertAnchor(anchor, `rivet ${rivet.id} anchor[${i}]`);
    });
    if (rivet.quote !== undefined && typeof rivet.quote !== "string") {
      throw new OverlayError(`rivet ${rivet.id}: quote must be a string when present`);
    }
  }
}

/**
 * Normalize PDF QuadPoints (8 numbers per quad) to axis-aligned user-space
 * rects. Acrobat and ISO 32000 disagree on vertex order; we take min/max of
 * the four points and do not treat the values as a string index into the file.
 */
export function quadsToRects(quads: readonly number[]): PdfUserRect[] {
  if (quads.length === 0 || quads.length % 8 !== 0) {
    throw new OverlayError("QuadPoints must be a non-empty multiple of 8 numbers");
  }
  if (quads.some((n) => !isFiniteNumber(n))) {
    throw new OverlayError("QuadPoints must be finite numbers");
  }
  const rects: PdfUserRect[] = [];
  for (let i = 0; i < quads.length; i += 8) {
    const xs = [quads[i], quads[i + 2], quads[i + 4], quads[i + 6]];
    const ys = [quads[i + 1], quads[i + 3], quads[i + 5], quads[i + 7]];
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    const width = Math.max(...xs) - x;
    const height = Math.max(...ys) - y;
    if (width <= 0 || height <= 0) {
      throw new OverlayError("QuadPoints collapsed to an empty rect");
    }
    rects.push({ x, y, width, height });
  }
  return rects;
}

export function parseOverlay(raw: string): PdfOverlay {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new OverlayError("overlay sidecar is not JSON");
  }
  if (!data || typeof data !== "object") {
    throw new OverlayError("overlay sidecar must be an object");
  }
  const obj = data as Record<string, unknown>;
  const rivetsIn = obj.rivets;
  if (!Array.isArray(rivetsIn)) {
    throw new OverlayError("overlay.rivets must be an array");
  }
  const overlay: PdfOverlay = {
    formatVersion: obj.formatVersion as typeof OVERLAY_FORMAT_VERSION,
    rivets: rivetsIn.map((item, index) => {
      if (!item || typeof item !== "object") {
        throw new OverlayError(`overlay.rivets[${index}] must be an object`);
      }
      const r = item as Record<string, unknown>;
      const anchorsIn = r.anchors;
      if (!Array.isArray(anchorsIn)) {
        throw new OverlayError(`overlay.rivets[${index}].anchors must be an array`);
      }
      const quote = r.quote;
      return {
        id: String(r.id ?? ""),
        to: r.to == null ? null : String(r.to),
        anchors: anchorsIn.map((anchor, ai) => {
          if (!anchor || typeof anchor !== "object") {
            throw new OverlayError(`overlay.rivets[${index}].anchors[${ai}] must be an object`);
          }
          const a = anchor as Record<string, unknown>;
          const rect = a.rect;
          if (!rect || typeof rect !== "object") {
            throw new OverlayError(`overlay.rivets[${index}].anchors[${ai}].rect is required`);
          }
          const box = rect as Record<string, unknown>;
          return {
            page: a.page as number,
            rect: {
              x: box.x as number,
              y: box.y as number,
              width: box.width as number,
              height: box.height as number,
            },
          };
        }),
        ...(typeof quote === "string" ? { quote } : {}),
      };
    }),
  };
  assertOverlay(overlay);
  return overlay;
}

export function serializeOverlay(overlay: PdfOverlay): string {
  assertOverlay(overlay);
  return `${JSON.stringify(overlay, null, 2)}\n`;
}

export function addOverlayRivet(
  overlay: PdfOverlay,
  rivet: OverlayRivet,
): PdfOverlay {
  const next: PdfOverlay = {
    formatVersion: OVERLAY_FORMAT_VERSION,
    rivets: [...overlay.rivets, rivet],
  };
  assertOverlay(next);
  return next;
}

export function removeOverlayRivet(overlay: PdfOverlay, rivetId: string): PdfOverlay {
  if (!overlay.rivets.some((rivet) => rivet.id === rivetId)) {
    throw new OverlayError(`overlay rivet not found: ${rivetId}`);
  }
  const next: PdfOverlay = {
    formatVersion: OVERLAY_FORMAT_VERSION,
    rivets: overlay.rivets.filter((rivet) => rivet.id !== rivetId),
  };
  assertOverlay(next);
  return next;
}

export function overlayRivetsById(overlay: PdfOverlay): Map<string, OverlayRivet> {
  return new Map(overlay.rivets.map((r) => [r.id, r]));
}
