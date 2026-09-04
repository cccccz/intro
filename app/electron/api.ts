import type { Damage, RivetSpec } from "../marks/types.ts";
import type { OverlayRivet, PdfAnchor } from "../pdf/overlay.ts";

export type PieceDto = {
  id: string;
  path: string;
  medium: "text" | "pdf";
  body: string;
  clean: string;
  rivets: RivetSpec[];
  overlayRivets: OverlayRivet[];
  damage: Damage[];
  pdfPath?: string;
  sourceName?: string;
};

export type LibraryDto = {
  root: string;
  pieces: { id: string; path: string; medium: "text" | "pdf" }[];
};

export type Ok<T> = { ok: true } & T;
export type Err = { ok: false; error: string };

export type IntroApi = {
  openLibrary: () => Promise<Ok<{ library: LibraryDto }> | Err>;
  openLibraryPath: (root: string) => Promise<Ok<{ library: LibraryDto }> | Err>;
  listPieces: () => Promise<Ok<{ pieces: { id: string; path: string }[] }> | Err>;
  createPiece: (opts?: {
    id?: string;
    body?: string;
  }) => Promise<Ok<{ piece: PieceDto; pieces: { id: string; path: string }[] }> | Err>;
  loadPiece: (id: string) => Promise<Ok<{ piece: PieceDto }> | Err>;
  persistClean: (
    id: string,
    clean: string,
  ) => Promise<Ok<{ piece: PieceDto }> | Err>;
  hangSide: (opts: {
    hostId: string;
    start: number;
    end: number;
    clean?: string;
    sideId?: string;
  }) => Promise<Ok<{ host: PieceDto; side: PieceDto; rivetId: string }> | Err>;
  attachPdf: () => Promise<Ok<{ piece: PieceDto; pieces: LibraryDto["pieces"] }> | Err>;
  readPdf: (id: string) => Promise<Ok<{ data: Uint8Array }> | Err>;
  hangPdfSide: (opts: {
    hostId: string;
    anchors: PdfAnchor[];
    sideId?: string;
    quote?: string;
  }) => Promise<Ok<{ host: PieceDto; side: PieceDto; rivetId: string }> | Err>;
};

export const IPC = {
  openLibrary: "library:open",
  openLibraryPath: "library:openPath",
  listPieces: "library:list",
  createPiece: "piece:create",
  loadPiece: "piece:load",
  persistClean: "piece:persistClean",
  hangSide: "piece:hangSide",
  attachPdf: "piece:attachPdf",
  readPdf: "piece:readPdf",
  hangPdfSide: "piece:hangPdfSide",
} as const;
