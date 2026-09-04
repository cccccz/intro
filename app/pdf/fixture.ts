/**
 * Tiny one-page PDF for tests and local smoke. Helvetica is a standard 14
 * font; no rivets are written into these bytes.
 */
export function minimalPdf(text = "intro PDF host"): Uint8Array {
  const safe = text.replace(/[()\\]/g, " ");
  const stream = `BT /F1 24 Tf 72 720 Td (${safe}) Tj ET\n`;
  const encoder = new TextEncoder();
  const streamBytes = encoder.encode(stream);

  const objects = [
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n",
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n",
    "3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>endobj\n",
    "4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n",
    `5 0 obj<</Length ${streamBytes.length}>>stream\n${stream}endstream\nendobj\n`,
  ];

  let body = "%PDF-1.1\n";
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(body.length);
    body += obj;
  }
  const xrefAt = body.length;
  let xref = `xref\n0 ${objects.length + 1}\n`;
  xref += "0000000000 65535 f \n";
  for (let i = 1; i <= objects.length; i++) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  const trailer =
    `trailer<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return encoder.encode(body + xref + trailer);
}

export function isPdfMagic(bytes: Uint8Array): boolean {
  if (bytes.length < 5) {
    return false;
  }
  return (
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  );
}
