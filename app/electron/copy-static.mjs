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
