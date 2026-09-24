import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HarnessSession } from "./session.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

export type HarnessServer = {
  url: string;
  close: () => Promise<void>;
};

export function rendererDir(): string {
  return path.resolve(here, "../dist/electron/renderer");
}

export function startHarness(root: string, allowOutsideTemp = false): Promise<HarnessServer> {
  const session = new HarnessSession(root, allowOutsideTemp);
  const renderer = rendererDir();
  const indexPath = path.join(renderer, "index.html");
  if (!fs.existsSync(indexPath)) {
    throw new Error("阅读页还没构建。先运行 npm run build:renderer。");
  }
  const indexHtml = fs.readFileSync(indexPath, "utf8").replace(
    '<script type="module" src="./renderer.js"></script>',
    '<script src="./harness-bridge.js"></script>\n  <script type="module" src="./renderer.js"></script>',
  );
  const bridge = fs.readFileSync(path.join(here, "bridge.js"));

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/api/library") {
      sendJson(res, 200, { ok: true, library: session.libraryDto() });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api") {
      readBody(req).then((raw) => {
        let body: { method?: string; args?: unknown[] };
        try {
          body = JSON.parse(raw || "{}") as { method?: string; args?: unknown[] };
        } catch {
          sendJson(res, 400, { ok: false, error: "invalid json" });
          return;
        }
        if (!body.method) {
          sendJson(res, 400, { ok: false, error: "missing method" });
          return;
        }
        sendJson(res, 200, session.call(body.method, Array.isArray(body.args) ? body.args : []));
      }).catch((err: unknown) => {
        sendJson(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
      });
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      sendJson(res, 405, { ok: false, error: "method not allowed" });
      return;
    }
    if (url.pathname === "/harness-bridge.js") {
      res.writeHead(200, { "content-type": MIME[".js"] });
      res.end(req.method === "HEAD" ? undefined : bridge);
      return;
    }
    if (url.pathname === "/" || url.pathname === "/index.html") {
      res.writeHead(200, { "content-type": MIME[".html"] });
      res.end(req.method === "HEAD" ? undefined : indexHtml);
      return;
    }
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const file = path.resolve(renderer, rel);
    if (file !== renderer && !file.startsWith(renderer + path.sep)) {
      sendJson(res, 403, { ok: false, error: "forbidden" });
      return;
    }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      sendJson(res, 404, { ok: false, error: "not found" });
      return;
    }
    res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
    res.end(req.method === "HEAD" ? undefined : fs.readFileSync(file));
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("harness failed to bind"));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${address.port}/`,
        close: () => new Promise((done, fail) => server.close((err) => err ? fail(err) : done())),
      });
    });
  });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => {
      chunks.push(Buffer.from(chunk));
      if (chunks.reduce((sum, item) => sum + item.length, 0) > 2_000_000) {
        reject(new Error("request too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
