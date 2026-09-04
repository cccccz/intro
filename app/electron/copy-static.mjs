import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const electronDir = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(electronDir, "../dist/electron");
const rendererDest = path.join(dist, "renderer");

fs.mkdirSync(rendererDest, { recursive: true });
fs.copyFileSync(path.join(electronDir, "preload.cjs"), path.join(dist, "preload.cjs"));
fs.copyFileSync(
  path.join(electronDir, "renderer/index.html"),
  path.join(rendererDest, "index.html"),
);
fs.copyFileSync(
  path.join(electronDir, "renderer/styles.css"),
  path.join(rendererDest, "styles.css"),
);

const vendorDest = path.join(rendererDest, "vendor");
fs.mkdirSync(path.join(vendorDest, "fonts"), { recursive: true });

const katexSrc = path.resolve(electronDir, "../../node_modules/katex/dist");
fs.copyFileSync(path.join(katexSrc, "katex.min.js"), path.join(vendorDest, "katex.min.js"));
fs.copyFileSync(path.join(katexSrc, "katex.min.css"), path.join(vendorDest, "katex.min.css"));
for (const name of fs.readdirSync(path.join(katexSrc, "fonts"))) {
  fs.copyFileSync(path.join(katexSrc, "fonts", name), path.join(vendorDest, "fonts", name));
}

fs.copyFileSync(
  path.resolve(electronDir, "../../node_modules/markdown-it/dist/markdown-it.min.js"),
  path.join(vendorDest, "markdown-it.min.js"),
);
