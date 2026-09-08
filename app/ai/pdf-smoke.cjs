// Manual hidden-renderer check. Uses only a synthetic PDF and an isolated profile.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intro-ai-pdf-'));
app.setPath('userData', path.join(dir, 'profile'));
app.whenReady().then(async () => {
  const renderer = path.resolve(__dirname, '../dist/electron/renderer');
  const html = path.join(renderer, 'ai-pdf-smoke.html');
  fs.writeFileSync(html, '<!doctype html><meta charset="utf-8"><title>synthetic test</title>');
  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  try {
    const { minimalPdf } = await import(pathToFileURL(path.resolve(__dirname, '../dist/pdf/fixture.js')).href);
    const bytes = Array.from(minimalPdf('TEST 7319: f(x)=x^2+2x-1'));
    await win.loadFile(html);
    const result = await win.webContents.executeJavaScript(`(async () => {
      const { capturePdfContext, readPdfContextPage } = await import('./pdf-view.js');
      const data = async () => new Uint8Array(${JSON.stringify(bytes)});
      const metadata = await readPdfContextPage('synthetic', data, 0, true);
      const text = await readPdfContextPage('synthetic', data, 1, true);
      if (JSON.parse(metadata.text).pageCount !== 1 || !text.text.includes('TEST 7319') || text.image) throw new Error('Text-only extraction failed');
      const result = await capturePdfContext('synthetic', async () => new Uint8Array(${JSON.stringify(bytes)}), {page:1,rect:{x:65,y:705,width:460,height:45}});
      return result;
    })()`);
    if (result.contexts.length !== 1 || !result.contexts[0].text.includes('TEST 7319') || !result.selectionImage.startsWith('data:image/png;base64,')) throw new Error('PDF snapshot validation failed');
    fs.writeFileSync(path.join(dir, 'crop.png'), Buffer.from(result.selectionImage.split(',')[1], 'base64'));
    fs.writeFileSync(path.join(dir, 'page.png'), Buffer.from(result.contexts[0].image.split(',')[1], 'base64'));
    fs.writeFileSync(path.join(dir, 'context.json'), JSON.stringify(result));
    console.log(`PASS: real PDF.js text, full-page PNG, crop PNG; ${dir}`);
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { fs.unlinkSync(html); win.destroy(); app.quit(); }
});
