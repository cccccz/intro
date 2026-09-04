import { isPieceId } from "../marks/id.ts";
import { OverlayError } from "./overlay.ts";

export const HOST_FORMAT_VERSION = 1;
export const HOST_EXT = ".intro.host.json";
export const OVERLAY_EXT = ".intro.overlay.json";
export const PDF_EXT = ".pdf";

export type PdfHostMeta = {
  formatVersion: typeof HOST_FORMAT_VERSION;
  medium: "pdf";
  id: string;
  /** Basename of the immutable PDF copy next to this file (`{id}.pdf`). */
  pdf: string;
  /** Original filename when attached; display only. */
  sourceName?: string;
};

export function hostFileName(id: string): string {
  return `${id}${HOST_EXT}`;
}

export function overlayFileName(id: string): string {
  return `${id}${OVERLAY_EXT}`;
}

export function pdfFileName(id: string): string {
  return `${id}${PDF_EXT}`;
}

export function parseHostMeta(raw: string): PdfHostMeta {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new OverlayError("PDF host metadata is not JSON");
  }
  if (!data || typeof data !== "object") {
    throw new OverlayError("PDF host metadata must be an object");
  }
  const obj = data as Record<string, unknown>;
  if (obj.formatVersion !== HOST_FORMAT_VERSION) {
    throw new OverlayError(`unsupported host formatVersion: ${String(obj.formatVersion)}`);
  }
  if (obj.medium !== "pdf") {
    throw new OverlayError("PDF host metadata.medium must be \"pdf\"");
  }
  const id = String(obj.id ?? "");
  if (!isPieceId(id)) {
    throw new OverlayError(`invalid PDF host id: ${id}`);
  }
  const pdf = String(obj.pdf ?? "");
  if (pdf !== pdfFileName(id)) {
    throw new OverlayError(`PDF host pdf must be ${pdfFileName(id)}`);
  }
  const sourceName = obj.sourceName;
  if (sourceName !== undefined && typeof sourceName !== "string") {
    throw new OverlayError("sourceName must be a string when present");
  }
  return {
    formatVersion: HOST_FORMAT_VERSION,
    medium: "pdf",
    id,
    pdf,
    ...(sourceName ? { sourceName } : {}),
  };
}

export function serializeHostMeta(meta: PdfHostMeta): string {
  parseHostMeta(JSON.stringify(meta));
  return `${JSON.stringify(meta, null, 2)}\n`;
}

export function createHostMeta(id: string, sourceName?: string): PdfHostMeta {
  return parseHostMeta(
    JSON.stringify({
      formatVersion: HOST_FORMAT_VERSION,
      medium: "pdf",
      id,
      pdf: pdfFileName(id),
      ...(sourceName ? { sourceName } : {}),
    }),
  );
}
