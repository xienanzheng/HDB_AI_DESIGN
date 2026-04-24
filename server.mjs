import http from "node:http";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  imageEdit,
  imageGenerate,
  interiorDesignerAssist,
  readJsonBody,
  sendJson
} from "./lib/openai-api.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, "public");
const DEFAULT_PORT = 3000;

loadEnv(path.join(__dirname, ".env"));

const PORT = Number(process.env.PORT || DEFAULT_PORT);
const HOST = process.env.HOST || "127.0.0.1";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml"
};

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/api/health") {
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "POST" && req.url === "/api/edit") {
      return await handleOpenAiRoute(req, res, imageEdit);
    }

    if (req.method === "POST" && req.url === "/api/generate") {
      return await handleOpenAiRoute(req, res, imageGenerate);
    }

    if (req.method === "POST" && req.url === "/api/id-assist") {
      return await handleOpenAiRoute(req, res, interiorDesignerAssist);
    }

    if (req.method === "GET") {
      return await serveStatic(req, res);
    }

    return sendJson(res, 405, { error: "Method not allowed" });
  } catch (error) {
    console.error("Unhandled server error:", error);
    return sendJson(res, 500, { error: "Internal server error" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Floorplan AI Editor running at http://${HOST}:${PORT}`);
});

async function handleOpenAiRoute(req, res, handler) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    return sendJson(res, 400, { error: error.message || "Invalid JSON body" });
  }

  const result = await handler(body);
  return sendJson(res, result.status, result.body);
}

async function serveStatic(req, res) {
  let pathname = req.url || "/";
  if (pathname === "/") pathname = "/index.html";

  const normalizedPath = path.normalize(pathname).replace(/^\/+/, "");
  const targetPath = path.join(PUBLIC_DIR, normalizedPath);

  if (!targetPath.startsWith(PUBLIC_DIR)) {
    return sendJson(res, 403, { error: "Forbidden" });
  }

  try {
    const file = await readFile(targetPath);
    const ext = path.extname(targetPath).toLowerCase();
    const type = MIME_TYPES[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    res.end(file);
  } catch {
    sendJson(res, 404, { error: "Not found" });
  }
}

function loadEnv(filePath) {
  try {
    const content = readFileSync(filePath, "utf8");
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx <= 0) continue;
      const key = trimmed.slice(0, idx).trim();
      const value = trimmed.slice(idx + 1).trim();
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch {
    // .env is optional; environment variables can be set by shell.
  }
}
