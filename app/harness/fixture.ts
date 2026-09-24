import fs from "node:fs";
import path from "node:path";
import { Library } from "../library/index.ts";
import { hangSide } from "../write/loop.ts";
import { buildOutlinedPdf, type BookmarkSpec } from "./pdf-fixture.ts";
import { scratchRoot } from "./session.ts";

export const HOST_ID = "host01";
export const SIDE_A = "side01";
export const SIDE_B = "side01b";
export const SIDE_C = "side02";
export const SIDE_D = "side03";

export const ANCHOR_A = "这里是锚点";
export const ANCHOR_B = "另一处也要挂";
export const ANCHOR_C = "继续往下看这段";
export const ANCHOR_D = "再下一层的句子";

export const BOOK_ID = "book01";
export const BOOK_FILE = "outline-book.pdf";
export const BOOK_OUTLINE: BookmarkSpec[] = [
  { title: "Part One", page: 1, children: [
    { title: "Chapter 1", page: 2, children: [
      { title: "1.1 Intro", page: 2 },
      { title: "1.2 Returns", page: 4 },
    ] },
    { title: "Chapter 2", page: 6 },
  ] },
  { title: "Part Two", page: 8, children: [
    { title: "Chapter 3", page: 9, children: [{ title: "3.1 Correlation", page: 10 }] },
  ] },
  { title: "Index", page: null },
];

/** Synthetic reading chain. Never points at a real study library. */
export function seedReadingLibrary(root = scratchRoot()): string {
  const lib = new Library(root);
  const filler = Array.from({ length: 28 }, (_, i) => `第 ${i + 1} 段。${"阅读填充。".repeat(14)}`).join("\n\n");
  const hostClean = `${ANCHOR_A}。${ANCHOR_B}。\n\n${filler}`;
  lib.createPiece({ id: HOST_ID, title: "宿主", body: hostClean });
  lib.createPiece({ id: SIDE_A, title: "第一层", body: `${ANCHOR_C}。\n\n侧边自己的正文。` });
  lib.createPiece({ id: SIDE_B, title: "同层另一篇", body: "同一深度的第二篇。" });
  lib.createPiece({ id: SIDE_C, title: "第二层", body: `${ANCHOR_D}。\n\n第二层其余。` });
  lib.createPiece({ id: SIDE_D, title: "第三层", body: "链的末端。读者可以停在这里。" });
  hangAt(lib, HOST_ID, hostClean, ANCHOR_A, SIDE_A);
  hangAt(lib, HOST_ID, hostClean, ANCHOR_B, SIDE_B);
  hangAt(lib, SIDE_A, `${ANCHOR_C}。\n\n侧边自己的正文。`, ANCHOR_C, SIDE_C);
  hangAt(lib, SIDE_C, `${ANCHOR_D}。\n\n第二层其余。`, ANCHOR_D, SIDE_D);
  const source = path.join(fs.mkdtempSync(path.join(path.dirname(root), "intro-pdf-src-")), BOOK_FILE);
  fs.writeFileSync(source, buildOutlinedPdf(12, BOOK_OUTLINE));
  lib.attachPdf(source, { id: BOOK_ID });
  fs.rmSync(path.dirname(source), { recursive: true, force: true });
  return root;
}

function hangAt(lib: Library, hostId: string, clean: string, anchor: string, sideId: string): void {
  const start = clean.indexOf(anchor);
  if (start < 0) throw new Error(`missing anchor ${anchor}`);
  hangSide(lib, hostId, { start, end: start + anchor.length }, { sideId });
}
