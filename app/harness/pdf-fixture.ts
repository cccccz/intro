/**
 * Minimal PDF with text pages and a bookmark tree, written by hand so the
 * harness needs no PDF library. Titles are ASCII to stay in PDFDocEncoding.
 */

export type BookmarkSpec = { title: string; page: number | null; children?: BookmarkSpec[] };

export function buildOutlinedPdf(pageCount: number, bookmarks: readonly BookmarkSpec[]): Uint8Array {
  const objects: string[] = [];
  const alloc = (): number => objects.push("");
  const set = (id: number, body: string): void => { objects[id - 1] = body; };

  const catalog = alloc();
  const pagesId = alloc();
  const font = alloc();
  const outlines = alloc();
  const pageIds: number[] = [];
  for (let n = 1; n <= pageCount; n++) {
    const page = alloc();
    const content = alloc();
    pageIds.push(page);
    const stream = `BT /F1 36 Tf 72 700 Td (Page ${n}) Tj ET`;
    set(content, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    set(page, `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`);
  }
  set(pagesId, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageCount} >>`);
  set(font, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  const escape = (text: string): string => text.replace(/[\\()]/g, (c) => `\\${c}`);
  const count = (list: readonly BookmarkSpec[]): number =>
    list.reduce((sum, b) => sum + 1 + count(b.children ?? []), 0);
  const writeLevel = (list: readonly BookmarkSpec[], parent: number): number[] => {
    const ids = list.map(() => alloc());
    list.forEach((b, i) => {
      const kids = b.children ?? [];
      const kidIds = writeLevel(kids, ids[i]!);
      const parts = [`/Title (${escape(b.title)})`, `/Parent ${parent} 0 R`];
      if (i > 0) parts.push(`/Prev ${ids[i - 1]} 0 R`);
      if (i < ids.length - 1) parts.push(`/Next ${ids[i + 1]} 0 R`);
      if (kidIds.length) parts.push(`/First ${kidIds[0]} 0 R`, `/Last ${kidIds.at(-1)} 0 R`, `/Count ${-count(kids)}`);
      if (b.page !== null) parts.push(`/Dest [${pageIds[b.page - 1]} 0 R /Fit]`);
      set(ids[i]!, `<< ${parts.join(" ")} >>`);
    });
    return ids;
  };
  const top = writeLevel(bookmarks, outlines);
  set(outlines, top.length
    ? `<< /Type /Outlines /First ${top[0]} 0 R /Last ${top.at(-1)} 0 R /Count ${count(bookmarks)} >>`
    : "<< /Type /Outlines /Count 0 >>");
  set(catalog, `<< /Type /Catalog /Pages ${pagesId} 0 R /Outlines ${outlines} 0 R /PageMode /UseOutlines >>`);

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
