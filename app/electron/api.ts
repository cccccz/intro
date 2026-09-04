import type { Damage, RivetSpec } from "../marks/types.ts";
import type { OverlayRivet, PdfAnchor } from "../pdf/overlay.ts";

export type PieceDto = {
  id: string;
  path: string;
  medium: "text" | "pdf";
  title: string;
  titled: boolean;
  body: string;
  clean: string;
  rivets: RivetSpec[];
  overlayRivets: OverlayRivet[];
  damage: Damage[];
  pdfPath?: string;
  sourceName?: string;
};

export type ListedPieceDto = {
  id: string;
  path: string;
  medium: "text" | "pdf";
  title: string;
  titled: boolean;
};

export type LibraryDto = {
  root: string;
  pieces: ListedPieceDto[];
};

export type Ok<T> = { ok: true } & T;
export type Err = { ok: false; error: string };

export type IntroApi = {
  detachSide: (hostId: string, rivetId: string, clean?: string) => Promise<Ok<{ host: PieceDto }> | Err>;
  openLibrary: () => Promise<Ok<{ library: LibraryDto }> | Err>;
  openLibraryPath: (root: string) => Promise<Ok<{ library: LibraryDto }> | Err>;
  listPieces: () => Promise<Ok<{ pieces: ListedPieceDto[] }> | Err>;
  createPiece: (opts?: {
    id?: string;
    body?: string;
    title?: string;
  }) => Promise<Ok<{ piece: PieceDto; pieces: ListedPieceDto[] }> | Err>;
  setPieceTitle: (
    id: string,
    title: string,
  ) => Promise<Ok<{ piece: PieceDto; pieces: ListedPieceDto[] }> | Err>;
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
  dropSide: (id: string) => Promise<Ok<{ deleted: string[]; hosts: PieceDto[]; pieces: ListedPieceDto[] }> | Err>;
};

export const IPC = {
  detachSide: "piece:detachSide",
  openLibrary: "library:open",
  openLibraryPath: "library:openPath",
  listPieces: "library:list",
  createPiece: "piece:create",
  setPieceTitle: "piece:setTitle",
  loadPiece: "piece:load",
  persistClean: "piece:persistClean",
  hangSide: "piece:hangSide",
  attachPdf: "piece:attachPdf",
  readPdf: "piece:readPdf",
  hangPdfSide: "piece:hangPdfSide",
  dropSide: "piece:dropSide",
} as const;
